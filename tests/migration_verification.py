"""
tests/migration_verification.py — Phase 5 Byte-Fidelity Validator.

Compares the legacy nerd_core rendering logic (used by Streamlit) against 
the new FastAPI /render endpoint to ensure no regressions in HTML output.
"""

import sys
import json
import logging
from pathlib import Path
from datetime import datetime

# --- Path Bootstrap ---
PROJECT_ROOT = Path(__file__).parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from nerd_core.generators import generate_ncademi_html, parse_markdown_to_listing
from api.main import app
from fastapi.testclient import TestClient

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

client = TestClient(app)

SAMPLE_MARKDOWN = """
# Migration Test Product
**Vendor:** Fidelity Labs
**Description:** Ensuring the new API matches the legacy output exactly.
**Product Website:** https://fidelity.io

### Accessibility Resources (From Vendor)
- [Official Portal](https://fidelity.io/a11y)

### Accessibility Insights (From Third-Party Sources)
- [Review](https://review.com)

### AI Generated Insights
Description: This is a test of the AI insights section.

### Support
Support Contact: help@fidelity.io
Description: 24/7 support.

### Accessibility Conformance Reports (ACR / VPAT)
Report Title: WCAG 2.1 Report
VPAT Version: 2.4
Date Completed: Jan 2026
Evaluating Organization: Internal
Link: [Download](https://fidelity.io/vpat)
"""

def verify_render_parity():
    logger.info("🧪 Starting Byte-Fidelity Verification...")
    
    # 1. Generate Legacy HTML (Directly via nerd_core)
    # Note: We must mock the date to ensure a stable diff
    fixed_date = "June 13, 2026"
    
    # We'll use the parser to get a dataclass, then force the date
    from nerd_core.generators import render_listing_html
    listing_dc = parse_markdown_to_listing(SAMPLE_MARKDOWN)
    listing_dc.last_updated = fixed_date
    legacy_html = render_listing_html(listing_dc)
    
    # 2. Generate API HTML (Via FastAPI /render)
    # We pass the full JSON payload
    payload = {
        "product_name": listing_dc.product_name,
        "vendor_name": listing_dc.vendor_name,
        "product_description": listing_dc.product_description,
        "product_website_url": listing_dc.product_website_url,
        "vendor_resources": [{"url": r.url, "text": r.text} for r in listing_dc.vendor_resources],
        "other_resources": [{"url": r.url, "text": r.text} for r in listing_dc.other_resources],
        "ai_insights": listing_dc.ai_insights,
        "support_contacts": [{"type": "email", "value": "help@fidelity.io", "label": ""}],
        "acr_reports": [{
            "title": "WCAG 2.1 Report",
            "url": "https://fidelity.io/vpat",
            "version": "2.4",
            "date": "Jan 2026",
            "auditor_name": "Internal",
            "auditor_url": ""
        }],
        "last_updated": fixed_date
    }
    
    response = client.post("/render", json=payload)
    if response.status_code != 200:
        logger.error(f"API Request Failed: {response.text}")
        sys.exit(1)
        
    api_html = response.json()["html"]
    
    # 3. Compare
    if legacy_html == api_html:
        logger.info("✅ SUCCESS: Byte-fidelity confirmed. HTML outputs are identical.")
    else:
        logger.error("❌ FAILURE: HTML mismatch detected!")
        
        # Simple diffing logic
        import difflib
        diff = difflib.unified_diff(
            legacy_html.splitlines(), 
            api_html.splitlines(), 
            fromfile='Legacy', 
            tofile='API'
        )
        for line in diff:
            print(line)
        
        sys.exit(1)

def verify_async_plumbing():
    """Smoke test for the async orchestration logic."""
    logger.info("🧪 Verifying API Plumbing (Mocks)...")
    
    # Check healthz
    res = client.get("/healthz")
    assert res.json()["status"] == "ok"
    
    # Check that initial research enqueues correctly (mocked tasks client in main.py)
    # We expect a 500 or warning if WORKER_URL is missing, but here we just check loading
    logger.info("✅ Plumbing verified.")

if __name__ == "__main__":
    verify_render_parity()
    verify_async_plumbing()
