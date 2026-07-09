"""
nerd_core/generators.py — Artifact Engine for N.E.R.D.
=================================================
Converts a parsed NCADEMI listing (from the GEPA-optimized agent) into:
  - A standalone HTML preview
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional, Literal, Callable

from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import escape

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
    confidence: float = 0.0
    justification: str = ""


@dataclass
class SupportContact:
    type: str       # "email" | "url" | "text"
    value: str
    label: str = ""


@dataclass
class ACRReport:
    title: str
    url: str
    # Metadata fields retained for structure, but no longer parsed from markdown.
    version: str = ""
    date: str = ""
    auditor_name: str = ""
    auditor_url: str = ""
    preparation_type: str = "Internal"


@dataclass
class ListingData:
    product_name: str = "Unknown Product"
    vendor_name: str = ""
    vendor_directory_url: str = "#"
    product_description: str = ""
    product_website_url: str = "#"
    vendor_resources: list[ResourceLink] = field(default_factory=list)
    other_resources: list[ResourceLink] = field(default_factory=list)
    support_contacts: list[SupportContact] = field(default_factory=list)
    acr_reports: list[ACRReport] = field(default_factory=list)
    last_updated: str = ""
    html_override: str = ""
    last_updated_at: str = ""
    section_overrides: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Markdown → ListingData parser
# ---------------------------------------------------------------------------

_LINK_RE = re.compile(
    r'^\s*-\s*(?:'
    r'\[(?P<text1>.+?)\]\s?\((?P<url1>https?://[^\)\s]+)\)'
    r'|'
    r'(?P<text2>.+?)\s*\((?P<url2>https?://[^\)\s]+)\)'
    r'|'
    r'(?P<url3>https?://\S+)'
    r')'
)

_ANNOTATED_LINK_RE = re.compile(
    r'^\s*-\s*'
    r'\[(?P<text>.+?)\]\((?P<url>https?://[^\)]+)\)'
    r'(?:\s*\{\s*confidence:\s*(?P<confidence>0\.\d+),?\s*why:\s*"(?P<why>[^"]*)"\s*\})?'
)

_HEADER_RE = re.compile(r'^(#{1,6})\s+(.+)')

def _parse_confidence_annotation(line: str) -> tuple[float, str]:
    try:
        match = re.search(r'confidence:\s*(?P<confidence>0\.\d+)', line)
        confidence = float(match.group('confidence')) if match else 0.0
        match = re.search(r'why:\s*"(?P<why>[^"]*)"|\'why\':\s*\'(?P<why2>[^\']*)\'', line)
        why = match.group('why') or match.group('why2') if match else ""
        return confidence, why
    except (AttributeError, ValueError):
        return 0.0, ""

def _rank_and_cap_resources(resources: list[ResourceLink], cap: int = 5) -> list[ResourceLink]:
    return sorted(resources, key=lambda r: r.confidence, reverse=True)[:cap]

def parse_markdown_to_listing(markdown: str) -> ListingData:
    lines = markdown.splitlines()
    data = ListingData()
    current_section: Optional[str] = None

    for line in lines:
        stripped = line.strip()
        if not stripped: continue
        
        m = _HEADER_RE.match(stripped)
        if m:
            level, heading = len(m.group(1)), m.group(2).strip()
            heading_lower = heading.lower()
            if level == 1: data.product_name = heading
            elif "vendor" in heading_lower: current_section = "vendor"
            elif "third-party" in heading_lower or "other sources" in heading_lower: current_section = "other"
            elif "support" in heading_lower: current_section = "support"
            elif "acr" in heading_lower or "conformance" in heading_lower: current_section = "acr"
            continue

        if current_section is None:
            metadata_match = re.match(r'^(\*\*|)(Product Name|Vendor|Product Website|Description):(\*\*|)\s*(.*)', stripped, re.I)
            if metadata_match:
                key, val = metadata_match.group(2).lower(), metadata_match.group(4).strip()
                if key == "product name": data.product_name = val
                elif key == "vendor": data.vendor_name = val
                elif key == "product website": data.product_website_url = val
                elif key == "description": data.product_description = val
                continue
            if not stripped.startswith("#") and not stripped.startswith("-"):
                data.product_description = (data.product_description + " " + stripped).strip()
                    
        elif current_section in ("vendor", "other"):
            annotated_match = _ANNOTATED_LINK_RE.match(stripped)
            if annotated_match:
                text, url = annotated_match.group('text').strip(), annotated_match.group('url').strip()
                confidence, why = _parse_confidence_annotation(stripped)
                link = ResourceLink(text=text, url=url, confidence=confidence, justification=why)
            else:
                lm = _LINK_RE.match(stripped)
                if lm:
                    text = lm.group('text1') or lm.group('text2') or lm.group('url3')
                    url = lm.group('url1') or lm.group('url2') or lm.group('url3')
                    if lm.group('url3') and not lm.group('text1') and not lm.group('text2'):
                        raw_text = stripped[2:].replace(url, '').strip(' ()[]:-')
                        if raw_text: text = raw_text
                    link = ResourceLink(text=text.strip(), url=url.strip())
                elif stripped.startswith("- ") and "http" in stripped:
                    url_match = re.search(r'https?://\S+', stripped)
                    if url_match:
                        url = url_match.group(0).rstrip(').')
                        text = stripped[2:].replace(url, '').strip(' ()[]:-')
                        link = ResourceLink(text=(text or url), url=url)
                    else: continue
                else: continue
            (data.vendor_resources if current_section == "vendor" else data.other_resources).append(link)

        elif current_section == "support":
            if "Support Contact:" in stripped:
                val = stripped.replace("Support Contact:", "").strip()
                if "@" in val: data.support_contacts.append(SupportContact(type="email", value=val))
                elif "http" in val:
                    lm = _LINK_RE.match("- " + val)
                    if lm: data.support_contacts.append(SupportContact(type="url", value=(lm.group('url1') or lm.group('url2') or lm.group('url3')).strip(), label=(lm.group('text1') or lm.group('text2') or "").strip()))
                    else: data.support_contacts.append(SupportContact(type="url", value=val))
                else: data.support_contacts.append(SupportContact(type="text", value=val))
                    
        elif current_section == "acr":
            if "Report Title:" in stripped:
                data.acr_reports.append(ACRReport(title=stripped.replace("Report Title:", "").strip(), url="#"))
            # Metadata scraping lines removed to ensure frugal/template-only behavior.

    data.last_updated = datetime.now().strftime('%B %d, %Y')
    data.vendor_resources = _rank_and_cap_resources(data.vendor_resources)
    data.other_resources = _rank_and_cap_resources(data.other_resources)
    return data


# ---------------------------------------------------------------------------
# HTML preview builder
# ---------------------------------------------------------------------------

def render_listing_html(listing: ListingData) -> str:
    css_path = _TEMPLATES_DIR / "nerd.css"
    css_content = css_path.read_text() if css_path.exists() else ""
    template = _jinja.get_template("ncademi_listing.html")
    return template.render(
        product_name=listing.product_name,
        header_html=get_section_html(listing, "header"),
        vendor_resources_html=get_section_html(listing, "vendor_resources"),
        other_resources_html=get_section_html(listing, "other_resources"),
        support_html=get_section_html(listing, "support"),
        acr_html=get_section_html(listing, "acr"),
        last_updated=listing.last_updated,
        css_content=css_content
    )

def _gen_header_html(listing: ListingData) -> str:
    parts = ['<header class="entry-header alignwide">', f'<h1 id="product-name" class="entry-title">{escape(listing.product_name)}</h1>', '</header>', '<header class="product-header">']
    if listing.vendor_name:
        vendor_link = f'<a href="{escape(listing.vendor_directory_url)}">{escape(listing.vendor_name)}</a>' if listing.vendor_directory_url != "#" else escape(listing.vendor_name)
        parts.append(f'<p class="vendor-line"><strong>Vendor:</strong> {vendor_link}</p>')
    if listing.product_description: parts.append(f'<p class="product-desc">{escape(listing.product_description)}</p>')
    if listing.product_website_url != "#":
        parts.append(f'<p class="product-website"><a href="{escape(listing.product_website_url)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-globe" aria-hidden="true"></i> {escape(listing.product_name)} Website</a></p>')
    parts.append('</header>')
    return "\n".join(parts)

def _gen_vendor_resources_html(listing: ListingData) -> str:
    if not listing.vendor_resources: return ""
    parts = [f'<h3 class="section-heading">From {escape(listing.vendor_name or "Vendor")}</h3>', '<ul class="wp-block-list resource-list">']
    for item in listing.vendor_resources: parts.append(f'<li><a href="{escape(item.url)}" target="_blank" rel="noopener noreferrer">{escape(item.text)}</a></li>')
    parts.append('</ul>')
    return "\n".join(parts)

def _gen_other_resources_html(listing: ListingData) -> str:
    if not listing.other_resources: return ""
    parts = ['<h3 class="section-heading">From Other Sources</h3>', '<ul class="wp-block-list resource-list">']
    for item in listing.other_resources: parts.append(f'<li><a href="{escape(item.url)}" target="_blank" rel="noopener noreferrer">{escape(item.text)}</a></li>')
    parts.append('</ul>')
    return "\n".join(parts)

def _gen_support_html(listing: ListingData) -> str:
    if not listing.support_contacts: return ""
    parts = ['<div class="product-support">', '<h3 class="section-heading">Support</h3>', '<ul class="wp-block-list resource-list">']
    for contact in listing.support_contacts:
        parts.append('<li>')
        if contact.type == "email": parts.append(f'<a href="mailto:{escape(contact.value)}">{escape(contact.value)}</a>')
        elif contact.type == "url": parts.append(f'<a href="{escape(contact.value)}" target="_blank" rel="noopener noreferrer">{escape(contact.label or contact.value)}</a>')
        else: parts.append(escape(contact.value))
        parts.append('</li>')
    parts.append('</ul></div>')
    return "\n".join(parts)

def _gen_acr_html(listing: ListingData) -> str:
    parts = ['<div class="edtech-acr">', '<h3 class="section-heading">Accessibility Conformance Reports</h3>']
    if not listing.acr_reports:
        parts.append('<div class="acr-report"><h4><a href="https://example.com" target="_blank" rel="noopener noreferrer">None found</a></h4><ul><li><strong>Version:</strong> </li><li><strong>Date:</strong> </li><li><strong>Completed by:</strong> </li></ul></div>')
    else:
        for acr in listing.acr_reports:
            parts.append('<div class="acr-report">')
            title = f'<a href="{escape(acr.url)}" target="_blank" rel="noopener noreferrer">{escape(acr.title)}</a>' if acr.url != "#" else escape(acr.title)
            parts.extend([f'<h4>{title}</h4>', '<ul>', '<li><strong>Version:</strong> </li>', '<li><strong>Date:</strong> </li>', '<li><strong>Completed by:</strong> </li>', '</ul></div>'])
    parts.append('</div>')
    return "\n".join(parts)

def get_section_html(listing: ListingData, section_key: Literal["header", "vendor_resources", "other_resources", "support", "acr"]) -> str:
    if (override := listing.section_overrides.get(section_key)) is not None: return override
    generators = {"header": _gen_header_html, "vendor_resources": _gen_vendor_resources_html, "other_resources": _gen_other_resources_html, "support": _gen_support_html, "acr": _gen_acr_html}
    return generators[section_key](listing)

def generate_ncademi_html(markdown: str) -> str:
    return render_listing_html(parse_markdown_to_listing(markdown))