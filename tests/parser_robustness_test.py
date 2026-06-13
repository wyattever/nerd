
import unittest
import re
from src.generators import parse_markdown_to_listing, ListingData, ResourceLink

class TestParserRobustness(unittest.TestCase):
    
    def test_standard_markdown_links(self):
        md = """
### Vendor Resources
- [Terms](https://vendor.com/terms)
- [Support](https://vendor.com/support)
"""
        listing = parse_markdown_to_listing(md)
        self.assertEqual(len(listing.vendor_resources), 2)
        self.assertEqual(listing.vendor_resources[0].text, "Terms")
        self.assertEqual(listing.vendor_resources[0].url, "https://vendor.com/terms")

    def test_parenthetical_links(self):
        md = """
### Third-Party Insights
- Review Site (https://reviews.com/123)
- Audit Report (http://university.edu/audit)
"""
        listing = parse_markdown_to_listing(md)
        self.assertEqual(len(listing.other_resources), 2)
        self.assertEqual(listing.other_resources[0].text, "Review Site")
        self.assertEqual(listing.other_resources[0].url, "https://reviews.com/123")

    def test_raw_urls(self):
        md = """
### Vendor Resources
- https://vendor.com/direct-link
- Some description: https://vendor.com/another-link
"""
        listing = parse_markdown_to_listing(md)
        self.assertEqual(len(listing.vendor_resources), 2)
        self.assertEqual(listing.vendor_resources[0].text, "https://vendor.com/direct-link")
        self.assertEqual(listing.vendor_resources[1].text, "Some description")
        self.assertEqual(listing.vendor_resources[1].url, "https://vendor.com/another-link")

    def test_link_resolution_logic(self):
        from src.utils import filter_broken_links
        import unittest.mock as mock
        
        md = "Check this: [Canvas](https://redirect.com/123)"
        
        # Mock resolve_and_validate_url to simulate finding a direct link
        with mock.patch('src.utils.resolve_and_validate_url') as mock_resolve:
            mock_resolve.return_value = ("https://direct-canvas.com/final", True, "OK")
            
            processed_md, _ = filter_broken_links(md)
            self.assertIn("https://direct-canvas.com/final", processed_md)
            self.assertNotIn("https://redirect.com/123", processed_md)

    def test_mixed_formatting(self):
        md = """
### Vendor Resources
- [Standard](https://v.com/1)
- [Standard with Space] (https://v.com/space)
- Parenthetical (https://v.com/2)
- https://v.com/3
"""
        listing = parse_markdown_to_listing(md)
        self.assertEqual(len(listing.vendor_resources), 4)
        self.assertTrue(any(r.text == "Standard with Space" for r in listing.vendor_resources))

    def test_section_header_variants(self):
        variants = [
            "### Vendor Resources",
            "### Accessibility Resources (From Vendor)",
            "## Vendor documentation",
            "### From Vendor"
        ]
        for v in variants:
            md = f"{v}\n- [Link](https://v.com)"
            listing = parse_markdown_to_listing(md)
            self.assertEqual(len(listing.vendor_resources), 1, f"Failed on header: {v}")

        other_variants = [
            "### Third-Party Insights",
            "### Accessibility Insights (From Third-Party Sources)",
            "### Other Sources",
            "### From Other Sources"
        ]
        for v in other_variants:
            md = f"{v}\n- [Link](https://o.com)"
            listing = parse_markdown_to_listing(md)
            self.assertEqual(len(listing.other_resources), 1, f"Failed on header: {v}")

    def test_ai_insights_extraction(self):
        md = """
### AI Generated Insights
Description: This is a test summary.
It spans multiple lines.
It should be captured fully.
"""
        listing = parse_markdown_to_listing(md)
        self.assertIn("This is a test summary.", listing.ai_insights)
        self.assertIn("should be captured fully.", listing.ai_insights)

    def test_malformed_lines_graceful_handling(self):
        md = """
### Vendor Resources
- This line has no link
- [Broken Link](no-url)
- [Partial Link] (https://v.com)
"""
        listing = parse_markdown_to_listing(md)
        self.assertTrue(any(r.url == "https://v.com" for r in listing.vendor_resources))

if __name__ == "__main__":
    unittest.main()
