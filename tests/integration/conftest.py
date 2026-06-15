import os
import pytest
from unittest.mock import MagicMock, patch
from httpx import AsyncClient, ASGITransport

# Force LOCAL_MODE for baseline integration tests
os.environ["LOCAL_MODE"] = "true"
os.environ["GOOGLE_CLOUD_PROJECT"] = "test-project"

@pytest.fixture(autouse=True)
def mock_firebase_init():
    with patch("firebase_admin.initialize_app"), \
         patch("firebase_admin._apps", ["mock_app"]):
        yield

@pytest.fixture
def mock_fb_auth():
    with patch("firebase_admin.auth.verify_id_token") as mock:
        mock.return_value = {"uid": "test-user"}
        yield mock

@pytest.fixture
def mock_tasks_client():
    with patch("google.cloud.tasks_v2.CloudTasksClient") as mock:
        client_instance = MagicMock()
        mock.return_value = client_instance
        yield client_instance

import pytest_asyncio

@pytest_asyncio.fixture
async def client(mock_fb_auth, mock_tasks_client):
    from api.main import app
    # Re-import to ensure env vars are picked up if they weren't already
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
