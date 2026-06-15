import asyncio
import os
import sys
from pathlib import Path

# --- Path Bootstrap ---
PROJECT_ROOT = Path(__file__).parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from nerd_core.link_validator_engine import LinkValidatorEngine

async def test_engine():
    print("🚀 Starting Link Validator Engine Test...")
    engine = LinkValidatorEngine(artifacts_dir="artifacts")
    
    test_urls = [
        "https://www.google.com",                       # Should be valid
        "https://www.google.com/non-existent-page-123", # Should be invalid (404)
        "https://httpstat.us/404",                      # Explicit 404
    ]
    
    results = await engine.run(test_urls)
    
    print("\n--- Test Results ---")
    for url, res in results.items():
        status = "✅ VALID" if res.is_valid else "❌ INVALID"
        print(f"URL: {url}")
        print(f"  Status: {status}")
        print(f"  Reason: {res.reason}")
        print(f"  Screenshot: {res.screenshot_path}")
        
        if not res.is_valid and not res.screenshot_path:
            if "Navigation Error" in (res.reason or "") or "Page.goto" in (res.reason or ""):
                print(f"  ℹ️  No screenshot for network/navigation error (Expected)")
            else:
                print("  ⚠️ ERROR: No screenshot generated for invalid link!")
                sys.exit(1)
            
    print("\n✅ Link Validator Engine Test Passed.")

if __name__ == "__main__":
    asyncio.run(test_engine())
