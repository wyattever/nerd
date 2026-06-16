import pytest
import os
from httpx import AsyncClient, ASGITransport

# Force LOCAL_MODE for integration tests
os.environ["LOCAL_MODE"] = "true"

from api.main import app

@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

@pytest.mark.anyio
async def test_candidate_crud_lifecycle(client):
    # 1. Create a candidate
    payload = {
        "product_name": "Integration Test Candidate",
        "vendor_name": "Test Vendor",
        "product_description": "A test description"
    }
    response = await client.post("/admin/candidates", json=payload)
    assert response.status_code == 200
    slug = response.json()["slug"]
    assert slug == "integration-test-candidate"
    
    # 2. List candidates
    response = await client.get("/admin/candidates")
    assert response.status_code == 200
    candidates = response.json()
    assert any(c["slug"] == slug for c in candidates)
    
    # 3. Get candidate detail
    response = await client.get(f"/admin/candidates/{slug}")
    assert response.status_code == 200
    assert response.json()["product_name"] == "Integration Test Candidate"
    
    # 4. Update candidate
    updated_payload = payload.copy()
    updated_payload["product_description"] = "Updated description"
    response = await client.put(f"/admin/candidates/{slug}", json=updated_payload)
    assert response.status_code == 200
    
    response = await client.get(f"/admin/candidates/{slug}")
    assert response.json()["product_description"] == "Updated description"
    
    # 5. Delete candidate
    response = await client.delete(f"/admin/candidates/{slug}")
    assert response.status_code == 200
    
    response = await client.get(f"/admin/candidates/{slug}")
    assert response.status_code == 404

@pytest.mark.anyio
async def test_product_crud_lifecycle(client):
    # 1. Create a product
    payload = {
        "product_name": "Integration Test Product",
        "vendor_name": "Test Vendor"
    }
    response = await client.post("/admin/products", json=payload)
    assert response.status_code == 200
    slug = response.json()["slug"]
    assert slug == "integration-test-product"
    
    # 2. List products
    response = await client.get("/admin/products")
    assert response.status_code == 200
    products = response.json()
    assert any(p["slug"] == slug for p in products)
    
    # 3. Get product detail
    response = await client.get(f"/admin/products/{slug}")
    assert response.status_code == 200
    assert response.json()["product_name"] == "Integration Test Product"

@pytest.mark.anyio
async def test_missing_slugs(client):
    # GET missing
    response = await client.get("/admin/candidates/non-existent")
    assert response.status_code == 404
    
    # PUT missing
    payload = {"product_name": "New Candidate"}
    response = await client.put("/admin/candidates/non-existent", json=payload)
    assert response.status_code == 404
    
    # DELETE missing
    response = await client.delete("/admin/candidates/non-existent")
    assert response.status_code == 404

@pytest.mark.anyio
async def test_cors_preflight(client):
    # OPTIONS request for a DELETE endpoint
    headers = {
        "Origin": "http://localhost:3000",
        "Access-Control-Request-Method": "DELETE",
        "Access-Control-Request-Headers": "Content-Type",
    }
    response = await client.options("/admin/candidates/some-slug", headers=headers)
    assert response.status_code == 200
    # The middleware should handle CORS. We just verify the headers.
    assert "DELETE" in response.headers.get("access-control-allow-methods", "")
