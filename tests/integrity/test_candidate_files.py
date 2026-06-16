import pytest
import json
import os
from pathlib import Path
from api.schemas import ListingData

# Note: This test validates the source-of-truth JSON files in the filesystem,
# not the Firestore state. Firestore state is validated by integration tests.

CANDIDATES_DIR = Path(__file__).parent.parent.parent / "NCADEMI_candidates"
LOCAL_MODE = os.getenv("LOCAL_MODE", "false").lower() == "true"

def get_candidate_files():
    if not CANDIDATES_DIR.exists():
        return []
    return list(CANDIDATES_DIR.glob("*.json"))

@pytest.mark.skipif(
    not LOCAL_MODE and not os.getenv("GOOGLE_APPLICATION_CREDENTIALS") and not os.getenv("GOOGLE_CLOUD_PROJECT"),
    reason="Integrity tests for filesystem skipped in non-local environments without GCP access"
)
@pytest.mark.parametrize("file_path", get_candidate_files())
def test_candidate_schema_roundtrip(file_path):
    """Ensure every candidate file complies with the current ListingData schema."""
    with open(file_path, "r") as f:
        raw_data = json.load(f)
    
    # 1. Validate (JSON -> Pydantic)
    listing = ListingData(**raw_data)
    
    # 2. Re-serialize (Pydantic -> JSON)
    serialized = listing.model_dump()
    
    # 3. Check for essential fields
    assert listing.product_name is not None
    assert isinstance(listing.vendor_resources, list)
    assert isinstance(listing.other_resources, list)

@pytest.mark.skipif(
    not LOCAL_MODE and not os.getenv("GOOGLE_APPLICATION_CREDENTIALS") and not os.getenv("GOOGLE_CLOUD_PROJECT"),
    reason="Integrity tests for filesystem skipped in non-local environments without GCP access"
)
@pytest.mark.parametrize("file_path", get_candidate_files())
def test_no_unresolved_redirects(file_path):
    """Scan for 'grounding-api-redirect' markers which shouldn't be in final data."""
    with open(file_path, "r") as f:
        content = f.read()
    
    assert "grounding-api-redirect" not in content, f"File {file_path.name} contains unresolved redirects."

def test_candidates_directory_not_empty():
    """Fail if no candidates were found to test (sanity check)."""
    if not LOCAL_MODE and not os.getenv("GOOGLE_APPLICATION_CREDENTIALS") and not os.getenv("GOOGLE_CLOUD_PROJECT"):
        pytest.skip("Skipping in non-local environment")
    assert len(get_candidate_files()) > 0, "No candidate files found in NCADEMI_candidates/"
