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

