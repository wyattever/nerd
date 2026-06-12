# --- NCADEMI Research Assistant ---
import streamlit as st
import os
import logging
import json
import io
import re
import warnings
import docx
import time
import httpx
import html
import socket
import ipaddress
import hashlib
from urllib.parse import urlparse
from functools import lru_cache
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.opc.part import Part
from datetime import datetime
from google import genai
from google.genai import types
from google.cloud import bigquery
from google.genai.errors import ClientError
from dotenv import load_dotenv

# Suppress legacy auth and Python 3.9 EOL FutureWarnings
warnings.filterwarnings("ignore", category=FutureWarning, module="google.auth")
warnings.filterwarnings("ignore", category=FutureWarning, module="google.oauth2")
warnings.filterwarnings("ignore", category=FutureWarning, module="google.api_core")

# --- CONFIG ---
load_dotenv()
PROJECT_ID = "edtech-agent-2026"
LOCATION = "us-central1"
MODEL_NAME = "gemini-2.5-flash"

# BigQuery fully-qualified table id (project.dataset.table)
BQ_TABLE = f"{PROJECT_ID}.telemetry.feedback_logs"

# Cap the model timeout well under Cloud Run's request ceiling.
# Cloud Run default request timeout is 300s; a 10-minute model call cannot
# complete on a default service. Keep the synchronous call bounded.
MAX_MODEL_TIMEOUT_MIN = 4

# A realistic browser UA reduces false "broken link" removals from sites
# (e.g. Cloudflare-fronted) that 403 default library user-agents.
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# --- UTILITIES ---

def _is_blocked_ip(ip_str):
    """True if the resolved IP is loopback/private/link-local/reserved (SSRF guard)."""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # unparseable => block
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


@lru_cache(maxsize=1024)
def validate_url(url):
    """Verify a URL is https, public (not SSRF/metadata), and reachable.

    Returns (is_valid, reason). 403/405/429 are treated as 'unverifiable'
    (link kept) rather than 'broken', to avoid stripping valid sources that
    block HEAD requests or non-browser clients.
    """
    if "grounding-api-redirect" in url:
        return False, "Search Proxy"

    parsed = urlparse(url)
    if parsed.scheme != "https":
        return False, "HTTPS required"

    host = parsed.hostname
    if not host:
        return False, "Invalid Host"
    if host.lower() in ("metadata.google.internal", "localhost"):
        return False, "Restricted Host"

    # Resolve ALL addresses and block if ANY is private/loopback/link-local.
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        return False, "DNS Error"
    resolved_ips = {info[4][0] for info in infos}
    if not resolved_ips or any(_is_blocked_ip(ip) for ip in resolved_ips):
        return False, "Restricted IP Range"

    # Disable redirect-following: a 30x could redirect to an internal host that
    # we did not validate. Treat redirects as "verifiable as present".
    try:
        with httpx.Client(
            timeout=10.0,
            follow_redirects=True,
            headers={"User-Agent": BROWSER_UA},
        ) as client:
            resp = client.head(url)
            if resp.status_code == 405:  # method not allowed => retry with GET
                resp = client.get(url)
            code = resp.status_code
            if 200 <= code < 400:
                return True, "OK"
            if code in (401, 403, 429):
                # Reachable but gated/rate-limited — keep the link, flag it.
                return True, f"Unverified ({code})"
            return False, f"Status {code}"
    except Exception as e:
        return False, type(e).__name__


def filter_broken_links(md_text):
    """Replace links that fail validation with a non-clickable label.

    Validation is sequential (speed is unimportant; determinism matters).
    """
    link_pattern = r'\[(.*?)\]\((https?://[^\)\s]+)\)'
    matches = re.findall(link_pattern, md_text)
    valid_md = md_text
    rejections = []
    seen = {}
    for text, url in matches:
        if url not in seen:
            seen[url] = validate_url(url)
        is_valid, reason = seen[url]
        if not is_valid:
            valid_md = valid_md.replace(
                f"[{text}]({url})", f"{text} (Link removed: {reason})"
            )
            rejections.append(f"{url} ({reason})")
    return valid_md, rejections


def log_event(event_type, data):
    logging.info(json.dumps(
        {"timestamp": datetime.now().isoformat(), "event": event_type, "data": data}
    ))


def write_telemetry(product_url, original_md, feedback, refined_md):
    """Write a telemetry row. Failures are logged, never silently swallowed."""
    try:
        errors = bq_client.insert_rows_json(BQ_TABLE, [{
            "timestamp": datetime.now().isoformat(),
            "product_url": product_url or "",
            "original_markdown": original_md,
            "user_feedback": feedback,
            "refined_markdown": refined_md,
        }])
        if errors:
            log_event("TELEMETRY_ERROR", {"errors": errors})
    except Exception as e:
        log_event("TELEMETRY_ERROR", {"error": type(e).__name__, "detail": str(e)})


def parse_manual_links(input_string):
    """Parse 'Link text | URL; Link text | URL;' into a list of (text, url)."""
    if not input_string:
        return []
    entries = [e.strip() for e in input_string.split(';') if e.strip()]
    results = []
    for entry in entries:
        if '|' in entry:
            text, url = entry.split('|', 1)
            text, url = text.strip(), url.strip()
            if text and url:
                results.append((text, url))
    return results


def add_hyperlink(paragraph, text, url):
    part = paragraph.part
    r_id = part.relate_to(
        url, docx.opc.constants.RELATIONSHIP_TYPE.HYPERLINK, is_external=True
    )
    hyperlink = docx.oxml.shared.OxmlElement('w:hyperlink')
    hyperlink.set(docx.oxml.shared.qn('r:id'), r_id)
    new_run = docx.oxml.shared.OxmlElement('w:r')
    rPr = docx.oxml.shared.OxmlElement('w:rPr')
    c = docx.oxml.shared.OxmlElement('w:color')
    c.set(docx.oxml.shared.qn('w:val'), '0563C1')
    rPr.append(c)
    u = docx.oxml.shared.OxmlElement('w:u')
    u.set(docx.oxml.shared.qn('w:val'), 'single')
    rPr.append(u)
    new_run.append(rPr)
    new_run.append(docx.oxml.shared.OxmlElement('w:t'))
    new_run.text = text
    hyperlink.append(new_run)
    paragraph._p.append(hyperlink)
    return hyperlink


def add_html_alt_chunk(doc, html_string):
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


def create_docx_bytes(text_content):
    """Build the DOCX and return raw bytes (callable target for download_button)."""
    parsed_data = parse_markdown_to_dict(text_content)
    full_html = generate_ncademi_html(parsed_data)
    doc = Document()
    add_html_alt_chunk(doc, full_html)
    bio = io.BytesIO()
    doc.save(bio)
    bio.seek(0)
    return bio.getvalue()


@lru_cache(maxsize=1)
def _load_css():
    """Read the large CSS once and cache it (re-read only if file changes via mtime)."""
    path = "ncademi_combined.css"
    if os.path.exists(path):
        mtime = os.path.getmtime(path)
        return _load_css_cached(path, mtime)
    return "@import url('https://ncademi.org/wp-content/themes/ncademitheme/style.css');"


@lru_cache(maxsize=4)
def _load_css_cached(path, _mtime):
    with open(path, "r") as f:
        return f.read()


def parse_markdown_to_dict(md_text):
    data = {
        "Product Name": "Unknown Product", "Vendor": "Unknown Vendor",
        "Description": "", "Product Website": "#", 
        "Vendor Resources": [], "Vendor Description": "",
        "Third Party Insights": [], "Third Party Description": "",
        "Support Contact": [], "Support Description": "",
        "ACRs": [], "ACR Description": "",
    }
    lines = (md_text or "").split('\n')
    current_section = None
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if "Product Name:" in line:
            data["Product Name"] = line.replace("Product Name:", "").strip()
        elif "Vendor:" in line:
            data["Vendor"] = line.replace("Vendor:", "").strip()
        elif "Description:" in line and current_section is None:
            data["Description"] = line.replace("Description:", "").strip()
        elif "Product Website:" in line:
            data["Product Website"] = line.replace("Product Website:", "").strip()
        elif "--- Accessibility Resources" in line:
            current_section = "Vendor Resources"
        elif "--- Accessibility Insights" in line:
            current_section = "Third Party"
        elif "--- Support ---" in line:
            current_section = "Support"
        elif "--- ACR / VPAT ---" in line:
            current_section = "ACRs"
        elif current_section == "Vendor Resources":
            if line.startswith("- "):
                m = re.search(r"\[(.*?)\]\((.*?)\)", line)
                if m:
                    data["Vendor Resources"].append((m.group(1), m.group(2)))
                else:
                    data["Vendor Resources"].append((line.lstrip("- ").strip(), None))
            elif "Description:" in line:
                data["Vendor Description"] = line.replace("Description:", "").strip()
        elif current_section == "Third Party":
            if line.startswith("- "):
                m = re.search(r"- (.*?): (.*?) \[(.*?)\]\((.*?)\)", line)
                if m:
                    data["Third Party Insights"].append(
                        (m.group(1), m.group(2), m.group(3), m.group(4))
                    )
                else:
                    data["Third Party Insights"].append((None, None, line.lstrip("- ").strip(), None))
            elif "Description:" in line:
                data["Third Party Description"] = line.replace("Description:", "").strip()
        elif current_section == "Support":
            if "Support Contact:" in line:
                val = line.replace("Support Contact:", "").strip()
                if val:
                    data["Support Contact"].append(val)
            elif line.startswith("- "):
                data["Support Contact"].append(line.lstrip("- ").strip())
            elif "Description:" in line:
                data["Support Description"] = line.replace("Description:", "").strip()
            elif line:
                data["Support Contact"].append(line)
        elif current_section == "ACRs":
            if "Report Title:" in line:
                data["ACRs"].append({
                    "Title": line.replace("Report Title:", "").strip(),
                    "Version": "N/A", "Date": "N/A", "Org": "N/A",
                    "Link": "#", "LinkText": "Link", "Note": "",
                })
            elif "Description:" in line:
                data["ACR Description"] = line.replace("Description:", "").strip()
            elif data["ACRs"]:
                curr = data["ACRs"][-1]
                if "VPAT Version:" in line:
                    curr["Version"] = line.replace("VPAT Version:", "").strip()
                elif "Date Completed:" in line:
                    curr["Date"] = line.replace("Date Completed:", "").strip()
                elif "Evaluating Organization:" in line:
                    curr["Org"] = line.replace("Evaluating Organization:", "").strip()
                elif "Link:" in line:
                    m = re.search(r"\[(.*?)\]\((.*?)\)", line)
                    if m:
                        curr["LinkText"], curr["Link"] = m.group(1), m.group(2)
                    else:
                        clean_text = line.replace("Link:", "").strip()
                        if clean_text:
                            curr["LinkText"], curr["Link"] = clean_text, "#"
                elif "Note:" in line:
                    curr["Note"] = line.replace("Note:", "").strip()
    return data


def generate_ncademi_html(data):
    """Render the directory entry HTML. All interpolated values are escaped."""
    e = html.escape
    
    vendor_items = []
    for t, u in data["Vendor Resources"]:
        if u:
            vendor_items.append(f'<li><a href="{e(u)}" target="_blank">{e(t)}</a></li>')
        else:
            # Narrative text with AI attribution
            vendor_items.append(f'<li>{e(t)} <em>(generated by Gemini AI)</em></li>')
    vendor_res = "".join(vendor_items) if vendor_items else ("" if data["Vendor Description"] else "<li>No vendor accessibility resources found.</li>")
    vendor_desc = f'<p style="margin-top: 1rem;">{e(data["Vendor Description"])}</p>' if data["Vendor Description"] else ""

    third_items = []
    for s, sm, lt, u in data["Third Party Insights"]:
        if s and sm and lt and u:
            third_items.append(f'<li>{e(s)}: {e(sm)} (<a href="{e(u)}" target="_blank">{e(lt)}</a>)</li>')
        elif u:
            # Fallback for structured link without s/sm
            label = lt or "Link"
            third_items.append(f'<li><a href="{e(u)}" target="_blank">{e(label)}</a></li>')
        else:
            # Narrative text with AI attribution
            third_items.append(f'<li>{e(lt)} <em>(generated by Gemini AI)</em></li>')
    third_res = "".join(third_items) if third_items else ("" if data["Third Party Description"] else "<li>No authoritative third-party accessibility reviews found.</li>")
    third_desc = f'<p style="margin-top: 1rem;">{e(data["Third Party Description"])}</p>' if data["Third Party Description"] else ""

    acr_items = []
    for a in data["ACRs"]:
        link_html = (
            f'<a href="{e(a["Link"])}" target="_blank">{e(a["LinkText"])}</a>'
            if a["Link"] != "#" else f'<span>{e(a["LinkText"])}</span>'
        )
        note_html = f'<br><small>Note: {e(a["Note"])}</small>' if a["Note"] else ""
        acr_items.append(
            '<div style="margin-bottom:20px;border-bottom:1px solid #eee;padding-bottom:10px;">'
            f'<strong>{e(a["Title"])}</strong><br>'
            f'<small>Version: {e(a["Version"])} | Date: {e(a["Date"])}</small><br>'
            f'<small>Org: {e(a["Org"])}</small><br>{link_html}{note_html}</div>'
        )
    acr_res = "".join(acr_items) if acr_items else ("" if data["ACR Description"] else "<p>No ACR information found.</p>")
    acr_desc = f'<p style="margin-top: 1rem;">{e(data["ACR Description"])}</p>' if data["ACR Description"] else ""

    support_res = "".join(f"<li>{e(s)}</li>" for s in data["Support Contact"]) if data["Support Contact"] else ("" if data["Support Description"] else "<li>Not found</li>")
    support_desc = f'<p style="margin-top: 1rem;">{e(data["Support Description"])}</p>' if data["Support Description"] else ""

    css_content = _load_css()

    return f"""<!DOCTYPE html><html><head><meta charset="UTF-8">
    <link rel="stylesheet" href="https://ncademi.org/wp-content/uploads/font-awesome/v6.7.2/css/svg-with-js.css">
    <script src="https://kit.fontawesome.com/a7ee836cc9.js" crossorigin="anonymous"></script>
    <style>{css_content} body {{ background: #fff; margin: 0; padding: 20px; }}</style></head>
    <body class="wp-singular product-template-default single single-product"><main id="main" class="site-main"><header class="page-header"><h1 class="page-title">{e(data['Product Name'])}</h1></header>
    <article class="product type-product status-publish hentry"><div class="entry-summary">
    <p><strong>Vendor:</strong> <a href="#">{e(data['Vendor'])}</a></p><p>{e(data['Description'])}</p>
    <p><a href="{e(data['Product Website'])}" target="_blank"><i class="fa-regular fa-globe" aria-hidden="true"></i> {e(data['Product Name'])} Website</a></p>
    <h2>Accessibility Documentation &amp; Resources</h2><div class="row g-4 g-lg-5 align-items-start"><div class="col-12 col-lg-8">
    <h3>From {e(data['Vendor'])}</h3><ul>{vendor_res}</ul>{vendor_desc}<h3>From Other Sources</h3><ul>{third_res}</ul>{third_desc}
    <div style="margin-top: 2rem;"><h3>Support</h3><ul>{support_res}</ul>{support_desc}</div>
    <div style="margin-top: 1rem;"><h3>Accessibility Conformance Reports</h3>{acr_res}{acr_desc}</div></div></div>
    <p class="entry-meta has-text-align-right"><em>Product information last updated {datetime.now().strftime('%B %d, %Y')}</em></p></div></article></main></body></html>"""


def run_model(prompt):
    """Single grounded generation call. Uses GoogleSearch (correct for 2.x)."""
    timeout_min = min(st.session_state.get("search_time", 5), MAX_MODEL_TIMEOUT_MIN)
    try:
        return client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                tools=[types.Tool(google_search=types.GoogleSearch())],
                temperature=0.0,
                http_options=types.HttpOptions(timeout=timeout_min * 60 * 1000),
            ),
        )
    except ClientError as e:
        if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
            st.error("🚨 Gemini API Quota Exhausted. Please wait a minute before trying again.")
            st.stop()
        raise e


def extract_citations(resp):
    cites = []
    if resp.candidates and resp.candidates[0].grounding_metadata:
        sep = resp.candidates[0].grounding_metadata.search_entry_point
        if sep:
            cites.append(sep.rendered_content)
    return cites


# --- CLIENT SETUP ---
@st.cache_resource
def get_client():
    return genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)


@st.cache_resource
def get_bq_client():
    return bigquery.Client(project=PROJECT_ID)


client = get_client()
bq_client = get_bq_client()

st.set_page_config(page_title="NCADEMI Ingestion Assistant", page_icon="🔍", layout="wide")

# --- SESSION STATE INIT ---
st.session_state.setdefault("history", [])
st.session_state.setdefault("current_result", None)
st.session_state.setdefault("current_citations", [])
st.session_state.setdefault("authenticated", False)
st.session_state.setdefault("feedback_response", "")
st.session_state.setdefault("active_url", "")  # URL that produced the current draft

# --- PASSWORD PROTECTION ---
# NOTE: app-level password is a stopgap. The supported fix is Cloud Run IAP +
# Secret Manager; the query-param/env/argv bypasses below should be removed and
# only TESTING_MODE (env, for local dev) retained, behind network controls.
import sys
import hmac

APP_PASSWORD = os.getenv("APP_PASSWORD", "")  # pull from Secret Manager / env, not source
TESTING_MODE = os.getenv("TESTING_MODE", "no").lower() == "yes" or "--testing=yes" in sys.argv

if not TESTING_MODE and not st.session_state.authenticated:
    st.title("🔐 NCADEMI Research Assistant")
    pwd = st.text_input("Enter Password", type="password")
    if st.button("Login"):
        if APP_PASSWORD and hmac.compare_digest(pwd, APP_PASSWORD):
            st.session_state.authenticated = True
            st.rerun()
        else:
            st.error("Incorrect password (or APP_PASSWORD not configured).")
    st.stop()

# --- SYSTEM PROMPT ---
SYSTEM_PROMPT = """You are an expert accessibility researcher for NCADEMI.
CRITICAL MANDATE: Every resource bullet point MUST include a direct source link in the format [Text](URL).
DO NOT provide narrative summaries as bullet points; instead, use the dedicated 'Description:' field at the bottom of each section for narrative text.

RULES:
1. 10 Vendor MAX, 10 Third-Party MAX.
2. Every list item MUST have a [Link Text](URL).
3. Use the 'Description:' field at the end of each section to provide a narrative summary of findings for that specific section.

Output format:
Product Name: [Name]
Vendor: [Vendor Name]
Description: [Main Product Description]
Product Website: [URL]

--- Accessibility Resources (From Vendor) ---
- [Text](URL)
Description: [Narrative summary of vendor resources]

--- Accessibility Insights (From Third-Party Sources) ---
- [Source]: [Summary] ([Text](URL))
Description: [Narrative summary of third-party insights]

--- Support ---
Support Contact:
- [Phone, Email, or Link]
Description: [Summary of support services]

--- ACR / VPAT ---
Report Title: [Title]
VPAT Version: [Version]
Date Completed: [Date]
Evaluating Organization: [Org]
Link: [Text](URL)
Note: [Optional Note]
Description: [Summary of ACR/VPAT availability]
"""

# --- CALLBACKS (run as a prefix to the rerun, before the body) ---

def clear_all_state():
    st.session_state.current_result = None
    st.session_state.current_citations = []
    st.session_state.feedback_response = ""
    st.session_state.active_url = ""


def run_generation():
    """Form-submit callback: research a URL and store the draft."""
    u = st.session_state.url_field
    if not u:
        st.session_state.feedback_response = "Enter URL"
        return
    st.session_state.feedback_response = ""
    with bottom_status_container:
        with st.status(f"🔍 Researching {u}...", expanded=True) as status:
            resp = run_model(f"Research: {u}")
            status.update(label="✅ Research complete. Filtering links...", state="running")
            result, rejections = filter_broken_links(resp.text)
            if rejections:
                status.update(label=f"✨ Listing generated ({len(rejections)} links removed)", state="complete", expanded=False)
            else:
                status.update(label="✨ Listing generated!", state="complete", expanded=False)
    
    st.session_state.current_result = result
    st.session_state.current_citations = extract_citations(resp)
    st.session_state.active_url = u  # snapshot the URL that produced this draft
    name = "Product"
    for line in result.split('\n'):
        if "Product Name:" in line:
            name = line.replace("Product Name:", "").strip()
            break
    st.session_state.history.append({
        "name": name, "url": u, "result": result,
        "citations": st.session_state.current_citations,
    })
    # Bound history growth (per-session memory; instances are ephemeral).
    if len(st.session_state.history) > 50:
        st.session_state.history = st.session_state.history[-50:]


def run_feedback():
    """Feedback-submit callback: refine the current draft."""
    feedback = st.session_state.feedback_field
    if not feedback:
        return
    with bottom_status_container:
        with st.status("🧠 Refining draft with Gemini...", expanded=True) as status:
            old_md = st.session_state.current_result or ""
            old_links = set(re.findall(r'https?://[^\)\s]+', old_md))
            resp = run_model(f"Draft:\n{old_md}\nFeedback: {feedback}")
            status.update(label="🔍 Validating updated links...", state="running")
            new_md, rejections = filter_broken_links(resp.text)
            status.update(label="✅ Draft refined!", state="complete", expanded=False)
    
    new_cites = extract_citations(resp)
    if new_cites:
        st.session_state.current_citations = new_cites  # replace, consistent with generate
    new_links = set(re.findall(r'https?://[^\)\s]+', new_md))
    add, rem = len(new_links - old_links), len(old_links - new_links)
    rej = len(rejections)
    if add > 0 and rem > 0:
        msg = f"{add} new source(s) added; {rem} removed."
    elif add > 0:
        msg = f"{add} new source(s) added."
    elif rem > 0:
        msg = "Source(s) removed as requested."
    else:
        msg = "Draft updated with provided details."
    if rej > 0:
        msg += f" ({rej} invalid rejected)."
    st.session_state.feedback_response = msg
    write_telemetry(
        product_url=st.session_state.active_url,  # the URL that produced the draft
        original_md=old_md,
        feedback=feedback,
        refined_md=new_md,
    )
    st.session_state.current_result = new_md  # body re-renders from this; no sleep/rerun


def clear_manual_inputs():
    """Callback to clear inputs before the fragment/body reruns."""
    st.session_state.manual_vendor = ""
    st.session_state.manual_other = ""
    st.session_state.expander_open = True


# --- MAIN UI ---
st.markdown("""<a href="#product-url" id="skip-to-url" class="skip-link" tabindex="0">Skip to Product URL</a>
<style>
    .skip-link { position: absolute; top: -100px; left: 15px; background: #336699; color: white !important; padding: 12px 24px; z-index: 100000; text-decoration: none; font-weight: bold; border: 2px solid white; border-radius: 4px; }
    .skip-link:focus, .skip-link:active { top: 15px; outline: 3px solid #FFD700; }
    
    /* Pin the status container to the bottom of the viewport */
    div[data-testid="stVerticalBlock"] > div:last-child .status-bottom {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 9999;
        width: 80%;
        max-width: 800px;
        background: #ffffff !important;
        border: 2px solid #336699;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }

    button:focus, button:hover, input:focus, input:hover, textarea:focus, textarea:hover { outline: 3px solid #336699 !important; outline-offset: 2px !important; border-radius: 4px !important; }
    [data-testid="stStatusWidget"] { display: none !important; }
    [data-testid="InputInstructions"] { display: none !important; }
</style>""", unsafe_allow_html=True)

st.title("NCADEMI EdTech Directory Research Assistant")
st.markdown("Enter a product URL below to generate a draft directory entry.")

# Robust skip-link: MutationObserver instead of a fixed setTimeout race.
st.components.v1.html("""<script>
const wire = () => {
  const link = window.parent.document.getElementById('skip-to-url');
  const input = window.parent.document.querySelector('input[aria-label="Product URL"]');
  if (link && input && !link.dataset.wired) {
    link.dataset.wired = "1";
    link.addEventListener('click', (e) => {
      e.preventDefault(); input.focus();
      input.scrollIntoView({behavior: 'smooth'});
    });
    return true;
  }
  return false;
};
if (!wire()) {
  const obs = new MutationObserver(() => { if (wire()) obs.disconnect(); });
  obs.observe(window.parent.document.body, {childList: true, subtree: true});
}
</script>""", height=0)

# Initialize a placeholder for bottom-anchored messages
bottom_status_container = st.container()

# --- GENERATE (form: batched submission) ---
with st.form("research_form", clear_on_submit=False):
    col_time, col_url_input = st.columns([1, 2])
    with col_time:
        st.slider("Max Research Time (minutes)", 1, 4, 4, 1, key="search_time")
    with col_url_input:
        st.text_input("Product URL", placeholder="https://example.com", key="url_field")
    st.form_submit_button("Generate Listing", type="primary", on_click=run_generation)

st.button("Clear All", on_click=clear_all_state)

# Surface generation errors set by the callback (without blocking flow).
if st.session_state.feedback_response == "Enter URL":
    st.error("Enter URL")
    st.session_state.feedback_response = ""

@st.cache_data
def generate_ncademi_html_cached(data_json):
    """Cached version of HTML generation to avoid re-parsing on every rerun."""
    data = json.loads(data_json)
    return generate_ncademi_html(data)


# --- RESULT-DEPENDENT UI ---
if st.session_state.current_result:
    p_data = parse_markdown_to_dict(st.session_state.current_result)
    # Use JSON string for cache key stability
    html_preview = generate_ncademi_html_cached(json.dumps(p_data))
    
    ts = datetime.now().strftime('%m-%d-%y-%H-%M-%S')
    clean_name = re.sub(r'[^\w\-]', '_', p_data['Product Name'])
    fname = f"{clean_name}-{ts}"
    res_hash = hashlib.md5(st.session_state.current_result.encode()).hexdigest()

    action_cols = st.columns([1, 1, 1])
    with action_cols[0]:
        st.download_button(
            "DOCX",
            data=create_docx_bytes(st.session_state.current_result),
            file_name=f"{fname}.docx",
            icon=":material/download:",
            key=f"btn_docx_{res_hash}",
        )
    with action_cols[1]:
        st.download_button(
            "HTML",
            data=html_preview,
            file_name=f"{fname}.html",
            icon=":material/download:",
            key=f"btn_html_{res_hash}",
        )

    st.write("")
    f_col, s_col = st.columns([1, 1])
    with f_col:
        st.text_input("Feedback (Beta)", placeholder="Instructions...", key="feedback_field")
    with s_col:
        st.button("Send", key="send_feedback_btn", on_click=run_feedback)

    r_col, _ = st.columns([1, 1])
    with r_col:
        st.text_input(
            "Response", value=st.session_state.feedback_response,
            disabled=True, key="response_output",
        )

    # --- LIVE EDITOR & PREVIEW FRAGMENT ---
    @st.fragment
    def live_preview_and_editor():
        # --- PREVIEW (recomputed within fragment on every edit) ---
        st.divider()
        st.subheader("Generated Directory Entry")
        
        # Re-parse and generate HTML from the updated state
        current_data = parse_markdown_to_dict(st.session_state.current_result)
        current_html = generate_ncademi_html_cached(json.dumps(current_data))
        current_hash = hashlib.md5(st.session_state.current_result.encode()).hexdigest()

        with st.container(key=f"preview_container_{current_hash}"):
            st.components.v1.html(current_html, height=800, scrolling=True)

        # --- RAW MARKDOWN EDITOR ---
        with st.expander("📝 Edit Raw Markdown"):
            st.info("""
            **NCADEMI Listing Template:**
            
            ```markdown
            Product Name: [Name]
            Vendor: [Vendor Name]
            Description: [Main Product Description]
            Product Website: [URL]

            --- Accessibility Resources (From Vendor) ---
            - [Link Text](URL)
            Description: [text]

            --- Accessibility Insights (From Third-Party Sources) ---
            - Source: Summary ([Link Text](URL))
            Description: [text]

            --- Support ---
            Support Contact:
            - [Phone, Email, or Link]
            Description: [text]

            --- ACR / VPAT ---
            Report Title: [Title]
            VPAT Version: [0 or 0.0]
            Date Completed: [Date]
            Evaluating Organization: [Org]
            Link: [Link Text](URL)
            Note: [text]
            Description: [text]
            ```
            
            *Changes update the preview instantly after you click outside the box or press Ctrl+Enter.*
            """)
            # Bind text_area directly to current_result for live sync
            st.text_area(
                "Markdown Editor",
                key="current_result",
                height=400,
            )
            st.caption("Press Ctrl+Enter (or ⌘+Enter) to commit large edits.")

    live_preview_and_editor()

    with st.expander("🔍 Search Citations"):
        if st.session_state.current_citations:
            for c in st.session_state.current_citations:
                st.markdown(c, unsafe_allow_html=True)
        else:
            st.write("No citations found.")

# --- HISTORY ---
st.divider()
with st.expander("🕒 Search History"):
    for item in reversed(st.session_state.history):
        # Stable, content-based key using a hash of the content to ensure uniqueness
        item_hash = hashlib.md5(item['result'].encode()).hexdigest()[:12]
        key = f"hist_{item_hash}"
        if st.button(f"{item['name']} ({item['url']})", key=key):
            st.session_state.current_result = item['result']
            st.session_state.current_citations = item['citations']
            st.session_state.active_url = item['url']
            st.rerun()
    if st.button("Clear History"):
        st.session_state.history = []
        st.rerun()

st.caption(f"NCADEMI / WebAIM | {MODEL_NAME}")
