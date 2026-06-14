"""
tests/system_test.py — Automated System-Wide Verification for N.E.R.D.
========================================================================
Comprehensive test suite covering:
  1. Parser robustness (Structural mapping)
  2. Artifact fidelity (HTML/DOCX generation)
  3. Metric sanity (GEPA logic & penalties)
  4. Integration (End-to-end data flow)
"""

import json
import logging
import re
import sys
from pathlib import Path
from unittest.mock import MagicMock

# --- Path Bootstrap ---
PROJECT_ROOT = Path(__file__).parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# --- Project Imports ---
from nerd_core.generators import parse_markdown_to_listing, generate_ncademi_html, create_docx_bytes
from nerd_core.utils import normalize_url
from eval.optimize import url_recall_with_feedback

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Paths ---
PROJECT_ROOT = Path(__file__).parent.parent
EVAL_DIR     = PROJECT_ROOT / "eval"
DATASET_PATH = EVAL_DIR / "eval_data.json"
CACHE_PATH   = EVAL_DIR / "grounding_cache.json"

# --- Test Data ---
SAMPLE_MARKDOWN = """
# Test Product
**Vendor:** Test Vendor
**Description:** This is a comprehensive description of the test product's accessibility.
**Product Website:** https://test.com

### Accessibility Resources (From Vendor)
- [Official Accessibility Page](https://test.com/a11y)
- [ACR Repo](https://test.com/vpat)

### Accessibility Insights (From Third-Party Sources)
- [WebAIM Review](https://webaim.org/test)

### AI Generated Insights
Description: The product demonstrates a strong commitment to accessibility. It provides multiple help center articles and an official WCAG conformance document. Third-party reviews confirm its ease of use for screen reader users.
"""

def test_parser():
    logger.info("Running Parser Stress Test...")
    listing = parse_markdown_to_listing(SAMPLE_MARKDOWN)
    
    assert listing.product_name == "Test Product"
    assert len(listing.vendor_resources) == 2
    assert listing.vendor_resources[0].text == "Official Accessibility Page"
    assert listing.vendor_resources[0].url == "https://test.com/a11y"
    assert len(listing.other_resources) == 1
    assert "strong commitment" in listing.ai_insights
    logger.info("✅ Parser Passed")

def test_artifact_generation():
    logger.info("Running Artifact Fidelity Test...")
    
    # HTML Test
    html = generate_ncademi_html(SAMPLE_MARKDOWN)
    try:
        assert "<title>Test Product — NCADEMI EdTech Directory</title>" in html
        assert "From Test Vendor" in html
        assert "https://test.com/a11y" in html
    except AssertionError:
        logger.error(f"HTML Output mismatch. Snippet: {html[:500]} ... {html[-500:]}")
        raise
    
    # DOCX Test
    docx_bytes = create_docx_bytes(SAMPLE_MARKDOWN)
    assert len(docx_bytes) > 0
    assert docx_bytes.startswith(b"PK")  # Standard ZIP/DOCX header
    logger.info("✅ Artifact Generation Passed")

def test_metric_sanity():
    logger.info("Running Metric Sanity Check...")
    import dspy
    
    # Mock Example (Injected URLs)
    injected = ["https://test.com/a11y", "https://test.com/vpat"]
    gold = dspy.Example(
        product_name_display="Test Product",
        cached_predicted_urls=injected,
        golden_urls=injected,
        difficulty="unset",
        known_failure_mode=""
    )
    
    # 1. Perfect Score Test (with known structural penalties)
    pred_perfect = dspy.Prediction(markdown_listing=SAMPLE_MARKDOWN)
    result_perfect = url_recall_with_feedback(gold, pred_perfect)
    # The sample markdown is missing 'Support' and 'Accessibility Conformance Reports' headers
    # Each missing header costs 0.1. Base score 1.0 - 0.2 = 0.8
    assert result_perfect.score >= 0.7
    
    # 2. Hallucination Test
    hallucinated_md = SAMPLE_MARKDOWN + "\n- [Fake Link](https://hallucinated.com)"
    pred_fake = dspy.Prediction(markdown_listing=hallucinated_md)
    result_fake = url_recall_with_feedback(gold, pred_fake)
    assert result_fake.score < result_perfect.score
    assert "HALLUCINATION PENALTY" in result_fake.feedback
    
    # 3. Missing URL Test
    missing_md = "# Test Product\n### Vendor Resources\n- [One Link](https://test.com/a11y)"
    pred_missing = dspy.Prediction(markdown_listing=missing_md)
    result_missing = url_recall_with_feedback(gold, pred_missing)
    assert result_missing.score < 0.5 # Dropped half the URLs + structural penalties
    assert "DROPPED URLs" in result_missing.feedback
    
    logger.info("✅ Metric Sanity Passed")

def run_dataset_audit():
    logger.info("Running Full Dataset Audit...")
    if not DATASET_PATH.exists():
        logger.warning("Dataset not found. Skipping audit.")
        return
        
    with open(DATASET_PATH) as f:
        dataset = json.load(f)
        
    logger.info(f"Auditing {len(dataset)} products for schema compliance...")
    for record in dataset:
        name = record.get("product_name", "Unknown")
        vendor_links = len(record.get("ground_truth_vendor", []))
        other_links = len(record.get("ground_truth_other", []))
        
        # Verify basic record integrity
        assert "input_url" in record
        assert "metadata" in record
        
    logger.info(f"✅ Dataset Audit Passed: {len(dataset)} records verified.")

from nerd_core.services import extract_grounding_urls

def test_grounding_none_chunks():
    logger.info("Testing grounding metadata with None chunks (Original Bug)...")
    mock_response = MagicMock()
    mock_candidate = MagicMock()
    mock_candidate.grounding_metadata.grounding_chunks = None
    mock_response.candidates = [mock_candidate]
    
    urls = extract_grounding_urls(mock_response)
    assert urls == []
    logger.info("✅ Grounding None-Chunks Passed")

def test_metadata_parsing_robustness():
    logger.info("Testing Metadata Parsing Robustness...")
    md = "# Test Product\n**Vendor:** Test Vendor\n**Description:** A test description.\n**Product Website:** https://test.com\n\n### Vendor Resources\n- [Link](https://test.com/a11y)"
    listing = parse_markdown_to_listing(md)
    
    assert listing.product_name == "Test Product"
    assert listing.vendor_name == "Test Vendor"
    assert listing.product_description == "A test description."
    assert listing.product_website_url == "https://test.com"
    logger.info("✅ Metadata Parsing Passed")

def run_all_tests():
    logger.info("🚀 Starting N.E.R.D. System Test Suite")
    try:
        test_parser()
        test_artifact_generation()
        test_metric_sanity()
        run_dataset_audit()
        test_grounding_none_chunks()
        test_metadata_parsing_robustness()
        logger.info("🎉 ALL TESTS PASSED")
    except Exception as e:
        logger.error(f"❌ TEST SUITE FAILED: {str(e)}")
        raise

if __name__ == "__main__":
    run_all_tests()
