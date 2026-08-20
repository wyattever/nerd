import requests
import json
import sys

def main():
    if len(sys.argv) < 2:
        print("Usage: python tests/test_sse.py <job_id>")
        sys.exit(1)
    job_id = sys.argv[1]
    url = f"http://localhost:8000/jobs/{job_id}"

    print(f"Streaming events for {url}...")
    try:
        response = requests.get(url, stream=True, timeout=30)
        for line in response.iter_lines():
            if line:
                print(line.decode("utf-8"))
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
