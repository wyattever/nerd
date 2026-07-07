from dotenv import load_dotenv
load_dotenv()
import sys
import logging
import re
from pathlib import Path

# --- Path Bootstrap ---
PROJECT_ROOT = Path(__file__).parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# --- Project Imports ---
from nerd_core.services import run_initial_research
from nerd_core.generators import parse_markdown_to_listing, generate_ncademi_html

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# --- Test Configuration ---
# Canvas is a reliable target with known vendor and third-party sources.
TEST_URL = "https://www.instructure.com/canvas"

def run_e2e_live_test():
    """
    Executes a full end-to-end research run on a live URL and verifies
    that all required sections of the NCADEMI template are correctly populated.
    """
    logger.info(f"🚀 Starting E2E Live Validation for: {TEST_URL}")
    
    try:
        # 1. Research Phase
        logger.info("Phase 1: Running live research (LLM + Google Search)...")
        draft, raw_urls = run_initial_research(TEST_URL, timeout_min=2)
        
        if not draft:
            raise ValueError("Research returned empty draft.")
        if not raw_urls:
            logger.warning("Research returned no grounding URLs. This might be a grounding failure.")

        # 2. Parsing Phase
        logger.info("Phase 2: Parsing Markdown output...")
        listing = parse_markdown_to_listing(draft)
        
        # 3. Structural Validation
        logger.info("Phase 3: Verifying NCADEMI template fields...")
        
        errors = []
        
        if not listing.product_name or listing.product_name == "Unknown Product":
            errors.append("Product Name is missing or default.")
        
        if not listing.vendor_name:
            errors.append("Vendor Name is missing.")
            
        if not listing.product_description:
            errors.append("Product Description is missing.")
            
        if not listing.vendor_resources:
            errors.append("Vendor Resources list is empty.")
            
        if not listing.other_resources:
            errors.append("Other Resources (Third-Party) list is empty.")
            
        if errors:
            logger.error("❌ E2E Validation Failed with structural errors:")
            for err in errors:
                logger.error(f"  - {err}")
            print(f"\n--- GENERATED DRAFT ---\n{draft}\n-----------------------\n")
            sys.exit(1)
            
        # 4. Artifact Generation Phase
        logger.info("Phase 4: Verifying HTML generation...")
        html = generate_ncademi_html(draft)
        
        # Check for presence of key data rather than specific HTML-encoded headers
        required_html_elements = [
            listing.product_name,
            listing.vendor_name,
            "Accessibility Conformance Reports",
            "From " + listing.vendor_name,
            "From Other Sources"
        ]
        
        for elem in required_html_elements:
            if elem not in html:
                errors.append(f"HTML is missing required element: '{elem}'")
        
        if errors:
            logger.error("❌ E2E Validation Failed during HTML verification:")
            for err in errors:
                logger.error(f"  - {err}")
            print(f"\n--- GENERATED DRAFT ---\n{draft}\n-----------------------\n")
            sys.exit(1)

        logger.info("✅ E2E Live Validation Passed: All sections populated and rendered correctly.")
        
    except Exception as e:
        logger.exception(f"❌ E2E Validation Failed with exception: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    run_e2e_live_test()