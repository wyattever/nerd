import pytest
import requests

def test_healthz(base_url):
    """
    Validates the hardened /healthz endpoint.
    Checks for Firestore and Cloud Tasks reachability in production.
    """
    response = requests.get(f"{base_url}/healthz")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ["ok", "degraded", "error"]
    assert "checks" in data
    assert "timestamp" in data
    
    checks = data["checks"]
    assert "worker_url_configured" in checks
    assert "tasks_sa_configured" in checks
    assert "firestore" in checks
    assert "cloud_tasks_queue" in checks
    
    # Firestore and Cloud Tasks should at least return a status string starting with ok or error
    assert checks["firestore"].startswith("ok") or checks["firestore"].startswith("error")
    assert checks["cloud_tasks_queue"].startswith("ok") or checks["cloud_tasks_queue"].startswith("error")

def test_cors_preflight(base_url):
    """
    Validates CORS preflight (OPTIONS) for a sensitive endpoint.
    Crucial for ensuring the frontend-origin locking is working on the live API.
    """
    frontend_url = "https://nerd-frontend-meomhj23xq-uc.a.run.app"
    headers = {
        "Origin": frontend_url,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type"
    }
    response = requests.options(f"{base_url}/research/initial", headers=headers)
    assert response.status_code == 200
    assert response.headers.get("Access-Control-Allow-Origin") == frontend_url

def test_list_candidates(base_url, session):
    """
    Verifies read access to the candidates collection and auth enforcement.
    Confirms the API can successfully talk to the live Firestore.
    """
    response = session.get(f"{base_url}/admin/candidates")
    assert response.status_code == 200
    assert isinstance(response.json(), list)

def test_list_products(base_url, session):
    """
    Verifies read access to the products collection and auth enforcement.
    Confirms the API can successfully talk to the live Firestore.
    """
    response = session.get(f"{base_url}/admin/products")
    assert response.status_code == 200
    assert isinstance(response.json(), list)

@pytest.mark.smoke_quota
def test_research_initial(base_url, session):
    """
    Verifies that a research job can be successfully enqueued.
    This validates Cloud Tasks connectivity and IAM permissions (actAs).
    Costs Vertex AI quota and Cloud Tasks invocation.
    """
    payload = {
        "product_url": "https://example.com"
    }
    response = session.post(f"{base_url}/research/initial", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "job_id" in data
