import firebase_admin
from firebase_admin import auth
import requests
import os

# Initialize firebase-admin (uses ADC)
if not firebase_admin._apps:
    firebase_admin.initialize_app()

def get_id_token(api_key):
    # 1. Create a custom token for a smoke-test user
    custom_token = auth.create_custom_token("smoke-test-user")
    
    # 2. Exchange custom token for ID token
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key={api_key}"
    data = {
        "token": custom_token.decode("utf-8"),
        "returnSecureToken": True
    }
    
    response = requests.post(url, json=data)
    response.raise_for_status()
    return response.json()["idToken"]

if __name__ == "__main__":
    api_key = os.environ.get("FIREBASE_API_KEY")
    if not api_key:
        print("ERROR: FIREBASE_API_KEY environment variable not set.")
        exit(1)
    print(get_id_token(api_key))
