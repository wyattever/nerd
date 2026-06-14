import subprocess
import json
import http.client
import sys

def get_token():
    return subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode().strip()

def get_file_info(file_id, token):
    conn = http.client.HTTPSConnection("www.googleapis.com")
    headers = {"Authorization": f"Bearer {token}"}
    conn.request("GET", f"/drive/v3/files/{file_id}", headers=headers)
    res = conn.getresponse()
    data = res.read().decode()
    if res.status != 200:
        print(f"Error getting file {file_id}: {res.status} {data}")
        return {}
    return json.loads(data)

def update_doc_content(doc_id, text, token):
    # To replace the whole content in Google Docs:
    # 1. Get doc to find the end index
    # 2. Delete everything
    # 3. Insert new text
    
    conn = http.client.HTTPSConnection("docs.googleapis.com")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    
    # Get document to find length
    conn.request("GET", f"/v1/documents/{doc_id}", headers=headers)
    doc = json.loads(conn.getresponse().read().decode())
    
    end_index = doc.get("body", {}).get("content", [])[-1].get("endIndex", 1)
    
    requests = []
    if end_index > 2:
        requests.append({"deleteContentRange": {"range": {"startIndex": 1, "endIndex": end_index - 1}}})
    requests.append({"insertText": {"location": {"index": 1}, "text": text}})
    
    body = json.dumps({"requests": requests})
    conn.request("POST", f"/v1/documents/{doc_id}:batchUpdate", body=body, headers=headers)
    res = conn.getresponse()
    return res.status, res.read().decode()

def append_to_top(doc_id, text, token):
    conn = http.client.HTTPSConnection("docs.googleapis.com")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    
    requests = [{"insertText": {"location": {"index": 1}, "text": text + "\n\n"}}]
    body = json.dumps({"requests": requests})
    conn.request("POST", f"/v1/documents/{doc_id}:batchUpdate", body=body, headers=headers)
    res = conn.getresponse()
    return res.status, res.read().decode()

if __name__ == "__main__":
    token = get_token()
    ids = [
        "1_E1qX-PzA2QAURodox4r-y3fCMJsupcKSlHGc0k4xpo",
        "1Q7weS_GMxCkTldUniq7A1wa8QJkYtI8QHVKR9Br55BQ",
        "1vAHkmWBMplwX4V7zNvvHMxKan897vJRYDFX89-ZWVMY"
    ]
    for fid in ids:
        info = get_file_info(fid, token)
        print(f"ID: {fid}, Name: {info.get('name')}, MimeType: {info.get('mimeType')}")
