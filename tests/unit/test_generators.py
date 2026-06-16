import pytest
from nerd_core.generators import parse_markdown_to_listing, ListingData, ResourceLink

def test_parse_markdown_basic():
    markdown = """
# Product Name
Description of the product.

### Vendor Resources
- [VPAT](https://vendor.com/vpat)
- Manual (https://vendor.com/manual)

### Other Sources
- [Review](https://thirdparty.com/review)

### AI Generated Insights
This is a helpful insight.
"""
    listing = parse_markdown_to_listing(markdown)
    
    assert listing.product_name == "Product Name"
    assert "Description of the product" in listing.product_description
    assert len(listing.vendor_resources) == 2
    assert listing.vendor_resources[0].text == "VPAT"
    assert listing.vendor_resources[0].url == "https://vendor.com/vpat"
    assert listing.vendor_resources[1].text == "Manual"
    assert listing.vendor_resources[1].url == "https://vendor.com/manual"
    
    assert len(listing.other_resources) == 1
    assert listing.other_resources[0].text == "Review"
    assert listing.other_resources[0].url == "https://thirdparty.com/review"
    
    assert listing.ai_insights == "This is a helpful insight."

def test_parse_markdown_parenthetical_links():
    markdown = """
### Vendor Resources
- Documentation (https://vendor.com/docs)
- [Support Site] (https://vendor.com/support)
"""
    listing = parse_markdown_to_listing(markdown)
    assert len(listing.vendor_resources) == 2
    assert listing.vendor_resources[0].text == "Documentation"
    assert listing.vendor_resources[0].url == "https://vendor.com/docs"
    assert listing.vendor_resources[1].text == "Support Site"
    assert listing.vendor_resources[1].url == "https://vendor.com/support"

def test_parse_markdown_raw_urls():
    markdown = """
### Vendor Resources
- https://vendor.com/raw
- Bullet with https://vendor.com/inline
"""
    listing = parse_markdown_to_listing(markdown)
    assert len(listing.vendor_resources) == 2
    assert listing.vendor_resources[0].url == "https://vendor.com/raw"
    assert listing.vendor_resources[1].url == "https://vendor.com/inline"
    assert listing.vendor_resources[1].text == "Bullet with"

def test_parse_markdown_missing_sections():
    markdown = "# Empty Product"
    listing = parse_markdown_to_listing(markdown)
    assert listing.product_name == "Empty Product"
    assert listing.vendor_resources == []
    assert listing.other_resources == []
    assert listing.ai_insights == ""
