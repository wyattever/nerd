"""
src/generators.py — Artifact Engine for N.E.R.D.
=================================================
Converts a parsed NCADEMI listing (from the GEPA-optimized agent) into:
  - A standalone HTML preview (rendered in Streamlit)
  - Downloadable DOCX bytes

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
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.opc.part import Part

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


# ---------------------------------------------------------------------------
# Markdown → ListingData parser
# ---------------------------------------------------------------------------

_LINK_RE    = re.compile(r'^\s*-\s*(?:\[(.+?)\]\((https?://[^\)]+)\)|(.+?)\s*\((https?://[^\)]+)\))')
_HEADER_RE  = re.compile(r'^(#{1,6})\s+(.+)')

def parse_markdown_to_listing(markdown: str) -> ListingData:
    """
    Convert the GEPA-optimized Markdown draft into a ListingData object.
    
    Supports the optimized prompt structure:
    ### Vendor Resources
    ### Third-Party Insights
    ### AI Generated Insights
    """
    lines = markdown.splitlines()
    data = ListingData()
    current_section: Optional[str] = None
    ai_lines: list[str] = []

    # Attempt to pull header data from non-sectioned lines at the start
    for line in lines:
        stripped = line.strip()
        if not stripped: continue
        
        m = _HEADER_RE.match(stripped)
        if m:
            level, heading = len(m.group(1)), m.group(2).strip()
            heading_lower = heading.lower()
            # print(f"DEBUG: Found header level {level}: '{heading}'")
            
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

        if current_section is None:
            # Header fields (fallback for unformatted drafts)
            # Use regex to strip both plain and bold labels like "Vendor:", "**Vendor:**", etc.
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
                # Group 1/2 are [text](url), Group 3/4 are text (url)
                text = lm.group(1) or lm.group(3)
                url = lm.group(2) or lm.group(4)
                link = ResourceLink(text=text.strip(), url=url.strip())
                if current_section == "vendor":
                    data.vendor_resources.append(link)
                else:
                    data.other_resources.append(link)
            elif stripped.startswith("- "):
                # Fallback for raw URLs
                url_match = re.search(r'https?://\S+', stripped)
                if url_match:
                    url = url_match.group(0)
                    data.vendor_resources.append(ResourceLink(text=url, url=url)) if current_section == "vendor" else data.other_resources.append(ResourceLink(text=url, url=url))

        elif current_section == "insights":
            if not stripped.startswith("#"):
                ai_lines.append(stripped)

    data.ai_insights = " ".join(ai_lines).strip()
    data.last_updated = datetime.now().strftime('%B %d, %Y')
    return data


# ---------------------------------------------------------------------------
# HTML preview builder
# ---------------------------------------------------------------------------

def generate_ncademi_html(markdown: str) -> str:
    """
    Render the Markdown draft as a standalone NCADEMI-structured HTML string.
    Utilizes Jinja2 and nerd.css.
    """
    listing = parse_markdown_to_listing(markdown)
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


# ---------------------------------------------------------------------------
# DOCX high-fidelity builder
# ---------------------------------------------------------------------------

def add_html_alt_chunk(doc, html_string):
    """Embeds HTML into a Word doc as a high-fidelity 'altChunk'."""
    package = doc.part.package
    part_name = package.next_partname('/word/htmlChunk%d.html')
    html_part = Part(part_name, 'text/html', html_string.encode('utf-8'), package)
    r_id = doc.part.relate_to(
        html_part,
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk',
    )
    alt_chunk = OxmlElement('w:altChunk')
    alt_chunk.set(qn('r:id'), r_id)
    doc.element.body.append(alt_chunk)


def create_docx_bytes(markdown: str) -> bytes:
    """
    Build the DOCX and return raw bytes by mirroring the HTML structure.
    """
    full_html = generate_ncademi_html(markdown)
    doc = Document()
    add_html_alt_chunk(doc, full_html)
    bio = io.BytesIO()
    doc.save(bio)
    bio.seek(0)
    return bio.getvalue()
