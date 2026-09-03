# **An Architectural Survey of Secret Supply Mechanisms in Google Cloud Run Jobs**

## **1\. Supported Mechanisms for Supplying Secrets to Cloud Run Jobs**

The Google Cloud Run platform provides distinct mechanisms for supplying configuration data and credentials to a Cloud Run Job. A Cloud Run Job differs fundamentally from a Cloud Run Service; while a service continuously listens for and serves HTTP requests, a job executes a specific, non-HTTP task to completion and exits, running one or multiple tasks in parallel1. Given the provided context of a non-idempotent job triggered on demand and running for several minutes, the mechanism chosen to inject credentials carries profound architectural implications for failure domains, security visibility, and operational lifecycle.  
The platform supports two native mechanisms that integrate directly with Google Cloud Secret Manager, alongside a third standard container configuration mechanism that relies on plain-text environment variables.

### **Native Integration via Secret Manager: Environment Variables**

The first supported mechanism involves resolving a secret payload from Google Cloud Secret Manager and injecting it directly into the container's environment block as an environment variable.  
According to the official Google Cloud documentation detailing secret configuration (https://docs.cloud.google.com/run/docs/configuring/jobs/secrets), this integration is established at the job template level2. The configuration maps a user-defined environment variable name to a specific Secret Manager resource identifier, formatted as projects/PROJECT\_NUMBER/secrets/SECRET\_NAME2. This can be configured via the Google Cloud Console within the "Variables and Secrets" tab, or via the Google Cloud CLI using the \--update-secrets flag during job creation or updates2.  
The resolution of the secret value occurs strictly during the instance startup phase, which happens prior to the execution of the user's container entrypoint2. When an execution is triggered, the Cloud Run control plane pauses the initialization of the container, securely authenticates with the Secret Manager API using the job's attached service identity, and fetches the payload2. If this retrieval process fails—whether due to insufficient Identity and Access Management (IAM) permissions, network routing issues, or the secret version being disabled—the instance will entirely fail to start2. For a non-idempotent job, this behavior presents a specific tradeoff: the failure occurs before any domain logic executes, preventing partial or corrupted data processing.  
Once successfully resolved, the secret lands directly in the container's environment variable space2. Crucially, the actual plain-text value of the secret never appears in the job's configuration definition. Any operator or service with viewer-level access to the Google Cloud Console, or any entity utilizing the gcloud run jobs describe command, will only observe the reference mapping (the resource ID and the selected version), ensuring the payload remains obfuscated from the control plane configuration interface2.

### **Native Integration via Secret Manager: Mounted Volumes**

The second supported mechanism mounts the secret directly into the container's virtual file system as a read-only volume.  
The configuration for this method, as documented at https://docs.cloud.google.com/run/docs/configuring/jobs/secrets, requires defining a volume type of "Secret" within the job specification and mapping it to an absolute mount path within the container (for example, /etc/secrets/dbconfig/password)2. The platform enforces specific constraints on this mechanism: Cloud Run prohibits mounting secrets at system-critical paths such as /dev, /proc, or /sys, or any of their subdirectories3. Furthermore, multiple secrets cannot be mounted at the exact same location3. Because Cloud Run Jobs utilize the second-generation execution environment by default, the ownership of this mounted secret volume is assigned to the root user1.  
In contrast to environment variables, Cloud Run does not perform any validation, permission checks, or payload retrieval during the instance startup phase when secrets are mounted as volumes2. The resolution of the secret is entirely deferred to runtime. The official documentation notes that when the application code performs a file read operation on the mounted volume, Cloud Run fetches the secret value from Secret Manager to fulfill that read request3.  
The payload lands strictly on the designated mount path as a file2. If the secret becomes inaccessible during this runtime read operation—due to an unexpected permission revocation or the secret being destroyed—the file read attempt will fail, resulting in an input/output (I/O) error within the executing application2. For a non-idempotent job that runs for several minutes, this runtime failure mode introduces the risk of the job failing mid-execution, which may require complex manual intervention or data reconciliation if the job had already begun mutating external state before attempting to read the secret.  
Similar to the environment variable integration, the plain-text value of the secret is never exposed in the job's configuration. Viewer-level access only reveals the volume name, the mount path, and the Secret Manager resource identifier2.

### **Standard Configuration: Plain Environment Variables**

The third mechanism involves defining credentials as standard, plain-text environment variables directly within the job's resource specification.  
Configured via the Google Cloud Console, .env file uploads, or the \--set-env-vars flag via the CLI, these values are statically defined as part of the job template7. They are resolved at the moment of configuration (build or deploy time), meaning the text provided by the operator is baked directly into the Cloud Run job metadata7.  
These values land in the container's environment space. Because they are an intrinsic part of the resource specification, the values appear in plain text in the job's configuration7. Consequently, anyone with Project Viewer permissions, or anyone executing the gcloud run jobs describe command, can read the credentials in clear text7. The official documentation at https://docs.cloud.google.com/run/docs/configuring/jobs/environment-variables explicitly warns architects against using this mechanism for secrets, citing this broad visibility7.

## **2\. Secret Manager Integration: Architectural Specifics**

For enterprise architectures relying on Secret Manager, navigating the nuances between volume mounts and environment variables, understanding version pinning dynamics, managing IAM scopes, and planning around platform limits are foundational steps.

### **Volumes versus Environment Variables**

The decision to utilize a mounted volume versus an environment variable involves distinct architectural tradeoffs regarding application initialization, error handling, and rotation readiness.

| Architectural Feature | Environment Variable Injection | Volume Mount Injection |
| :---- | :---- | :---- |
| **Resolution Timing** | Prior to the container instance starting2. | Deferred until the application executes a file read3. |
| **Primary Failure Mode** | Container initialization aborts; execution task fails immediately without running domain logic2. | Application encounters a runtime I/O exception during execution2. |
| **Storage Medium** | Operating system environment variable block2. | In-memory virtual file system owned by the root user2. |
| **Google Recommendation** | Recommended when pinning to a specific, static secret version2. | Recommended when secret rotation during the application lifecycle is required2. |

Google's official documentation at https://docs.cloud.google.com/run/docs/configuring/instances/secrets explicitly recommends mounting secrets as volumes when the architecture must support secret rotation3. Because reading a volume theoretically fetches the latest value from Secret Manager, an application can periodically re-read the file to obtain updated credentials without requiring the Cloud Run instance to be restarted3.  
Conversely, the documentation advises that environment variables are resolved strictly at instance startup2. If an architecture relies on environment variables, rotating a secret necessitates the termination of the current instance and the initialization of a new one to fetch the updated payload2.  
*Ambiguity Note:* While the documentation asserts that "When reading a volume, Cloud Run always fetches the secret value from the Secret Manager"3, it remains ambiguous regarding the micro-level caching mechanics during a single, uninterrupted execution task. It is not explicitly documented whether a loop executing thousands of file reads per second on the mounted secret will trigger thousands of synchronous API calls to Secret Manager (which would rapidly exhaust API quotas), or if the Cloud Run infrastructure caches the file payload locally in the in-memory file system for a defined Time-To-Live (TTL). In the absence of documented caching behavior, architectures involving long-running jobs (several minutes) should treat mid-execution file reads for secret rotation with caution, recognizing that the exact latency and API pressure profile is undefined.

### **Version Pinning and Failure Modes**

Secret Manager supports strict versioning, allowing payloads to be appended as new versions rather than overwriting existing data2. When mapping a secret to a Cloud Run Job, the architecture can specify either a pinned, absolute version integer (for example, 1 or 2\) or utilize the dynamic alias latest2.  
The official documentation strongly advises against utilizing the latest alias when exposing secrets as environment variables2. Because environment variables are only resolved at instance startup, an application scaling out horizontally could result in different container instances within the same job execution possessing divergent versions of the secret if the latest pointer is updated in Secret Manager mid-execution2. Pinning to a specific integer version ensures deterministic initialization across all concurrent tasks.  
If a pinned version is utilized and is subsequently disabled or destroyed within Secret Manager, the resulting failure mode bifurcates based on the ingestion mechanism. For environment variables, subsequent attempts to start new instances for the job execution will fail during the initialization phase, as the prerequisite API fetch will return a not-found or permission-denied error2. For volume mounts, the container instance will start successfully and execute the entrypoint, but the application will crash or throw a fatal exception when it eventually attempts to read the underlying file pathway, as the deferred read operation will fail2.

### **Configuration Visibility**

Security and compliance auditing often requires confirming whether operational staff can view underlying credentials through administrative interfaces. The official documentation confirms that when utilizing native Secret Manager integrations, the payload itself is absolutely never visible in the Cloud Run web console or through the CLI2.  
Running the gcloud run jobs describe JOB\_NAME command outputs the job specification, which includes the run.googleapis.com/secrets annotation and the mapping configurations2. This output reveals the project number, the secret name, and the referenced version, providing full auditability of the configuration topology without exposing the sensitive payload itself2.

### **IAM Roles and Scoping**

To permit a Cloud Run Job to authenticate with Secret Manager and access a payload, the job's runtime service account (referred to as the service identity) must be granted the roles/secretmanager.secretAccessor IAM role2.  
This role can be scoped according to the principle of least privilege. The official documentation at https://docs.cloud.google.com/secret-manager/docs/access-control confirms that the roles/secretmanager.secretAccessor role can be bound directly to an individual secret resource, rather than at the overarching project level8. By binding the IAM policy at the specific secret level, the Cloud Run Job's runtime service account is cryptographically restricted to reading only the explicitly authorized secrets. It will receive authorization denial errors if it attempts to read any other secrets within the same Google Cloud project, thereby minimizing the blast radius of a potential service identity compromise8.

### **Practical Limits and Structuring**

When determining whether to supply a few dozen third-party credentials as dozens of individual secrets or as a single, consolidated structured blob, several platform limits and architectural tradeoffs must be considered.  
Secret Manager enforces a strict maximum payload size of 64 KiB per secret version, as documented at https://docs.cloud.google.com/secret-manager/docs/creating-and-accessing-secrets10. A structured JSON payload containing a few dozen username and password strings will consume only a minor fraction of a single kilobyte, easily fitting within the 64 KiB limit of a single secret.  
Regarding the maximum number of secrets per job, the Cloud Run documentation does not cite a specific maximum ceiling for volume mounts, though total in-memory volume mounts are constrained by the memory allocated to the container12. However, the documentation at https://docs.cloud.google.com/run/quotas establishes a hard limit of 1,000 environment variables per container13. Therefore, exposing dozens of individual secrets as environment variables is well within platform limits.  
Structuring dozens of credentials into a single JSON blob versus creating dozens of discrete secrets presents the following operational tradeoffs:

> 1. **API Quota Pressure:** Secret Manager enforces an Access request quota of 90,000 requests per minute per project11. Furthermore, there is a soft-enforced rate limit for modifying and accessing global secrets of 120 requests per minute per secret11. If a job is executed with high parallelism (e.g., hundreds of concurrent tasks spinning up simultaneously), fetching 36 individual secrets per task could generate severe, immediate API pressure, leading to throttling and task initialization failures. A single structured blob requires only one API call per instance, drastically reducing the risk of encountering rate limits.  
> 2. **IAM Complexity:** Authorizing a single structured secret requires managing exactly one IAM policy binding on one resource. Authorizing dozens of individual secrets requires provisioning and maintaining dozens of distinct IAM bindings to maintain least privilege, significantly increasing infrastructure-as-code complexity and operational overhead.  
> 3. **Blast Radius and Rotation Granularity:** Consolidating all third-party credentials into a single secret expands the conceptual blast radius. If a single third-party portal requires a password rotation, the operator must generate a completely new version of the master JSON blob containing all other untouched credentials. This triggers a rotation event for the entire configuration, potentially violating isolation principles. Discrete secrets allow for targeted rotations of individual credentials without impacting the version history of others.

## **3\. Invocation-Time Credential Passing**

An alternative architectural pattern involves a calling service—in this context, a separate Cloud Run service—passing context, arguments, or credentials directly to the Cloud Run Job at the exact moment of invocation.

### **Support and Mechanics**

Cloud Run Jobs fully support dynamic configuration overrides at execution time. The underlying google.cloud.run.v2.Jobs.RunJob API endpoint, which is invoked when executing a job programmatically or via the gcloud run jobs execute command, accepts an overrides object within the request payload14.  
As documented at https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run, within this overrides object, the containerOverrides array allows the calling service to dynamically inject both env (environment variables) and args (entrypoint arguments) for that specific, isolated execution14. This permits the calling service to alter the execution parameters without permanently mutating the underlying job template15. Executing a job with overrides requires the calling service identity to possess the run.jobs.runWithOverrides IAM permission, which carries a Data Write audit classification14.

### **Landing and Visibility**

When configuration values are passed via the API payload as overrides, they land exactly where specified by the caller: they are either appended and merged into the container's environment variables, or they replace the container's existing startup arguments14.  
Because these overrides modify the operational specification of that specific execution, they are permanently recorded as part of the immutable Execution resource within the Cloud Run control plane. Consequently, the values passed in this manner are highly visible. Any administrator or automated auditor running the gcloud run jobs executions describe EXECUTION\_NAME command will see the exact arguments and environment overrides supplied during invocation in plain text18.

### **Google's Position on Appropriateness**

The official Google Cloud documentation does not explicitly dedicate a section to prohibiting the use of execution overrides for secret passing; however, it provides a severe, encompassing caution regarding the underlying mechanisms used by overrides.  
The documentation at https://docs.cloud.google.com/run/docs/configuring/jobs/environment-variables explicitly dictates: "Caution: Don't use environment variables to store and consume secrets, because environment variables are visible to anyone with project Viewer permissions or greater. Instead, use Secret Manager with Cloud Run as described in the Using secrets page"7.  
Given that invocation overrides utilizing the env or args parameters function identically to plain-text configuration regarding their high visibility in the resource history and control plane, applying this invocation-time pattern to sensitive credentials directly contravenes Google's documented security posture. Passing credentials via the RunJob payload guarantees their exposure to anyone authorized to view the execution history.

## **4\. Audit Capabilities and Exposure Surface**

Understanding the auditability and potential leakage vectors of secret ingestion mechanisms is paramount for maintaining a secure architecture, particularly for jobs integrating with multiple third-party systems.

### **Cloud Logging Default Captures**

By default, Cloud Run captures standard output (stdout) and standard error (stderr) streams from the executing container and routes them directly to Cloud Logging21.  
If a credential is passed as a plain-text environment variable or as an invocation override, the google.cloud.run.v2.Jobs.RunJob API call is intercepted by Cloud Audit Logs and categorized as a Data Write operation, provided the project is configured to capture these logs17. Because the secret is embedded directly in the request payload as an override, the plain-text value may be captured in the audit log entry for the API invocation, permanently recording the credential in Cloud Logging outside of the container's isolated execution environment.

### **Secret Manager Auditing**

When utilizing the native Secret Manager integration, the retrieval of the secret is comprehensively audited, provided that Data Access audit logs are enabled for the project22.  
As documented at https://docs.cloud.google.com/secret-manager/docs/audit-logging, the Secret Manager API logs the AccessSecretVersion method22. This log entry utilizes the specific service name secretmanager.googleapis.com and is categorized as a Data Access log22.  
The audit log entry contains a highly structured JSON payload. Crucially, it captures the exact resource name of the secret accessed and the authenticated caller's identity (the service identity of the Cloud Run Job)23. This granularity allows security teams to create precise log-based alerts to monitor exactly when and by whom a specific credential was accessed23. The sensitive payload of the secret itself is never included in this audit log, ensuring that enabling deep auditability does not inadvertently create a credential leakage vector23.

### **Known Leakage Vectors**

Even when Secret Manager is configured flawlessly, secrets can still leak due to underlying application behaviors and operating system mechanics.  
*Inference and Community Practice:* While the provided official documentation explicitly notes that plain environment variables are visible to users with Viewer permissions7, it is a widely acknowledged industry consensus and community practice to assume that environment variables carry a fundamentally higher inherent risk of runtime leakage than file-based volume mounts, due to how operating systems handle process memory.  
Known vectors through which a secret placed in an environment variable can leak include:

> 1. **Application Exception Traces:** Many modern programming frameworks (such as Python's Django, Spring Boot, or Node.js debuggers) default to printing the entire environment block to standard output or standard error when a fatal, unhandled exception occurs. Because Cloud Run captures stdout and stderr to Cloud Logging automatically21, an unexpected application crash can inadvertently dump all secret environment variables into plain-text telemetry logs.  
> 2. **Crash Dumps and Core Dumps:** If the container kernel generates a memory core dump during a segmentation fault, the environment block allocated to the process (often accessible via /proc/self/environ in Linux environments) is serialized into the dump file. If these dumps are exported for analysis, the credentials are exported alongside them.  
> 3. **Debugging and Telemetry Subprocesses:** Developers or automated sidecars executing diagnostic commands (such as running the env or printenv utilities) will echo the entire environment block into logs or terminal outputs.  
> 4. **Subprocess Inheritance:** Child processes spawned by the primary application implicitly inherit the entire environment block of the parent process unless the developer explicitly sanitizes the context. This inadvertently expands the attack surface, granting third-party binaries or shell scripts executed by the job full access to the credentials.

Mounted volumes mitigate many of these passive leakage vectors. By isolating the secret to a specific file descriptor, the application requires deliberate code to open, read, and output the file contents, thereby shielding the credentials from framework-level exception trace dumps and subprocess environment inheritance.

## **5\. Lifecycle and Rotation Dynamics**

When a third-party portal credential changes, the architecture must dictate how the Cloud Run Job detects and adopts the new value. The required operational sequence depends entirely on the chosen secret ingestion mechanism and versioning strategy.

### **Rotation with Secret Manager: Volume Mounts**

If the secret is mounted as a volume and the configuration is pinned to the dynamic latest version alias, the rotation process is highly streamlined.  
According to the documentation, when reading a volume, Cloud Run always fetches the value from Secret Manager to use the latest version3. Therefore, if an administrator publishes a new secret version in Secret Manager, the Cloud Run Job configuration does not need to be updated, and the service does not require redeployment.  
Any completely new execution of the job triggered after the secret is updated will mount the volume and fetch the new version upon the application's first read operation. However, as previously noted regarding ambiguity, whether a currently running, multi-minute execution task will seamlessly fetch the new version if it re-opens the file mid-execution is not explicitly guaranteed by the provided documentation. To guarantee the new credential is used safely and deterministically, allowing the current execution to finish and triggering a new execution is the most robust approach.

### **Rotation with Secret Manager: Environment Variables**

If the secret is injected as an environment variable, rotation requires a more deliberate lifecycle event.  
Because environment variables are strictly resolved *prior* to starting the instance, a running instance will never see a credential change; its environment block is immutable for the lifespan of the container2.

* If the job is configured to use the latest version alias, a new execution must be triggered. The invocation of a new execution will command the control plane to spin up new instances, which will subsequently resolve the newly updated latest value during their startup phase. No redeployment or modification of the underlying job template is necessary.  
* If the job is configured to use a pinned version (for example, version 2), as explicitly recommended by Google for environment variables2, merely triggering a new execution is insufficient. The job configuration itself must be formally updated (redeployed) to point to the new version (for example, version 3). This requires the operator or CI/CD pipeline to execute an update command (e.g., gcloud run jobs update JOB\_NAME \--update-secrets=...:3) to generate a new underlying job specification before a subsequent execution can utilize the updated credential3.

### **Rotation with Invocation-Time Overrides**

If credentials are passed dynamically via execution overrides, Secret Manager is completely bypassed by the Cloud Run infrastructure.  
In this scenario, rotation requires absolutely no redeployment or modification of the Cloud Run Job itself. Instead, the upstream service responsible for calling the google.cloud.run.v2.Jobs.RunJob API must be updated to retrieve, construct, and pass the new credential payload in its subsequent invocation request14. The Cloud Run Job will act as a passive receiver, simply adopting whatever values are injected into the environment variables or arguments for that specific new execution.

#### **Works cited**

> 1. Create jobs | Cloud Run \- Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/create-jobs](https://docs.cloud.google.com/run/docs/create-jobs)  
> 2. Configure secrets for jobs | Cloud Run \- Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/configuring/jobs/secrets](https://docs.cloud.google.com/run/docs/configuring/jobs/secrets)  
> 3. Configure secrets for instances | Cloud Run, [https://docs.cloud.google.com/run/docs/configuring/instances/secrets](https://docs.cloud.google.com/run/docs/configuring/instances/secrets)  
> 4. Configure secrets for services | Cloud Run, [https://docs.cloud.google.com/run/docs/configuring/services/secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets)  
> 5. Configure Cloud Storage volume mounts for Cloud Run services, [https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts](https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts)  
> 6. Configure Cloud Storage volume mounts for instances | Cloud Run, [https://docs.cloud.google.com/run/docs/configuring/instances/cloud-storage-volume-mounts](https://docs.cloud.google.com/run/docs/configuring/instances/cloud-storage-volume-mounts)  
> 7. Configure environment variables for jobs | Cloud Run, [https://docs.cloud.google.com/run/docs/configuring/jobs/environment-variables](https://docs.cloud.google.com/run/docs/configuring/jobs/environment-variables)  
> 8. The Risk of Exposed Cloud Functions and How to Harden, [https://cloud.google.com/blog/topics/threat-intelligence/exposed-cloud-functions-harden](https://cloud.google.com/blog/topics/threat-intelligence/exposed-cloud-functions-harden)  
> 9. Access control with IAM | Secret Manager, [https://docs.cloud.google.com/secret-manager/docs/access-control](https://docs.cloud.google.com/secret-manager/docs/access-control)  
> 10. Create a secret | Secret Manager \- Google Cloud Documentation, [https://docs.cloud.google.com/secret-manager/docs/creating-and-accessing-secrets](https://docs.cloud.google.com/secret-manager/docs/creating-and-accessing-secrets)  
> 11. Quotas and limits | Secret Manager \- Google Cloud Documentation, [https://docs.cloud.google.com/secret-manager/quotas](https://docs.cloud.google.com/secret-manager/quotas)  
> 12. Configure in-memory volume mounts for services | Cloud Run, [https://docs.cloud.google.com/run/docs/configuring/services/in-memory-volume-mounts](https://docs.cloud.google.com/run/docs/configuring/services/in-memory-volume-mounts)  
> 13. Cloud Run Quotas and Limits \- Google Cloud Documentation, [https://docs.cloud.google.com/run/quotas](https://docs.cloud.google.com/run/quotas)  
> 14. Method: projects.locations.jobs.run \- Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run)  
> 15. Execute jobs | Cloud Run \- Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/execute/jobs](https://docs.cloud.google.com/run/docs/execute/jobs)  
> 16. Method: namespaces.jobs.run \- Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/reference/rest/v1/namespaces.jobs/run](https://docs.cloud.google.com/run/docs/reference/rest/v1/namespaces.jobs/run)  
> 17. Cloud Run audit logging \- Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/audit-logging](https://docs.cloud.google.com/run/docs/audit-logging)  
> 18. Manage job executions | Cloud Run \- Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/managing/job-executions](https://docs.cloud.google.com/run/docs/managing/job-executions)  
> 19. gcloud run jobs executions describe | Google Cloud SDK, [https://docs.cloud.google.com/sdk/gcloud/reference/run/jobs/executions/describe](https://docs.cloud.google.com/sdk/gcloud/reference/run/jobs/executions/describe)  
> 20. Configure sandboxes for jobs | Cloud Run, [https://docs.cloud.google.com/run/docs/configuring/jobs/sandboxes](https://docs.cloud.google.com/run/docs/configuring/jobs/sandboxes)  
> 21. Manage jobs | Cloud Run \- Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/managing/jobs](https://docs.cloud.google.com/run/docs/managing/jobs)  
> 22. Secret Manager Audit Logging \- Google Cloud Documentation, [https://docs.cloud.google.com/secret-manager/docs/audit-logging](https://docs.cloud.google.com/secret-manager/docs/audit-logging)  
> 23. Configure log-based alerting policies \- Google Cloud Documentation, [https://docs.cloud.google.com/logging/docs/alerting/log-based-alerts](https://docs.cloud.google.com/logging/docs/alerting/log-based-alerts)  
> 24. Audit-Logging in Secret Manager | Google Cloud Documentation, [https://docs.cloud.google.com/secret-manager/docs/audit-logging?hl=de](https://docs.cloud.google.com/secret-manager/docs/audit-logging?hl=de)