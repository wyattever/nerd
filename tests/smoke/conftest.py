import os
import pytest
import requests

@pytest.fixture(scope="session")
def base_url():
    url = os.getenv("NERD_API_URL")
    if not url:
        pytest.exit("Set NERD_API_URL to the deployed API URL before running smoke tests.")
    return url.rstrip("/")

@pytest.fixture(scope="session")
def id_token():
    token = os.getenv("SMOKE_ID_TOKEN")
    if not token:
        # Instruction on how to obtain a token
        # POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<FIREBASE_API_KEY>
        # with {"email": "...", "password": "...", "returnSecureToken": true}
        # Use the idToken field from the response.
        pytest.exit("Set SMOKE_ID_TOKEN to a valid Firebase ID token before running smoke tests.\n"
                    "To obtain one, POST to: https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<FIREBASE_API_KEY>\n"
                    "with body: {'email': '...', 'password': '...', 'returnSecureToken': true}")
    return token

@pytest.fixture(scope="session")
def session(id_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {id_token}"})
    return s
