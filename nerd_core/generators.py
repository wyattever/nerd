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
from typing import Optional, Literal, Callable

from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import escape

# ---------------------------------------------------------------------------
# Setup Jinja2
# ---------------------------------------------------------------------------
# Corrected path to root 'templates' directory
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
    html_override: str = ""
    last_updated_at: str = ""
    section_overrides: dict = field(default_factory=dict)


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

# Regex to capture confidence annotations like {confidence: 0.89, why: "..."}
_ANNOTATED_LINK_RE = re.compile(
    r'^\s*-\s*'
    r'\[(?P<text>.+?)\]\((?P<url>https?://[^\)]+)\)'  # Markdown link [Text](URL)
    r'(?:\s*\{\s*confidence:\s*(?P<confidence>0\.\d+),?\s*why:\s*"(?P<why>[^"]*)"\s*\})?' # Optional annotation
)

_HEADER_RE = re.compile(r'^(#{1,6})\s+(.+)')

def _parse_confidence_annotation(line: str) -> tuple[float, str]:
    """Parses a confidence annotation, returning (0.0, "") on failure."""
    try:
        match = re.search(r'confidence:\s*(?P<confidence>0\.\d+)', line)
        confidence = float(match.group('confidence')) if match else 0.0
        
        match = re.search(r'why:\s*"(?P<why>[^"]*)"|\'why\':\s*\'(?P<why2>[^\']*)\'', line)
        why = match.group('why') or match.group('why2') if match else ""
        
        return confidence, why
    except (AttributeError, ValueError):
        return 0.0, ""

def _rank_and_cap_resources(resources: list[ResourceLink], cap: int = 5) -> list[ResourceLink]:
    """Sorts resources by confidence (desc) and caps the list."""
    return sorted(resources, key=lambda r: r.confidence, reverse=True)[:cap]

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
            # Try the new annotated regex first
            annotated_match = _ANNOTATED_LINK_RE.match(stripped)
            if annotated_match:
                text = annotated_match.group('text').strip()
                url = annotated_match.group('url').strip()
                confidence, why = _parse_confidence_annotation(stripped)
                link = ResourceLink(text=text, url=url, confidence=confidence, justification=why)
            else:
                # Fallback to the old, non-annotated regex
                lm = _LINK_RE.match(stripped)
                if lm:
                    text = lm.group('text1') or lm.group('text2') or lm.group('url3')
                    url = lm.group('url1') or lm.group('url2') or lm.group('url3')
                    
                    if lm.group('url3') and not lm.group('text1') and not lm.group('text2'):
                        raw_text = stripped[2:].replace(url, '').strip(' ()[]:-')
                        if raw_text: text = raw_text
                    
                    link = ResourceLink(text=text.strip(), url=url.strip()) # Confidence defaults to 0.0
                elif stripped.startswith("- ") and "http" in stripped:
                    # Last resort fallback if all regexes missed it
                    url_match = re.search(r'https?://\S+', stripped)
                    if url_match:
                        url = url_match.group(0).rstrip(').')
                        text = stripped[2:].replace(url, '').strip(' ()[]:-')
                        if not text: text = url
                        link = ResourceLink(text=text, url=url) # Confidence defaults to 0.0
                    else:
                        continue # Skip malformed line
                else:
                    continue # Skip non-link line

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
    
    # Rank and cap the resource lists before returning
    data.vendor_resources = _rank_and_cap_resources(data.vendor_resources)
    data.other_resources = _rank_and_cap_resources(data.other_resources)
    
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
        
        # Pre-rendered sections
        header_html=get_section_html(listing, "header"),
        vendor_resources_html=get_section_html(listing, "vendor_resources"),
        other_resources_html=get_section_html(listing, "other_resources"),
        support_html=get_section_html(listing, "support"),
        acr_html=get_section_html(listing, "acr"),

        # Unchanged pass-through data
        ai_insights=listing.ai_insights,
        last_updated=listing.last_updated,
        css_content=css_content
    )


def _gen_header_html(listing: ListingData) -> str:
    """Reproduces the page-header/h1, vendor line, description, and website link block."""
    parts = []
    
    # Entry Header
    parts.append('<header class="entry-header alignwide">')
    parts.append(f'<h1 id="product-name" class="entry-title">{escape(listing.product_name)}</h1>')
    parts.append('</header>')
    
    # Product Header
    parts.append('<header class="product-header">')
    if listing.vendor_name:
        vendor_link = f'<a href="{escape(listing.vendor_directory_url)}">{escape(listing.vendor_name)}</a>' if listing.vendor_directory_url else escape(listing.vendor_name)
        parts.append(f'<p class="vendor-line"><strong>Vendor:</strong> {vendor_link}</p>')

    if listing.product_description:
        parts.append(f'<p class="product-desc">{escape(listing.product_description)}</p>')

    if listing.product_website_url and listing.product_website_url != "#":
        parts.append(
            '<p class="product-website">'
            f'<a href="{escape(listing.product_website_url)}" target="_blank" rel="noopener noreferrer">'
            f'<i class="fa-solid fa-globe" aria-hidden="true"></i> {escape(listing.product_name)} Website'
            '</a></p>'
        )
    parts.append('</header>')
    
    return "\n".join(parts)

def _gen_vendor_resources_html(listing: ListingData) -> str:
    """Reproduces the "From {Vendor}" resource list block."""
    if not listing.vendor_resources:
        return ""
    
    parts = []
    vendor_display_name = escape(listing.vendor_name or "Vendor")
    parts.append(f'<h3 class="section-heading">From {vendor_display_name}</h3>')
    parts.append('<ul class="wp-block-list resource-list">')
    for item in listing.vendor_resources:
        parts.append(f'<li><a href="{escape(item.url)}" target="_blank" rel="noopener noreferrer">{escape(item.text)}</a></li>')
    parts.append('</ul>')
    return "\n".join(parts)

def _gen_other_resources_html(listing: ListingData) -> str:
    """Reproduces the "From Other Sources" resource list block."""
    if not listing.other_resources:
        return ""
        
    parts = []
    parts.append('<h3 class="section-heading">From Other Sources</h3>')
    parts.append('<ul class="wp-block-list resource-list">')
    for item in listing.other_resources:
        parts.append(f'<li><a href="{escape(item.url)}" target="_blank" rel="noopener noreferrer">{escape(item.text)}</a></li>')
    parts.append('</ul>')
    return "\n".join(parts)

def _gen_support_html(listing: ListingData) -> str:
    """Reproduces the Support contacts block."""
    if not listing.support_contacts:
        return ""

    parts = []
    parts.append('<div class="product-support">')
    parts.append('<h3 class="section-heading">Support</h3>')
    parts.append('<ul class="wp-block-list resource-list">')
    for contact in listing.support_contacts:
        parts.append('<li>')
        if contact.type == "email":
            parts.append(f'<a href="mailto:{escape(contact.value)}">{escape(contact.value)}</a>')
        elif contact.type == "url":
            label = escape(contact.label or contact.value)
            parts.append(f'<a href="{escape(contact.value)}" target="_blank" rel="noopener noreferrer">{label}</a>')
        else:
            parts.append(escape(contact.value))
        parts.append('</li>')
    parts.append('</ul></div>')
    return "\n".join(parts)

def _gen_acr_html(listing: ListingData) -> str:
    """Reproduces the Accessibility Conformance Reports block."""
    parts = []
    parts.append('<div class="edtech-acr">')
    parts.append('<h3 class="section-heading">Accessibility Conformance Reports</h3>')

    if not listing.acr_reports:
        parts.append('<div class="acr-report">')
        parts.append('<h4><a href="#" rel="noopener noreferrer">None found</a></h4>')
        parts.append('<ul>')
        parts.append('<li><strong>Version:</strong> </li>')
        parts.append('<li><strong>Date:</strong> </li>')
        parts.append('<li><strong>Completed by:</strong> </li>')
        parts.append('</ul></div>')
    else:
        for acr in listing.acr_reports:
            parts.append('<div class="acr-report">')
            
            has_valid_url = acr.url and acr.url != "#"
            title_element = escape(acr.title)
            if has_valid_url:
                title_element = f'<a href="{escape(acr.url)}" target="_blank" rel="noopener noreferrer">{title_element}</a>'
            
            parts.append(f'<h4>{title_element}</h4>')
            parts.append('<ul>')
            parts.append('<li><strong>Version:</strong> </li>')
            parts.append('<li><strong>Date:</strong> </li>')
            parts.append('<li><strong>Completed by:</strong> </li>')
            parts.append('</ul></div>')

    parts.append('</div>')
    return "\n".join(parts)

def _gen_ai_insights_html(listing: ListingData) -> str:
    """Reproduces the AI Generated Insights block."""
    if not listing.ai_insights or listing.ai_insights == "Insufficient data":
        return ""
    
    parts = []
    parts.append('<div class="ai-insights">')
    parts.append('<h3>AI Generated Insights</h3>')
    parts.append(f'<p>{escape(listing.ai_insights)}</p>')
    parts.append('</div>')
    return "\n".join(parts)

SectionKey = Literal["header", "vendor_resources", "other_resources", "support", "acr", "ai_insights"]

def get_section_html(listing: ListingData, section_key: SectionKey) -> str:
    """Returns the HTML a section should render: the override if
    present in listing.section_overrides, else the auto-generated HTML.
    Mirrors frontend/lib/ncademiPreview.ts's getSectionHtml (Step 3) —
    this function and that one MUST implement the identical override-
    or-generate rule, or Copy HTML will diverge from the live viewer
    for overridden sections (see plan §3, §8 R1)."""
    override = listing.section_overrides.get(section_key)
    if override is not None:  # empty string IS a valid override - see R6
        return override
    generators: dict[SectionKey, Callable[[ListingData], str]] = {
        "header": _gen_header_html,
        "vendor_resources": _gen_vendor_resources_html,
        "other_resources": _gen_other_resources_html,
        "support": _gen_support_html,
        "acr": _gen_acr_html,
        "ai_insights": _gen_ai_insights_html,
    }
    return generators[section_key](listing)

def generate_ncademi_html(markdown: str) -> str:
    """
    Render the Markdown draft as a standalone NCADEMI-structured HTML string.
    """
    listing = parse_markdown_to_listing(markdown)
    return render_listing_html(listing)
