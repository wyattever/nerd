import pytest
from api.main import slugify
from api.schemas import ListingData, ResourceLink, SupportContact, ACRReport

def test_slugify_basic():
    assert slugify("Hello World") == "hello-world"
    assert slugify("FastAPI & Next.js") == "fastapi-next-js"
    assert slugify("Product V1.0") == "product-v1-0"
    assert slugify("  Spaces  ") == "spaces"

def test_slugify_special_chars():
    assert slugify("What's Up?") == "what-s-up"
    assert slugify("Emoji 🚀 Test") == "emoji-test"

def test_listing_data_schema_defaults():
    listing = ListingData()
    assert listing.product_name == "Unknown Product"
    assert listing.vendor_directory_url == "#"
    assert listing.vendor_resources == []
    assert listing.last_updated is None

def test_listing_data_validation():
    # Valid data
    data = {
        "product_name": "Test Product",
        "vendor_resources": [{"url": "https://example.com", "text": "Example"}],
        "support_contacts": [{"type": "url", "value": "https://support.com", "label": "Support"}]
    }
    listing = ListingData(**data)
    assert listing.product_name == "Test Product"
    assert len(listing.vendor_resources) == 1
    assert listing.vendor_resources[0].url == "https://example.com"

def test_support_contact_invalid_type():
    with pytest.raises(ValueError):
        SupportContact(type="phone", value="123456") # Only email, url, text allowed
