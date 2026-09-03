# **Architectural Analysis of Google Cloud Run Jobs for Long-Running Asynchronous Workloads**

## **Executive Summary**

The transition of compute-intensive, asynchronous workloads—such as comprehensive web scraping, data ETL (Extract, Transform, Load) pipelines, and batch processing—from synchronous serverless HTTP endpoints to dedicated asynchronous execution environments represents a critical architectural maturation. Serverless computing platforms dynamically manage compute resources to optimize for high-density, request-driven traffic. When engineering teams attempt to utilize default HTTP-driven services for background processing, this dynamic management often results in aggressive central processing unit (CPU) throttling the moment an active HTTP request is fulfilled or dropped. For workloads characterized by unpredictable, multi-minute execution times that do not rely on continuous inbound network requests, this throttling causes catastrophic performance degradation, network connection timeouts, and outright execution failure.  
This comprehensive research report evaluates the capabilities, constraints, limits, and configuration parameters of Google Cloud Run Jobs as a robust solution for long-running batch workloads. Specifically, this analysis addresses the architectural viability of migrating a web-scraping workload from a standard Cloud Run Service to a Cloud Run Job, while interfacing with a separate Next.js web application. The report deeply investigates continuous CPU allocation mechanics, execution time limits, programmatic invocation patterns, Identity and Access Management (IAM) requirements, retry behaviors, and cost disparities. Furthermore, it explicitly evaluates the official documentation status of near-real-time progress reporting patterns, specifically the bridging of internal asynchronous job states to external Server-Sent Events (SSE) via intermediary datastores like Firestore.  
By comprehensively analyzing the official Google Cloud documentation, this report establishes a definitive framework for architecting resilient, long-running web scraping operations on the Google Cloud serverless stack.

## **Compute Resource Provisioning and CPU Allocation Dynamics**

The fundamental architectural challenge with running background scraping tasks on a default Cloud Run Service stems from the platform's request-lifecycle resource management. Understanding the stark distinction in CPU allocation between Cloud Run Services and Cloud Run Jobs is paramount to resolving performance bottlenecks and ensuring task completion.

### **Request-Based vs. Instance-Based Billing and Throttling**

Google Cloud Run offers two distinct billing and CPU allocation models that dictate how the underlying hypervisor provisions compute cycles to the container instance: Request-based billing and Instance-based billing. These models are detailed extensively in the official Cloud Run billing settings documentation (https://docs.cloud.google.com/run/docs/configuring/billing-settings)1.  
The default paradigm for Cloud Run Services is **Request-Based Billing**. In this model, the underlying container instance is only charged when it is actively processing an incoming HTTP request, during cold startup, or during the shutdown sequence1. The architectural consequence of this billing model is aggressive compute throttling. According to the Cloud Run container contract documentation (https://docs.cloud.google.com/run/docs/container-contract), for Cloud Run Services utilizing request-based billing, CPU is *only* allocated during request processing1.  
If a web scraping task is initiated via an HTTP request, and the service immediately returns an HTTP 202 Accepted response to the client while spawning a background thread to perform the actual scrape, the Cloud Run load balancer registers zero active requests for that instance. Consequently, the instance is immediately considered "idle." When an instance transitions to an idle state, the container runtime throttles the CPU to near-zero2. The background scraping process will immediately stall, active TCP connections to target websites will freeze and eventually time out, and the container will ultimately be terminated by the platform if it remains idle for up to 15 minutes2. To mitigate this in Services, Cloud Run utilizes Adaptive Concurrency Tuning (ACT) to prevent CPU throttling from causing high request latency, but this algorithm solely optimizes for active incoming requests, providing no relief for orphaned background threads4.  
Conversely, Cloud Run Jobs operate under a fundamentally different paradigm. The documentation explicitly confirms that **Instance-Based Billing** is mandatory for all Cloud Run Jobs; they cannot be configured to use request-based billing1.

### **Unthrottled CPU for the Entire Execution Lifecycle**

Because Cloud Run Jobs mandate the instance-based billing model, they receive an entirely different CPU allocation profile. The documentation explicitly guarantees that with instance-based billing, CPU is allocated for the entire container instance lifecycle, continuously, from start to finish1.  
This confirms that a Cloud Run Job receives full, un-throttled access to its configured CPU limits from the moment the task initiates until the task completes, fails, or is explicitly cancelled by an administrator1. Whether the application thread is actively parsing a complex, nested Document Object Model (DOM) requiring intensive CPU cycles, or sitting idle awaiting an I/O response from a remote target web server, the CPU allocation remains constant and available. The underlying container runtime does not monitor incoming HTTP requests to determine CPU entitlement because a Cloud Run Job does not expose an ingress port or serve inbound requests at all1.  
When provisioning a Cloud Run Job, administrators have specific constraints regarding resource limits, as detailed in the Cloud Run Jobs CPU configuration documentation (https://docs.cloud.google.com/run/docs/configuring/jobs/cpu).

| Configured Resource | Minimum Requirement | Maximum Limit | Associated Constraints |
| :---- | :---- | :---- | :---- |
| **vCPU Allocation** | 1 vCPU (Standard) | 8 vCPUs | Must be selected in increments of 1, 2, 4, 6, or 8 CPUs1. Fractional allocations (e.g., 0.08 vCPU) are permitted only under strict conditions requiring sidecars and request-based billing, which generally applies to services, not standalone jobs1. |
| **Memory per 1 vCPU** | 128 MiB | 4 GiB | A minimum of 512 MiB is required generally, scaling proportionally with the CPU choice1. |
| **Memory per 8 vCPU** | 4 GiB | 32 GiB | High-memory configurations require a higher minimum CPU allocation to ensure stability1. |

In summary, migrating the web scraping workload to a Cloud Run Job definitively resolves the CPU starvation anomaly. The official documentation unequivocally confirms that a Job is granted unthrottled CPU allocation for the entirety of its execution, regardless of its operational state (CPU-bound vs. network-bound), standing in stark contrast to the default "CPU is only allocated during request processing" behavior of a standard Cloud Run Service.

## **Lifecycle Boundaries: Execution Time Limits and Task Timeouts**

Web scraping tasks are notoriously unpredictable. Paginating through deeply nested e-commerce catalogs, gracefully handling rate limits (HTTP 429 Too Many Requests) imposed by target servers, waiting for dynamic JavaScript rendering, and implementing exponential backoff protocols for transient network errors can cause execution times to balloon from mere seconds to multiple hours. Therefore, understanding the absolute upper bounds of execution time in Cloud Run Jobs is critical to architecting a reliable system.

### **The Abstraction of Jobs versus Tasks**

To understand timeouts, one must first understand the architectural abstraction of a Cloud Run Job. A Cloud Run Job is not a monolithic execution entity; rather, it is a declarative configuration that acts as a parent wrapper for one or more independent "tasks." According to the Cloud Run job creation documentation (https://docs.cloud.google.com/run/docs/create-jobs), a job execution is considered successfully complete only when all of its constituent tasks have successfully concluded6.  
The documentation clearly stipulates that there is no explicit timeout configured at the macro "Job" level6. Instead, execution time limits are strictly enforced at the micro "Task" level6.

### **Maximum Execution Horizons**

The task timeout defines the absolute maximum duration a single task container is permitted to run before the Cloud Run infrastructure sends a SIGTERM signal (initiating a 10-second graceful shutdown window), followed by a hard SIGKILL termination2. The limits for these timeouts are defined in the task timeout documentation (https://docs.cloud.google.com/run/docs/configuring/task-timeout):

* **Default Task Timeout:** If no custom timeout configuration is explicitly provided during deployment, each task within a Cloud Run Job defaults to a maximum execution time of 10 minutes (600 seconds)6.  
* **Maximum Task Timeout:** Administrators can adjust the task timeout upward to an absolute maximum of 168 hours, which equates to exactly 7 days6.  
* **Hardware-Specific Constraints:** If the job task is configured to utilize specialized hardware accelerators, specifically GPUs (e.g., NVIDIA L4 or RTX Pro 6000), the maximum allowable task timeout is drastically reduced to 1 hour6.

For a web scraping workload, the 168-hour maximum task timeout provides a near-infinite operational runway compared to the maximum 60-minute timeout historically associated with Cloud Run Services (and the default 5-minute timeout for Cloud Run functions).

### **Configuring Timeouts and Parallelism Dynamics**

The task timeout parameter can be configured dynamically per job using standard infrastructure-as-code or command-line tooling. Timeouts are specified as an integer value representing seconds, minutes, or hours6. For example, setting a timeout of 10 minutes and 5 seconds requires inputting 605 seconds6.  
When migrating a monolithic scraping script, architects often redesign the application into a distributed batch process. A single Cloud Run Job can be configured to execute up to 10,000 tasks7. These tasks can run in parallel, maximizing throughput. Each task is injected with environment variables—specifically CLOUD\_RUN\_TASK\_INDEX (a zero-indexed integer) and CLOUD\_RUN\_TASK\_COUNT (the total number of tasks)—allowing the application code to dynamically shard the scraping workload (e.g., "I am task 5 of 100, I will scrape URLs 500-600")1.  
When executing parallel tasks, the task timeout setting applies identically and entirely independently to *each* individual task6. If a job execution consists of an array of 50 tasks with a configured timeout of 2 hours, all 50 tasks independently receive their own 2-hour window. If 49 tasks complete in 15 minutes, but the target server throttles the 50th task causing it to hang, only that specific 50th task will be forcefully terminated when it hits the 2-hour threshold6.

## **Real-Time Telemetry and Progress Reporting: Official Documentation vs. Architectural Inference**

A core functional requirement of the requested architecture is the ability for a Next.js web application to display live, near-real-time progress of the scraping job to a user in the browser. The preferred mechanism for this is Server-Sent Events (SSE). Because a Cloud Run Job runs entirely asynchronously in the background and is strictly prohibited from opening an HTTP ingress port to serve inbound requests1, the Next.js application cannot establish a direct SSE connection to the running job container.

### **Status of the Documented Pattern**

**Explicit Confirmation:** Reviewing the current, authoritative Google Cloud documentation across all provided materials, there is **no documented pattern** or official reference architecture describing a Cloud Run Job writing progress checkpoints to Firestore (or any other specific datastore) that a separate web application subsequently polls or subscribes to in order to relay Server-Sent Events to a browser client. The documentation does not address SSE, Next.js real-time updates, or Firestore polling architectures within the specific context of Cloud Run Jobs.  
The official documentation regarding job observability focuses strictly on infrastructure-level metrics and platform telemetry. According to the job management documentation (https://docs.cloud.google.com/run/docs/managing/jobs), Cloud Run Jobs natively support integration with the Google Cloud operations suite. Executions automatically write standard output (stdout) and standard error (stderr) logs to Cloud Logging, and performance metrics (CPU and memory utilization) are piped directly to Cloud Monitoring1. The Cloud Run Console provides a "History" tab detailing task execution status, a "Logs" tab for application output, and a "Metrics" tab for resource utilization9. While powerful for DevOps engineers, these native mechanisms are not designed to be exposed directly to end-user browser clients via SSE for application-level progress bars.

### **Architectural Inference for Real-Time Progress Reporting**

While not officially presented as a documented pattern in the Cloud Run Jobs literature, establishing an intermediary data layer is standard, foundational architectural practice for decoupled, asynchronous distributed systems. Because a job cannot serve incoming HTTP traffic, an outbound push mechanism must be explicitly implemented within the application code of the scraping container itself.  
To satisfy the user requirement, the architecture must infer the following workflow, which relies entirely on supported Google Cloud primitives, even if the specific combination is not explicitly codified as a single tutorial in the Cloud Run documentation:

> 1. **State Initialization:** The Next.js API route, acting as the orchestrator, programmatically triggers the Cloud Run Job. During this invocation, it generates a unique identifier (e.g., job\_id or execution\_id). This ID is passed to the job as an environment variable override (discussed in the next section). Concurrently, the Next.js app creates a document in Firestore keyed by this job\_id, initializing the status to "pending."  
> 2. **Datastore Checkpoints (The Job):** As the scraping container iterates through its workload, it utilizes a Google Cloud Client Library (e.g., the Node.js or Python Firestore SDK) to perform periodic update() operations on the specific Firestore document. The payload might include quantitative metrics (e.g., percentage\_complete: 45), current status (e.g., current\_action: "Parsing paginated results"), or partial data payloads.  
> 3. **Client Subscription (The Browser):** The end-user's browser establishes a unidirectional SSE connection to a dedicated Next.js API route (e.g., /api/job-status?id=123).  
> 4. **Event Relay (Next.js):** The Next.js API route utilizes the Firestore SDK's onSnapshot() listener to subscribe to changes on the specific job\_id document. This creates a persistent gRPC stream between the Next.js backend and the Firestore database. As the Cloud Run Job writes updates to Firestore, the Firestore real-time listener instantly triggers within the Next.js backend. The Next.js server subsequently formats this data into text/event-stream format and flushes it down the open SSE connection to the browser.

This architecture fundamentally relies on Firestore's real-time synchronization capabilities rather than any specific native feature of Cloud Run Jobs. The Cloud Run Job merely acts as a standard, authenticated client writing to a database. As long as the Cloud Run Job's assigned Service Identity (Service Account) has the requisite IAM permissions (e.g., roles/datastore.user) to write to Firestore, this inferred architecture is highly robust, scalable, and fully viable.

## **Programmatic Invocation and Execution Overrides**

To achieve a seamless user experience, the Next.js application must be capable of instantiating the scraping job dynamically, passing context-specific parameters such as the target URL to scrape, session tokens, or search criteria. Cloud Run Jobs fully support programmatic invocation via REST APIs and official client libraries, as detailed in the execution documentation (https://docs.cloud.google.com/run/docs/execute/jobs)10.

### **Invocation Mechanisms**

A Next.js application, executing within a Node.js runtime environment, can trigger a Cloud Run Job using several programmatic approaches:

> 1. **Cloud Client Libraries:** Google provides native, idiomatic client libraries for Node.js (alongside Go, Java, Python, Ruby, PHP, and .NET)10. This is the recommended approach for a Next.js backend, providing robust type safety, automated retry logic for API calls, and built-in authentication handling via Application Default Credentials (ADC).  
> 2. **REST API Executions:** The Next.js backend can alternatively construct raw HTTP POST requests to the Cloud Run Admin API. The specific endpoint for triggering a job execution is the projects.locations.jobs.run method in the v2 API suite (or namespaces.jobs.run in the legacy v1 API)11.  
   * **Endpoint Format:** https://run.googleapis.com/v2/projects/PROJECT\_ID/locations/REGION/jobs/JOB\_NAME:run1.

Furthermore, the API allows for immediate execution upon job creation or update by utilizing a startExecutionToken in the job YAML or API payload. This unique string suffix ensures that the execution starts the moment the job definition is applied, with the platform guaranteeing that the sum of the job name and token length remains under 63 characters1.

### **Applying Overrides for Dynamic Executions**

When an application orchestrator triggers a job, it almost always needs to alter the job's behavior for that specific execution without permanently modifying the underlying job template. This is crucial for a scraping workload, where every user-initiated execution targets a different domain or requires varying timeout tolerances.  
The run API method accepts an overrides object within the request payload11. Overrides allow the invoking service to temporarily inject new parameters specifically for the lifecycle of that single execution1.  
According to the REST API documentation (https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run), the Next.js application can override the following specific parameters via the ContainerOverride object:

* **Arguments (args\[\]):** Arguments passed directly to the container entrypoint, effectively dictating the command-line flags the scraping script receives11.  
* **Environment Variables (env\[\]):** Injecting key-value pairs at runtime. This is the ideal method for passing the job\_id (for Firestore progress reporting) and the TARGET\_URL1.  
* **Task Count (taskCount):** Dynamically scaling the number of parallel tasks based on the anticipated size of the workload (e.g., requesting 50 tasks for a deep scrape, but only 1 task for a shallow scrape)11.  
* **Task Timeout (timeout):** Setting a specific maximum execution time string (e.g., "3600s") for this exact run11.

A JSON representation of the REST request payload constructed by the Next.js backend would resemble the following structure:

JSON  
{  
  "overrides": {  
    "containerOverrides": \[  
      {  
        "env": \[  
          {"name": "TARGET\_URL", "value": "https://example-data-source.com"},  
          {"name": "EXECUTION\_ID", "value": "uuid-1234-5678"}  
        \]  
      }  
    \],  
    "taskCount": 5,  
    "timeout": "1800s"  
  }  
}

### **Identity and Access Management (IAM) Security Boundaries**

Security boundaries within Google Cloud dictate that the Next.js application cannot trigger the job anonymously. The service identity (Service Account) operating the Next.js application must be explicitly granted specific IAM roles on the target Cloud Run Job resource10. The precise permissions required are detailed in the IAM permissions documentation (https://docs.cloud.google.com/run/docs/reference/iam/permissions).  
To execute a job, the invoking Service Account requires a nuanced set of permissions depending on the nature of the invocation:

| Required IAM Permission | Operational Description | Predefined Roles Containing the Permission |
| :---- | :---- | :---- |
| run.jobs.run | Required to invoke (execute) standard job executions without any runtime modifications12. | **Cloud Run Invoker** (roles/run.invoker)10 **Cloud Run Developer** (roles/run.developer)10 **Cloud Run Jobs Executor** (roles/run.jobsExecutor)14 |
| run.jobs.runWithOverrides | Required to override job configurations (env vars, args, timeouts) for a specific execution11. | **Cloud Run Developer** (roles/run.developer)15 **Cloud Run Jobs Executor With Overrides** (roles/run.jobsExecutorWithOverrides)14 |

This distinction is of paramount importance. If the Next.js application merely possesses the Cloud Run Invoker role, any attempt to pass environment variables (like the target URL) via the overrides object will result in an HTTP 403 Forbidden error. Because the architecture *requires* passing dynamic state, the Next.js service account **must** possess the run.jobs.runWithOverrides permission. Administrators should bind the roles/run.jobsExecutorWithOverrides role to the Next.js service account, adhering to the principle of least privilege, as granting the full roles/run.developer role would unnecessarily allow the Next.js app to delete or modify the foundational job template11.

## **Economic Implications: Pricing Models, Quotas, and Free Tiers**

When re-architecting from Cloud Run Services to Cloud Run Jobs for an infrequent (e.g., a few times a week), multi-minute scraping workload, the financial implications are drastically shaped by the difference between request-based and instance-based billing structures. The precise economic model is outlined in the Google Cloud Run pricing documentation (https://cloud.google.com/run/pricing).

### **Billing Structure and Granularity**

Cloud Run charges for resources based on actual consumption, rounded up to the nearest 100 milliseconds17. The fundamental difference lies in *what* portion of the container's lifecycle is considered billable time.

* **Services (Request-Based Billing):** Instances are charged specifically when they process requests, when they start up, and when they shut down1. If a minimum instance count (min-instances) is configured to keep instances "warm" in the background to avoid cold starts, this idle time is charged, but at a significantly reduced rate (e.g., $0.0000025 per vCPU-second for idle time versus $0.000024 for active processing time)17.  
* **Jobs (Instance-Based Billing):** Instances are charged for their entire lifecycle at the active rate1. There is no concept of "idle time pricing" for Cloud Run Jobs because jobs do not wait for incoming requests. The billing meter starts the millisecond the container task begins execution and stops precisely when the task process exits or is terminated1.

### **Unit Cost Comparison**

Based on the default, on-demand consumption models in the us-central1 region (without applying multi-year Committed Use Discounts (CUDs)), the unit pricing yields a surprising economic advantage for Jobs:

| Resource Metric | Cloud Run Services (Request-Based Active Time) | Cloud Run Services (Request-Based Idle Time) | Cloud Run Jobs (Instance-Based Continuous Time) |
| :---- | :---- | :---- | :---- |
| **CPU** (per vCPU-second) | $0.00002417 | $0.000002517 | $0.00001817 |
| **Memory** (per GiB-second) | $0.000002517 | $0.000002517 | $0.00000217 |
| **Requests** (per 1,000,000) | $0.4017 | N/A | N/A |

Notably, the unit cost for active vCPU time on a Cloud Run Job ($0.000018) is mathematically *cheaper* than the active vCPU time on a Cloud Run Service ($0.000024)17. For a scraping workload that is intensely running and actively computing for several minutes, the Job architecture is fundamentally more economical per compute-second than attempting to force a Service to process a synthetic, long-lived HTTP request.

### **The Free Tier Advantage**

Both compute modalities offer a generous monthly free tier, which is aggregated across all projects tethered to a specific billing account, resetting at the beginning of each calendar month17.

* **Services Free Tier:** Provides the first 180,000 vCPU-seconds and 360,000 GiB-seconds per month for free, in addition to 2 million free HTTP requests17.  
* **Jobs Free Tier:** Provides the first 240,000 vCPU-seconds and 450,000 GiB-seconds per month completely free of charge17.

For an infrequent workload defined as running "a few times a week" for "multiple minutes," the total compute consumption is remarkably low relative to the free tier allowances.  
To illustrate, consider a moderately heavy job that runs 3 times a week, taking exactly 15 minutes (900 seconds) each execution, configured with 2 vCPUs and 2 GiB of memory:

* **Total executions per month:** \~13  
* **Total vCPU-seconds:** 13 runs × 900 seconds × 2 vCPU \= 23,400 vCPU-seconds.  
* **Total GiB-seconds:** 13 runs × 900 seconds × 2 GiB \= 23,400 GiB-seconds.

At 23,400 vCPU-seconds, this theoretical scraping workload utilizes less than 10% of the 240,000 vCPU-seconds provided in the monthly Jobs Free Tier17. Therefore, the direct compute cost of this sporadic scraping architecture on Cloud Run Jobs will effectively be $0.00. (Note: External costs such as outbound internet data transfer—which uses the Premium Network Service Tier and offers a 1GiB free data transfer tier within North America per month—and Firestore read/write operations are billed separately under their respective product pricing)17.  
Administrators should be aware that if the overarching Cloud Billing account reaches a configured budget spend cap, Google Cloud imposes a hard halt on operations: any new job task executions will fail to start, and any currently in-progress tasks will be abruptly terminated1.

## **Fault Tolerance, Idempotency, and Retry Mechanics**

When orchestrating external HTTP requests for web scraping, transient failures are an absolute certainty. Target websites may implement aggressive rate limiting (returning HTTP 429), TCP connections may be reset by the peer server18, DNS resolution may temporarily fail, or the scraping logic itself might encounter malformed DOM structures causing unexpected application crashes or Out of Memory (OOM) errors18. Handling these partial failures dictates the reliability and data integrity of the system.

### **The Danger of Unintended Infrastructure Retries**

In the context of data extraction, partial completion of a task is often non-idempotent. Idempotency is the property of an operation whereby applying it multiple times yields the same result as applying it once. If a job executes for 10 minutes, successfully writes 500 parsed records to a database, and then crashes on the 501st record due to a memory limit exception1, blindly restarting the task from the beginning is highly destructive. It could result in duplicated data insertion, corrupted state logic, or triggering anti-bot bans from the target server due to repetitive identical requests, unless the application logic is meticulously engineered to handle upserts and checkpoint resumption.  
To prevent uncontrolled crash loops, Cloud Run implements infrastructure-level retry logic. According to the maximum retries documentation (https://docs.cloud.google.com/run/docs/configuring/max-retries), the default maximum retries setting for a Cloud Run Job is **3**7. This means that if a task process exits with a non-zero status code (indicating a failure), the Cloud Run infrastructure will automatically recreate the container instance and start the entrypoint script again, up to three additional times, before permanently marking the task as failed19.  
Crucially, this retry setting is applied *per-task*, not per-job19. If a job relies on parallel processing across 10 tasks, and one specific task fails repeatedly, only that specific task is retried. If that single task fails beyond its maximum retry limit, the entire job execution is marked as failed, even if the other 9 tasks succeeded perfectly1.

### **Disabling and Customizing Retry Behavior**

If the scraping workload is not strictly idempotent and partial completion should absolutely not automatically trigger a restart from the beginning, the default infrastructure-level retry behavior must be explicitly disabled.  
To disable retries, the system administrator must configure the maximum retries value to **0**19. When configured to 0, the task will execute exactly once. If it encounters a fatal error, it will immediately stop, and the task will be marked as failed without any automatic platform restarts19.  
This configuration can be applied seamlessly across all standard deployment surfaces:

| Configuration Tool | Method for Disabling Retries |
| :---- | :---- |
| **Google Cloud Console** | Navigate to the job's properties \-\> "Containers, Connections, Security" \-\> "General" tab. Change the integer in the retries field from the default 3 to 019. |
| **gcloud CLI** | Append the flag \--max-retries=0 during job creation or when updating an existing job (e.g., gcloud run jobs update JOB\_NAME \--max-retries 0\)19. |
| **YAML Specification** | Define maxRetries: 0 underneath the spec.template.spec block in the job configuration file19. |
| **Terraform** | Set max\_retries \= 0 within the template.template block of the google\_cloud\_run\_v2\_job resource definition19. |

By disabling retries at the infrastructure layer, architectural control is successfully shifted back to the application layer (the Next.js application or the scraping script itself). If the Next.js backend detects a failed job execution (via a terminal state written to Firestore), the application layer can intelligently assess the partial state, notify the end-user via the SSE stream that an error occurred, and decide whether to prompt the user for a manual retry or gracefully degrade the user interface.

## **Conclusion**

The proposed migration from a Cloud Run Service to a Cloud Run Job is not merely feasible; it is the architecturally sound and platform-recommended implementation for the specified workload. Cloud Run Services are explicitly engineered and optimized for rapid, synchronous request/response cycles. Their underlying compute management mechanics, such as Adaptive Concurrency Tuning (ACT) and request-based CPU throttling, actively conflict with the nature of multi-minute, asynchronous web scraping.  
Conversely, Cloud Run Jobs natively accommodate the workload's operational profile. Based on this exhaustive analysis of the official Google Cloud documentation, the following strategic conclusions are drawn:

> 1. **Guaranteed CPU Allocation:** Cloud Run Jobs utilize instance-based billing exclusively, guaranteeing that the configured CPU limits are fully and continuously allocated for the entire duration of the task lifecycle, completely independent of incoming network requests1. This definitively eliminates the CPU starvation anomalies currently experienced on the HTTP service.  
> 2. **Expansive Execution Horizons:** The maximum execution time per task is a staggering 168 hours (7 days), provided GPUs are not utilized6. This provides an immense operational buffer for unpredictable network latency, pagination, and rate-limit backoffs inherent to web scraping operations.  
> 3. **Real-Time Architecture Viability:** While the specific pattern of utilizing Firestore to relay job progress to a Next.js frontend via Server-Sent Events is an inferred architectural design rather than an officially documented Cloud Run pattern, it utilizes standard, fully supported Google Cloud SDKs. The Job acts as a background writer to Firestore, and the Next.js app operates as a real-time gRPC subscriber, resulting in a highly robust telemetry pipeline.  
> 4. **Programmatic Agility and Security:** The Next.js application can seamlessly trigger these jobs programmatically, but its Service Account must be specifically granted the run.jobs.runWithOverrides IAM permission11. This precise permission is strictly required to dynamically inject targeted scraping URLs or session parameters into each specific job execution as environment variables at runtime1.  
> 5. **Economic Superiority:** Due to the generous 240,000 vCPU-second monthly free tier17, executing this multi-minute workload a few times a week will likely incur zero direct compute costs. Furthermore, the active-time unit cost of a Job is mathematically lower than that of a Service, ensuring long-term financial efficiency17.  
> 6. **Controlled Failure States:** Because web scraping state is often difficult to roll back cleanly, the default 3-retry infrastructure mechanism poses a significant data corruption risk if the code is not perfectly idempotent19. Administrators must deploy the Job with the \--max-retries=0 flag19 to prevent automated, blind container restarts, allowing the application layer to handle error states intelligently.

By leveraging Cloud Run Jobs, the system successfully decouples long-running compute requirements from user-facing HTTP request lifecycles, ensuring sustained processing power, economic efficiency, and architectural resilience.

#### **Works cited**

> 1. Billing settings for services | Cloud Run | Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/configuring/billing-settings](https://docs.cloud.google.com/run/docs/configuring/billing-settings)  
> 2. Container runtime contract | Cloud Run | Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/container-contract](https://docs.cloud.google.com/run/docs/container-contract)  
> 3. Configure CPU limits for services | Cloud Run, [https://docs.cloud.google.com/run/docs/configuring/services/cpu](https://docs.cloud.google.com/run/docs/configuring/services/cpu)  
> 4. About instance autoscaling in Cloud Run services, [https://docs.cloud.google.com/run/docs/about-instance-autoscaling](https://docs.cloud.google.com/run/docs/about-instance-autoscaling)  
> 5. Configure CPU limits for jobs | Cloud Run, [https://docs.cloud.google.com/run/docs/configuring/jobs/cpu](https://docs.cloud.google.com/run/docs/configuring/jobs/cpu)  
> 6. Set task timeout for jobs | Cloud Run, [https://docs.cloud.google.com/run/docs/configuring/task-timeout](https://docs.cloud.google.com/run/docs/configuring/task-timeout)  
> 7. Create jobs | Cloud Run \- Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/create-jobs](https://docs.cloud.google.com/run/docs/create-jobs)  
> 8. Best practices: Cloud Run jobs with GPUs, [https://docs.cloud.google.com/run/docs/configuring/jobs/gpu-best-practices](https://docs.cloud.google.com/run/docs/configuring/jobs/gpu-best-practices)  
> 9. Manage jobs | Cloud Run \- Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/managing/jobs](https://docs.cloud.google.com/run/docs/managing/jobs)  
> 10. Execute jobs | Cloud Run \- Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/execute/jobs](https://docs.cloud.google.com/run/docs/execute/jobs)  
> 11. Method: projects.locations.jobs.run \- Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run)  
> 12. Method: namespaces.jobs.run \- Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/reference/rest/v1/namespaces.jobs/run](https://docs.cloud.google.com/run/docs/reference/rest/v1/namespaces.jobs/run)  
> 13. Cloud Run IAM permissions | Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/reference/iam/permissions](https://docs.cloud.google.com/run/docs/reference/iam/permissions)  
> 14. Access control with IAM | Cloud Run \- Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/securing/managing-access](https://docs.cloud.google.com/run/docs/securing/managing-access)  
> 15. Cloud Run IAM roles | Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/reference/iam/roles](https://docs.cloud.google.com/run/docs/reference/iam/roles)  
> 16. Cloud Run audit logging \- Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/audit-logging](https://docs.cloud.google.com/run/docs/audit-logging)  
> 17. Cloud Run pricing | Google Cloud, [https://cloud.google.com/run/pricing](https://cloud.google.com/run/pricing)  
> 18. Troubleshoot Cloud Run issues \- Google Cloud Documentation, [https://docs.cloud.google.com/run/docs/troubleshooting](https://docs.cloud.google.com/run/docs/troubleshooting)  
> 19. [https://docs.cloud.google.com/run/docs/configuring/max-retries](https://docs.cloud.google.com/run/docs/configuring/max-retries)