"""
nerd_core/generators.py — Artifact Engine for N.E.R.D.
=================================================
Converts a parsed NCADEMI listing (from the GEPA-optimized agent) into:
  - A standalone HTML preview (rendered in Streamlit)

Both outputs exactly match the NCADEMI directory page structure.
"""

from __future__ import annotations

import re
import io
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from jinja2 import Environment, FileSystemLoader, select_autoescape

# ---------------------------------------------------------------------------
# Setup Jinja2
# ---------------------------------------------------------------------------
_TEMPLATES_DIR = Path(__file__).parent.parent / "templates"
_jinja = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=select_autoescape(["html"]),
    trim_blocks=True,
    lstrip_blocks=True,
)

# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class ResourceLink:
    url: str
    text: str


@dataclass
class SupportContact:
    type: str       # "email" | "url" | "text"
    value: str
    label: str = ""


@dataclass
class ACRReport:
    title: str
    url: str
    version: str = ""
    date: str = ""
    auditor_name: str = ""
    auditor_url: str = ""


@dataclass
class ListingData:
    product_name: str = "Unknown Product"
    vendor_name: str = ""
    vendor_directory_url: str = "#"
    product_description: str = ""
    product_website_url: str = "#"
    vendor_resources: list[ResourceLink] = field(default_factory=list)
    other_resources: list[ResourceLink] = field(default_factory=list)
    ai_insights: str = ""
    support_contacts: list[SupportContact] = field(default_factory=list)
    acr_reports: list[ACRReport] = field(default_factory=list)
    last_updated: str = ""
    html_override: Optional[str] = ""
    last_updated_at: Optional[str] = ""


# ---------------------------------------------------------------------------
# Markdown → ListingData parser
# ---------------------------------------------------------------------------

# Robust link regex: matches [Text](URL), [Text] (URL), Text (URL), or just URL
_LINK_RE = re.compile(
    r'^\s*-\s*(?:'
    r'\[(?P<text1>.+?)\]\s?\((?P<url1>https?://[^\)\s]+)\)'  # [Text](URL) or [Text] (URL)
    r'|'
    r'(?P<text2>.+?)\s*\((?P<url2>https?://[^\)\s]+)\)'  # Text (URL)
    r'|'
    r'(?P<url3>https?://\S+)'                          # Raw URL
    r')'
)
_HEADER_RE = re.compile(r'^(#{1,6})\s+(.+)')

def parse_markdown_to_listing(markdown: str) -> ListingData:
    """
    Convert the GEPA-optimized Markdown draft into a ListingData object.
    """
    lines = markdown.splitlines()
    data = ListingData()
    current_section: Optional[str] = None
    ai_lines: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped: continue
        
        # Section detection
        m = _HEADER_RE.match(stripped)
        if m:
            level, heading = len(m.group(1)), m.group(2).strip()
            heading_lower = heading.lower()
            
            if level == 1:
                data.product_name = heading
            elif "vendor" in heading_lower:
                current_section = "vendor"
            elif "third-party" in heading_lower or "other sources" in heading_lower:
                current_section = "other"
            elif "insights" in heading_lower:
                current_section = "insights"
            elif "support" in heading_lower:
                current_section = "support"
            elif "acr" in heading_lower or "conformance" in heading_lower:
                current_section = "acr"
            continue

        # Header detection fallback
        if current_section is None:
            metadata_match = re.match(r'^(\*\*|)(Product Name|Vendor|Product Website|Description):(\*\*|)\s*(.*)', stripped, re.I)
            if metadata_match:
                key = metadata_match.group(2).lower()
                val = metadata_match.group(4).strip()
                if key == "product name": data.product_name = val
                elif key == "vendor": data.vendor_name = val
                elif key == "product website": data.product_website_url = val
                elif key == "description": data.product_description = val
                continue
            
            if not stripped.startswith("#") and not stripped.startswith("-"):
                if not data.product_description:
                    data.product_description = stripped
                else:
                    data.product_description += " " + stripped
                    
        elif current_section in ("vendor", "other"):
            lm = _LINK_RE.match(stripped)
            if lm:
                text = lm.group('text1') or lm.group('text2') or lm.group('url3')
                url = lm.group('url1') or lm.group('url2') or lm.group('url3')
                
                # If we matched a raw URL but it was part of a larger line, 
                # try to extract the text preceding it.
                if lm.group('url3') and not lm.group('text1') and not lm.group('text2'):
                    raw_text = stripped[2:].replace(url, '').strip(' ()[]:-')
                    if raw_text: text = raw_text
                
                link = ResourceLink(text=text.strip(), url=url.strip())
                if current_section == "vendor":
                    data.vendor_resources.append(link)
                else:
                    data.other_resources.append(link)
            elif stripped.startswith("- ") and "http" in stripped:
                # Last resort fallback if regex missed it
                url_match = re.search(r'https?://\S+', stripped)
                if url_match:
                    url = url_match.group(0).rstrip(').')
                    text = stripped[2:].replace(url, '').strip(' ()[]:-')
                    if not text: text = url
                    link = ResourceLink(text=text, url=url)
                    if current_section == "vendor":
                        data.vendor_resources.append(link)
                    else:
                        data.other_resources.append(link)

        elif current_section == "support":
            if "Support Contact:" in stripped:
                val = stripped.replace("Support Contact:", "").strip()
                if "@" in val:
                    data.support_contacts.append(SupportContact(type="email", value=val))
                elif "http" in val:
                    # Attempt to extract markdown link if present
                    lm = _LINK_RE.match("- " + val)
                    if lm:
                        text = lm.group('text1') or lm.group('text2') or lm.group('url3')
                        url = lm.group('url1') or lm.group('url2') or lm.group('url3')
                        data.support_contacts.append(SupportContact(type="url", value=url.strip(), label=text.strip()))
                    else:
                        data.support_contacts.append(SupportContact(type="url", value=val))
                else:
                    data.support_contacts.append(SupportContact(type="text", value=val))
                    
        elif current_section == "acr":
            if "Report Title:" in stripped:
                data.acr_reports.append(ACRReport(title=stripped.replace("Report Title:", "").strip(), url="#"))
            elif data.acr_reports:
                curr = data.acr_reports[-1]
                if "VPAT Version:" in stripped: curr.version = stripped.replace("VPAT Version:", "").strip()
                elif "Date Completed:" in stripped: curr.date = stripped.replace("Date Completed:", "").strip()
                elif "Evaluating Organization:" in stripped: curr.auditor_name = stripped.replace("Evaluating Organization:", "").strip()
                elif "Link:" in stripped:
                    # Parse the link using the robust regex
                    lm = _LINK_RE.match("- " + stripped.replace("Link:", "").strip())
                    if lm:
                        url = lm.group('url1') or lm.group('url2') or lm.group('url3')
                        curr.url = url.strip()
                    else:
                        # Fallback raw url grab
                        url_match = re.search(r'https?://\S+', stripped)
                        if url_match: curr.url = url_match.group(0).rstrip(').')

        elif current_section == "insights":
            if not stripped.startswith("#"):
                # Handle "Description:" prefix if present
                if stripped.startswith("Description:"):
                    stripped = stripped.replace("Description:", "").strip()
                if stripped:
                    ai_lines.append(stripped)

    data.ai_insights = " ".join(ai_lines).strip()
    data.last_updated = datetime.now().strftime('%B %d, %Y')
    return data


# ---------------------------------------------------------------------------
# HTML preview builder
# ---------------------------------------------------------------------------

def render_listing_html(listing: ListingData) -> str:
    """
    Render a ListingData object as a standalone NCADEMI-structured HTML string.
    Utilizes Jinja2 and nerd.css.
    """
    css_path = _TEMPLATES_DIR / "nerd.css"
    css_content = css_path.read_text() if css_path.exists() else ""

    template = _jinja.get_template("ncademi_listing.html")
    return template.render(
        product_name=listing.product_name,
        vendor_name=listing.vendor_name,
        vendor_directory_url=listing.vendor_directory_url,
        product_description=listing.product_description,
        product_website_url=listing.product_website_url,
        vendor_resources=listing.vendor_resources,
        other_resources=listing.other_resources,
        ai_insights=listing.ai_insights,
        support_contacts=listing.support_contacts,
        acr_reports=listing.acr_reports,
        last_updated=listing.last_updated,
        css_content=css_content
    )

def generate_ncademi_html(markdown: str) -> str:
    """
    Render the Markdown draft as a standalone NCADEMI-structured HTML string.
    """
    listing = parse_markdown_to_listing(markdown)
    return render_listing_html(listing)
