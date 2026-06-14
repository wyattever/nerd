import requests
import json
import sys

job_id = sys.argv[1]
url = f"http://localhost:8000/jobs/{job_id}"

print(f"Streaming events for {url}...")
try:
    response = requests.get(url, stream=True, timeout=30)
    for line in response.iter_lines():
        if line:
            print(line.decode('utf-8'))
except Exception as e:
    print(f"Error: {e}")
