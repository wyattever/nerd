import asyncio
import os
import sys
import httpx
from datetime import datetime

async def verify_production():
    print("--- Starting Production Patch Verification ---")
    
    API_URL = "https://nerd-api-meomhj23xq-uc.a.run.app"
    TOKEN = os.environ.get("SMOKE_TEST_TOKEN")
    
    if not TOKEN:
        print("ERROR: SMOKE_TEST_TOKEN not set.")
        return

    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json"
    }
    
    urls = [
        "https://www.google.com",
        "https://www.thislinkisdead12345.com",
        "https://httpstat.us/404"
    ]
    
    async with httpx.AsyncClient(timeout=180.0) as client:
        print(f"Queueing validation for {len(urls)} URLs...")
        resp = await client.post(f"{API_URL}/research/validate-links-async", json={"urls": urls}, headers=headers)
        
        if resp.status_code != 200:
            print(f"FAILED to queue job: {resp.status_code} - {resp.text}")
            return
            
        job_id = resp.json()["job_id"]
        print(f"Job queued: {job_id}. Polling...")
        
        attempts = 0
        while attempts < 60:
            attempts += 1
            status_resp = await client.get(f"{API_URL}/research/validate-links/{job_id}", headers=headers)
            data = status_resp.json()
            
            if data["status"] == "complete":
                print("
Validation Complete!")
                results = data["results"]
                for url, res in results.items():
                    print(f"URL: {url}")
                    print(f"  Valid: {res['is_valid']}")
                    print(f"  Reason: {res['reason']}")
                    print(f"  Status: {res['status_code']}")
                    print("-" * 20)
                
                assert results["https://www.google.com"]["is_valid"] == True
                assert results["https://www.thislinkisdead12345.com"]["is_valid"] == False
                print("
Production Smoke Test PASSED!")
                return
            
            elif data["status"] == "error":
                print(f"Job failed: {data.get('error')}")
                return
                
            print(f"Status: {data['status']} (attempt {attempts}/60)...")
            await asyncio.sleep(5)
            
        print("Timed out waiting for production job.")

if __name__ == "__main__":
    asyncio.run(verify_production())