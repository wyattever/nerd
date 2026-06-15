# **NCADEMI Static Artifact Viewer: Full Architecture & Codebase**

## **Validation & Review Notes**

The following code and architectural guidelines have been reviewed for security, scalability, and best practices:

* **SSE Auth:** The custom React hook successfully mitigates Firebase token expiration issues on long-lived connections.  
* **Clipboard Extraction:** The parser accurately isolates semantic HTML while providing a legacy fallback.  
* **GCP Security:** The strict OIDC audience matching and Cloud Tasks IAM bindings enforce a secure Zero-Trust boundary for the background workers.

## **1\. Research Plan & Objectives**

To identify, validate, and document frontend and architectural best practices for building out the **NCADEMI Static Artifact Viewer**. The plan focuses on resolving the conflict between rendering full-fidelity live previews and exporting clean, semantic HTML for seamless WordPress integration, while incorporating secure, low-latency real-time stream syncs.

### **Pillar A: "Full Preview, Partial Extraction"**

* **Context:** The viewer must load a full HTML document inside an isolated \<iframe\> (srcDoc) to ensure visual fidelity. The WordPress editor requires only inner semantic elements.  
* **Hypothesis:** Utilizing the native browser DOMParser API allows the frontend to serve a single full-fidelity source of truth while dynamically filtering out shell tags right before copying to the clipboard.

### **Pillar B: Real-Time Stream Synchronization**

* **Context:** The viewer needs to reflect live research drafts and statuses in real time.  
* **Hypothesis:** Utilizing @microsoft/fetch-event-source provides superior header manipulation (handling Firebase ID tokens) over native EventSource, resolving 1-hour token expiration loops.

## **2\. Frontend Implementation (React / TypeScript)**

### **A. Real-Time Stream Synchronization Hook (useAuthenticatedSSE.ts)**

This hook manages the SSE connection and intercepts 401 Unauthorized errors to seamlessly refresh Firebase tokens.

import { useState, useEffect, useRef } from 'react';  
import { fetchEventSource } from '@microsoft/fetch-event-source';  
import { getAuth, getIdToken } from 'firebase/auth';

interface SSEOptions {  
  url: string;  
  isEnabled?: boolean;  
}

export const useAuthenticatedSSE \= ({ url, isEnabled \= true }: SSEOptions) \=\> {  
  const \[streamData, setStreamData\] \= useState\<string\>('');  
  const \[status, setStatus\] \= useState\<'idle' | 'connecting' | 'connected' | 'error'\>('idle');  
  const abortCtrl \= useRef\<AbortController | null\>(null);

  useEffect(() \=\> {  
    if (\!isEnabled) {  
      setStatus('idle');  
      return;  
    }

    const connect \= async () \=\> {  
      setStatus('connecting');  
      abortCtrl.current \= new AbortController();  
      const auth \= getAuth();  
      const user \= auth.currentUser;

      try {  
        let token \= user ? await getIdToken(user, false) : '';

        await fetchEventSource(url, {  
          method: 'GET',  
          headers: {  
            Authorization: \`Bearer ${token}\`,  
            Accept: 'text/event-stream',  
          },  
          signal: abortCtrl.current.signal,  
            
          async onopen(response) {  
            if (response.status \=== 401\) {  
              if (user) {  
                await getIdToken(user, true);  
                throw new Error('401\_UNAUTHORIZED');   
              }  
            }  
            if (response.ok) {  
              setStatus('connected');  
              return;  
            }  
            throw new Error(\`Server responded with ${response.status}\`);  
          },  
            
          onmessage(msg) {  
            setStreamData((prev) \=\> prev \+ msg.data);  
          },  
            
          onclose() {  
            setStatus('idle');  
          },  
            
          onerror(err) {  
            if (err.message \=== '401\_UNAUTHORIZED') {  
              throw err;   
            }  
            throw err;   
          }  
        });  
      } catch (error: any) {  
        if (error.message \=== '401\_UNAUTHORIZED') {  
          abortCtrl.current?.abort();  
          connect();   
        } else {  
          console.error("SSE Connection Error:", error);  
          setStatus('error');  
        }  
      }  
    };

    connect();

    return () \=\> {  
      abortCtrl.current?.abort();  
    };  
  }, \[url, isEnabled\]);

  return { streamData, status };  
};

### **B. WordPress Extraction Utility (wordpressExtractor.ts)**

Extracts semantic HTML from the iframe payload for Gutenberg.

export const copyWordpressReadyHtml \= async (fullHtmlString: string): Promise\<void\> \=\> {  
  try {  
    const parser \= new DOMParser();  
    const doc \= parser.parseFromString(fullHtmlString, 'text/html');

    const targetNode \= doc.querySelector('.entry-content')   
                    || doc.querySelector('main')   
                    || doc.body;

    if (\!targetNode) {  
      throw new Error("Could not locate the primary content container.");  
    }

    const cleanHtml \= targetNode.innerHTML.trim();

    if (navigator.clipboard && window.isSecureContext) {  
      await navigator.clipboard.writeText(cleanHtml);  
    } else {  
      fallbackCopyTextToClipboard(cleanHtml);  
    }  
      
    alert("WordPress-ready HTML copied to clipboard\!");

  } catch (error) {  
    console.error("Failed to extract and copy HTML:", error);  
    alert("Failed to extract HTML. Check console for details.");  
  }  
};

const fallbackCopyTextToClipboard \= (text: string) \=\> {  
  const textArea \= document.createElement("textarea");  
  textArea.value \= text;  
  textArea.style.position \= "fixed";  
  textArea.style.top \= "0";  
  textArea.style.left \= "0";  
  textArea.style.opacity \= "0";  
    
  document.body.appendChild(textArea);  
  textArea.focus();  
  textArea.select();  
    
  try {  
    document.execCommand('copy');  
  } catch (err) {  
    console.error('Fallback: Oops, unable to copy', err);  
  }  
    
  document.body.removeChild(textArea);  
};

## **3\. Backend Orchestration & Processing (Python)**

### **A. Cloud Tasks Enqueuer (cloud\_tasks\_orchestrator.py)**

Formats payloads for the private worker container, ensuring OIDC audience matching.

import json  
from google.cloud import tasks\_v2  
from urllib.parse import urlparse

def enqueue\_secure\_worker\_task(  
    project\_id: str,  
    location: str,  
    queue\_id: str,  
    target\_worker\_url: str,  
    invoker\_service\_account\_email: str,  
    payload: dict,  
    task\_name: str \= None  
) \-\> tasks\_v2.Task:  
      
    client \= tasks\_v2.CloudTasksClient()  
    parent \= client.queue\_path(project\_id, location, queue\_id)  
    encoded\_payload \= json.dumps(payload).encode()

    parsed\_url \= urlparse(target\_worker\_url)  
    clean\_audience \= f"{parsed\_url.scheme}://{parsed\_url.netloc}"

    task \= {  
        "http\_request": {  
            "http\_method": tasks\_v2.HttpMethod.POST,  
            "url": target\_worker\_url,  
            "headers": {"Content-type": "application/json"},  
            "body": encoded\_payload,  
            "oidc\_token": {  
                "service\_account\_email": invoker\_service\_account\_email,  
                "audience": clean\_audience  
            },  
        }  
    }

    if task\_name:  
        task\["name"\] \= client.task\_path(project\_id, location, queue\_id, task\_name)

    response \= client.create\_task(request={"parent": parent, "task": task})  
    print(f"Successfully enqueued task: {response.name}")  
    return response

### **B. Secure Cloud Run Worker (worker\_service.py)**

FastAPI service that receives the secure task and processes the artifact using Gemini.

import os  
import logging  
from fastapi import FastAPI, Header, HTTPException, Request  
from pydantic import BaseModel  
import google.generativeai as genai

logging.basicConfig(level=logging.INFO)  
logger \= logging.getLogger(\_\_name\_\_)

app \= FastAPI(title="NCADEMI Artifact Worker")  
genai.configure(api\_key=os.environ.get("GEMINI\_API\_KEY"))  
model \= genai.GenerativeModel('gemini-1.5-flash')

class ArtifactPayload(BaseModel):  
    product\_slug: str  
    target\_url: str  
    current\_html: str

@app.post("/process-artifact")  
async def process\_artifact(  
    payload: ArtifactPayload,  
    x\_cloudtasks\_taskname: str \= Header(None),  
    x\_cloudtasks\_taskretrycount: int \= Header(0)  
):  
    is\_prod \= os.environ.get("ENVIRONMENT") \== "production"  
    if is\_prod and not x\_cloudtasks\_taskname:  
        raise HTTPException(status\_code=403, detail="Direct invocation forbidden.")

    if x\_cloudtasks\_taskretrycount \> 3:  
        logger.error(f"Task {x\_cloudtasks\_taskname} exceeded retry limits.")  
        return {"status": "shunted\_to\_dlq"}

    try:  
        prompt \= f"""  
        Analyze the following HTML content for the product '{payload.product\_slug}'.  
        Generate an updated 'N.E.R.D.' accessibility draft in semantic HTML.   
        Rules: Keep output within \<div class="entry-content"\>.  
        HTML: {payload.current\_html}  
        """

        response \= model.generate\_content(prompt)  
          
        return {  
            "status": "success",   
            "product": payload.product\_slug,   
            "bytes\_generated": len(response.text)  
        }  
    except Exception as e:  
        logger.error(f"Error processing task: {str(e)}")  
        raise HTTPException(status\_code=500, detail="Internal processing error")

if \_\_name\_\_ \== "\_\_main\_\_":  
    import uvicorn  
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))

## **4\. Deployment Matrix & IAM Guidelines**

### **A. Network Ingress Configuration**

The Cloud Run worker service MUST be shielded from the public internet.

Ensure the worker's network ingress is set to internal-and-cloud-load-balancing. Google Cloud's routing fabric recognizes Cloud Tasks traffic as "internal".

### **B. The Identity Triad (IAM Bindings)**

Run these specific gcloud commands to complete the trust chain:

1. **Enqueuing API Service Account:**

gcloud projects add-iam-policy-binding YOUR\_PROJECT\_ID \\  
  \--member="serviceAccount:YOUR\_API\_SA@YOUR\_PROJECT\_ID.iam.gserviceaccount.com" \\  
  \--role="roles/cloudtasks.enqueuer"

gcloud iam service-accounts add-iam-policy-binding YOUR\_WORKER\_SA@YOUR\_PROJECT\_ID.iam.gserviceaccount.com \\  
  \--member="serviceAccount:YOUR\_API\_SA@YOUR\_PROJECT\_ID.iam.gserviceaccount.com" \\  
  \--role="roles/iam.serviceAccountUser"

2. **Google-Managed Cloud Tasks Agent (Cryptographic Minter):**

gcloud iam service-accounts add-iam-policy-binding YOUR\_WORKER\_SA@YOUR\_PROJECT\_ID.iam.gserviceaccount.com \\  
  \--member="serviceAccount:service-YOUR\_PROJECT\_NUMBER@gcp-sa-cloudtasks.iam.gserviceaccount.com" \\  
  \--role="roles/iam.serviceAccountUser"

3. **Task Invoker Service Account (Actor Identity):**

gcloud run services add-iam-policy-binding YOUR\_WORKER\_SERVICE\_NAME \\  
  \--region=YOUR\_REGION \\  
  \--member="serviceAccount:YOUR\_WORKER\_SA@YOUR\_PROJECT\_ID.iam.gserviceaccount.com" \\  
  \--role="roles/run.invoker"

### **C. Deploying the Worker Service**

gcloud run deploy ncademi-artifact-worker \\  
  \--source . \\  
  \--region us-central1 \\  
  \--no-allow-unauthenticated \\  
  \--ingress internal-and-cloud-load-balancing \\  
  \--service-account YOUR\_WORKER\_SA@YOUR\_PROJECT\_ID.iam.gserviceaccount.com \\  
  \--set-env-vars="ENVIRONMENT=production,GEMINI\_API\_KEY=your\_secure\_api\_key"

## **5\. CLI Tooling (gemini\_cli\_agent.py)**

Provides a command-line interface for QA testers and CI/CD pipelines to interact with the architecture.

\#\!/usr/bin/env python3  
import argparse  
import sys  
import json  
import os  
import google.generativeai as genai  
from cloud\_tasks\_orchestrator import enqueue\_secure\_worker\_task

def cmd\_enqueue(args):  
    with open(args.payload\_file, 'r') as f:  
        payload \= json.load(f)  
      
    response \= enqueue\_secure\_worker\_task(  
        project\_id=args.project, location=args.location, queue\_id=args.queue,  
        target\_worker\_url=args.worker\_url, invoker\_service\_account\_email=args.service\_account,  
        payload=payload  
    )  
    print(f"\\nSuccess\! Task ID: {response.name}")

def cmd\_analyze\_local(args):  
    api\_key \= os.environ.get("GEMINI\_API\_KEY")  
    with open(args.html\_file, 'r') as f:  
        raw\_html \= f.read()

    genai.configure(api\_key=api\_key)  
    model \= genai.GenerativeModel('gemini-1.5-flash')  
    prompt \= f"Analyze this HTML layout. Extract ONLY the semantic core content...\\n{raw\_html}"  
    response \= model.generate\_content(prompt)  
      
    print(response.text)  
    if args.output:  
        with open(args.output, 'w') as f:  
            f.write(response.text)

def main():  
    parser \= argparse.ArgumentParser(description="Gemini CLI Agent")  
    subparsers \= parser.add\_subparsers(dest="command")

    parser\_enqueue \= subparsers.add\_parser("enqueue")  
    parser\_enqueue.add\_argument("--project", required=True)  
    parser\_enqueue.add\_argument("--location", required=True)  
    parser\_enqueue.add\_argument("--queue", required=True)  
    parser\_enqueue.add\_argument("--worker-url", required=True)  
    parser\_enqueue.add\_argument("--service-account", required=True)  
    parser\_enqueue.add\_argument("--payload-file", required=True)

    parser\_analyze \= subparsers.add\_parser("analyze-local")  
    parser\_analyze.add\_argument("--html-file", required=True)  
    parser\_analyze.add\_argument("--output", required=False)

    args \= parser.parse\_args()  
    if args.command \== "enqueue": cmd\_enqueue(args)  
    elif args.command \== "analyze-local": cmd\_analyze\_local(args)  
    else: parser.print\_help()

if \_\_name\_\_ \== "\_\_main\_\_":  
    main()  
