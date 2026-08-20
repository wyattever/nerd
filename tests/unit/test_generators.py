import pytest
from nerd_core.generators import parse_markdown_to_listing, render_listing_html, ListingData, ResourceLink, SupportContact

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

def test_render_with_section_override():
    listing = ListingData(
        product_name="Test Product",
        vendor_name="Test Vendor",
        support_contacts=[SupportContact(type="email", value="old@example.com")],
        section_overrides={"support": "<p>OVERRIDE SUPPORT CONTENT</p>"},
    )
    html = render_listing_html(listing)
    assert "<p>OVERRIDE SUPPORT CONTENT</p>" in html
    assert "old@example.com" not in html  # override replaced, not appended
    assert "Test Vendor" in html  # non-overridden sections still auto-generate

def test_render_without_overrides_regression():
    listing = ListingData(
        product_name="Regress Product",
        vendor_name="Regress Vendor",
        support_contacts=[SupportContact(type="email", value="regress@example.com")],
        vendor_resources=[ResourceLink(url="https://regress.com", text="Regress Link")]
    )
    html = render_listing_html(listing)
    
    # Check that auto-generated content is present
    assert "Regress Product" in html
    assert "Regress Vendor" in html
    assert "regress@example.com" in html
    assert "Regress Link" in html
    assert "https://regress.com" in html


def test_acr_metadata_parsing():
    from nerd_core.generators import parse_markdown_to_listing
    md = """
### Accessibility Conformance Reports (ACR / VPAT)
Report Title: Full Report
Link: [Full Report (PDF)](https://vpat.com/full)
Version: 2.5
Date: July 2026
Auditor: Deque Systems
Auditor URL: https://deque.com
Preparation Type: External

Report Title: Minimal Report
Link: [Minimal Report (Web)](https://vpat.com/min)
"""
    listing = parse_markdown_to_listing(md)
    assert len(listing.acr_reports) == 2
    
    full_report = listing.acr_reports[0]
    assert full_report.title == "Full Report"
    assert full_report.version == "2.5"
    assert full_report.date == "July 2026"
    assert full_report.auditor_name == "Deque Systems"
    assert full_report.auditor_url == "https://deque.com"
    assert full_report.preparation_type == "External"

    min_report = listing.acr_reports[1]
    assert min_report.title == "Minimal Report"
    assert min_report.version == ""
    assert min_report.date == ""
    assert min_report.auditor_name == ""
    assert min_report.auditor_url == ""
    assert min_report.preparation_type == "Internal"
