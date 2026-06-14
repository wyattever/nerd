import requests
import json
import time
import os

with open("job_id.json") as f:
    job_id = json.load(f)["job_id"]

url = f"http://localhost:8000/jobs/{job_id}"
print(f"Streaming events for {url}...")

try:
    response = requests.get(url, stream=True, timeout=60)
    for line in response.iter_lines():
        if line:
            print(line.decode('utf-8'))
            if "event: end" in line.decode('utf-8'):
                print("Job finished!")
                break
except Exception as e:
    print(f"Error: {e}")
