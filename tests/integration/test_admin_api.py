import pytest
from httpx import AsyncClient, ASGITransport
from api.main import app, CANDIDATES_DIR, PRODUCTS_DIR
import os
import json

@pytest.mark.anyio
async def test_candidate_crud_lifecycle():
    # Use ASGITransport as mandated
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Create a candidate
        payload = {
            "product_name": "Integration Test Candidate",
            "vendor_name": "Test Vendor",
            "product_description": "A test description"
        }
        response = await ac.post("/admin/candidates", json=payload)
        assert response.status_code == 200
        slug = response.json()["slug"]
        assert slug == "integration-test-candidate"
        
        # 2. List candidates
        response = await ac.get("/admin/candidates")
        assert response.status_code == 200
        candidates = response.json()
        assert any(c["slug"] == slug for c in candidates)
        
        # 3. Get candidate detail
        response = await ac.get(f"/admin/candidates/{slug}")
        assert response.status_code == 200
        assert response.json()["product_name"] == "Integration Test Candidate"
        
        # 4. Update candidate
        updated_payload = payload.copy()
        updated_payload["product_description"] = "Updated description"
        response = await ac.put(f"/admin/candidates/{slug}", json=updated_payload)
        assert response.status_code == 200
        
        response = await ac.get(f"/admin/candidates/{slug}")
        assert response.json()["product_description"] == "Updated description"
        
        # 5. Delete candidate
        response = await ac.delete(f"/admin/candidates/{slug}")
        assert response.status_code == 200
        
        response = await ac.get(f"/admin/candidates/{slug}")
        assert response.status_code == 404

@pytest.mark.anyio
async def test_product_save_and_list():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        payload = {
            "product_name": "Integration Test Product",
            "vendor_name": "Test Vendor"
        }
        # Save product
        response = await ac.post("/admin/products", json=payload)
        assert response.status_code == 200
        slug = response.json()["slug"]
        
        # List products
        response = await ac.get("/admin/products")
        assert response.status_code == 200
        products = response.json()
        assert any(p["slug"] == slug for p in products)
        
        # Cleanup (manual since we don't have a product delete endpoint yet, 
        # but we can verify it exists in PRODUCTS_DIR)
        file_path = PRODUCTS_DIR / f"{slug}.json"
        if file_path.exists():
            file_path.unlink()

@pytest.mark.anyio
async def test_cors_preflight_delete():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # OPTIONS request for a DELETE endpoint
        headers = {
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "DELETE",
            "Access-Control-Request-Headers": "Content-Type",
        }
        response = await ac.options("/admin/candidates/some-slug", headers=headers)
        assert response.status_code == 200
        assert "DELETE" in response.headers.get("access-control-allow-methods", "")
