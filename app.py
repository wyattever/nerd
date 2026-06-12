# --- NCADEMI Research Assistant ---
import streamlit as st
import os
import logging
import json
import io
import re
import base64
import warnings
import docx
import time
import httpx
from docx import Document
from docx.shared import Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.opc.part import Part
from docx.opc.constants import CONTENT_TYPE as CT
from datetime import datetime
from google import genai
from google.genai import types
from google.cloud import bigquery
from dotenv import load_dotenv

# Suppress Python 3.9 EOL warnings
warnings.filterwarnings("ignore", category=FutureWarning, module="google.auth")
warnings.filterwarnings("ignore", category=FutureWarning, module="google.oauth2")

# --- UTILITIES ---
def validate_url(url):
    """Verifies if a URL is valid, public, and not a search redirect."""
    if "grounding-api-redirect" in url:
        return False, "Search Proxy"
    try:
        with httpx.Client(timeout=5.0, follow_redirects=True) as client:
            resp = client.head(url)
            if resp.status_code == 200: return True, "OK"
            resp = client.get(url)
            if resp.status_code == 200: return True, "OK"
            return False, f"Status {resp.status_code}"
    except Exception as e:
        return False, str(type(e).__name__)

def filter_broken_links(md_text):
    """Identifies and removes broken links from a markdown string."""
    link_pattern = r'\[(.*?)\]\((https?://[^\)\s]+)\)'
    matches = re.findall(link_pattern, md_text)
    valid_md = md_text
    rejected_count = 0
    for text, url in matches:
        is_valid, reason = validate_url(url)
        if not is_valid:
            valid_md = valid_md.replace(f"[{text}]({url})", f"{text} (Link removed: {reason})")
            rejected_count += 1
    return valid_md, rejected_count

def log_event(event_type, data):
    logging.info(json.dumps({"timestamp": datetime.now().isoformat(), "event": event_type, "data": data}))

def parse_manual_links(input_string):
    """Parses 'Link text | URL; Link text | URL;' format into a list of (text, url) tuples."""
    if not input_string: return []
    entries = [e.strip() for e in input_string.split(';') if e.strip()]
    results = []
    for entry in entries:
        if '|' in entry:
            parts = entry.split('|')
            results.append((parts[0].strip(), parts[1].strip()))
    return results

def add_hyperlink(paragraph, text, url):
    part = paragraph.part
    r_id = part.relate_to(url, docx.opc.constants.RELATIONSHIP_TYPE.HYPERLINK, is_external=True)
    hyperlink = docx.oxml.shared.OxmlElement('w:hyperlink')
    hyperlink.set(docx.oxml.shared.qn('r:id'), r_id, )
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
    r_id = doc.part.relate_to(html_part, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk')
    alt_chunk = OxmlElement('w:altChunk')
    alt_chunk.set(qn('r:id'), r_id)
    doc.element.body.append(alt_chunk)

def create_docx(text_content):
    parsed_data = parse_markdown_to_dict(text_content)
    full_html = generate_ncademi_html(parsed_data)
    doc = Document()
    add_html_alt_chunk(doc, full_html)
    bio = io.BytesIO()
    doc.save(bio)
    bio.seek(0)
    return bio

def parse_markdown_to_dict(md_text):
    data = {"Product Name": "Unknown Product", "Vendor": "Unknown Vendor", "Description": "", "Product Website": "#", "Vendor Resources": [], "Third Party Insights": [], "Support Contact": "Not found", "ACRs": []}
    lines = md_text.split('\n')
    current_section = None
    for line in lines:
        line = line.strip()
        if not line: continue
        if "Product Name:" in line: data["Product Name"] = line.replace("Product Name:", "").strip()
        elif "Vendor:" in line: data["Vendor"] = line.replace("Vendor:", "").strip()
        elif "Description:" in line: data["Description"] = line.replace("Description:", "").strip()
        elif "Product Website:" in line: data["Product Website"] = line.replace("Product Website:", "").strip()
        elif "--- Accessibility Resources" in line: current_section = "Vendor Resources"
        elif "--- Accessibility Insights" in line: current_section = "Third Party"
        elif "--- Support ---" in line: current_section = "Support"
        elif "--- ACR / VPAT ---" in line: current_section = "ACRs"
        elif current_section == "Vendor Resources" and line.startswith("- ["):
            m = re.search(r"\[(.*?)\]\((.*?)\)", line)
            if m: data["Vendor Resources"].append((m.group(1), m.group(2)))
        elif current_section == "Third Party" and line.startswith("- "):
            m = re.search(r"- (.*?): (.*?) \[(.*?)\]\((.*?)\)", line)
            if m: data["Third Party Insights"].append((m.group(1), m.group(2), m.group(3), m.group(4)))
        elif current_section == "Support" and "Support Contact:" in line: data["Support Contact"] = line.replace("Support Contact:", "").strip()
        elif current_section == "ACRs":
            if "Report Title:" in line: data["ACRs"].append({"Title": line.replace("Report Title:", "").strip(), "Version": "N/A", "Date": "N/A", "Org": "N/A", "Link": "#", "LinkText": "Link", "Note": ""})
            elif data["ACRs"]:
                curr = data["ACRs"][-1]
                if "VPAT Version:" in line: curr["Version"] = line.replace("VPAT Version:", "").strip()
                elif "Date Completed:" in line: curr["Date"] = line.replace("Date Completed:", "").strip()
                elif "Evaluating Organization:" in line: curr["Org"] = line.replace("Evaluating Organization:", "").strip()
                elif "Link:" in line:
                    m = re.search(r"\[(.*?)\]\((.*?)\)", line)
                    if m: 
                        curr["LinkText"], curr["Link"] = m.group(1), m.group(2)
                    else:
                        # Fallback for when filter_broken_links removes the markdown formatting
                        clean_text = line.replace("Link:", "").strip()
                        if clean_text:
                            curr["LinkText"] = clean_text
                            curr["Link"] = "#"
                elif "Note:" in line: curr["Note"] = line.replace("Note:", "").strip()
    return data

def generate_ncademi_html(data):
    vendor_res = "".join([f'<li><a href="{u}" target="_blank">{t}</a></li>' for t, u in data["Vendor Resources"]]) if data["Vendor Resources"] else "<li>No vendor accessibility resources found.</li>"
    third_res = "".join([f'<li>{s}: {sm} (<a href="{u}" target="_blank">{lt}</a>)</li>' for s, sm, lt, u in data["Third Party Insights"]]) if data["Third Party Insights"] else "<li>No authoritative third-party accessibility reviews found.</li>"
    acr_res = "".join([f'<div style="margin-bottom:20px;border-bottom:1px solid #eee;padding-bottom:10px;"><strong>{a["Title"]}</strong><br><small>Version: {a["Version"]} | Date: {a["Date"]}</small><br><small>Org: {a["Org"]}</small><br>' + (f'<a href="{a["Link"]}" target="_blank">{a["LinkText"]}</a>' if a["Link"] != "#" else f'<span>{a["LinkText"]}</span>') + (f'<br><small>Note: {a["Note"]}</small>' if a["Note"] else "") + '</div>' for a in data["ACRs"]]) if data["ACRs"] else "<p>No ACR information found.</p>"
    css_content = "@import url('https://ncademi.org/wp-content/themes/ncademitheme/style.css');"
    if os.path.exists("ncademi_combined.css"):
        with open("ncademi_combined.css", "r") as f: css_content = f.read()
    return f"""<!DOCTYPE html><html><head><meta charset="UTF-8">
    <link rel="stylesheet" href="https://ncademi.org/wp-content/uploads/font-awesome/v6.7.2/css/svg-with-js.css">
    <script src="https://kit.fontawesome.com/a7ee836cc9.js" crossorigin="anonymous"></script>
    <style>{css_content} body {{ background: #fff; margin: 0; padding: 20px; }}</style></head>
    <body class="wp-singular product-template-default single single-product"><main id="main" class="site-main"><header class="page-header"><h1 class="page-title">{data['Product Name']}</h1></header>
    <article class="product type-product status-publish hentry"><div class="entry-summary">
    <p><strong>Vendor:</strong> <a href="#">{data['Vendor']}</a></p><p>{data['Description']}</p>
    <p><a href="{data['Product Website']}" target="_blank"><i class="fa-regular fa-globe" aria-hidden="true"></i> {data['Product Name']} Website</a></p>
    <h2>Accessibility Documentation & Resources</h2><div class="row g-4 g-lg-5 align-items-start"><div class="col-12 col-lg-8">
    <h3>From {data['Vendor']}</h3><ul>{vendor_res}</ul><h3>From Other Sources</h3><ul>{third_res}</ul>
    <div style="margin-top: 2rem;"><h3>Support</h3><ul><li>{data["Support Contact"]}</li></ul></div>
    <div style="margin-top: 1rem;"><h3>Accessibility Conformance Reports</h3>{acr_res}</div></div></div>
    <p class="entry-meta has-text-align-right"><em>Product information last updated {datetime.now().strftime('%B %d, %Y')}</em></p></div></article></main></body></html>"""

# --- SETUP ---
load_dotenv()
PROJECT_ID = "edtech-agent-2026"; LOCATION = "us-central1"
@st.cache_resource
def get_client(): return genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
client = get_client()
@st.cache_resource
def get_bq_client(): return bigquery.Client(project=PROJECT_ID)
bq_client = get_bq_client()

st.set_page_config(page_title="NCADEMI Ingestion Assistant", page_icon="🔍", layout="wide")

if 'history' not in st.session_state: st.session_state.history = []
if 'current_result' not in st.session_state: st.session_state.current_result = None
if 'current_citations' not in st.session_state: st.session_state.current_citations = []
if 'authenticated' not in st.session_state: st.session_state.authenticated = False
if 'feedback_response' not in st.session_state: st.session_state.feedback_response = ""
if 'manual_vendor' not in st.session_state: st.session_state.manual_vendor = ""
if 'manual_other' not in st.session_state: st.session_state.manual_other = ""

# Password Protection
import sys
TESTING_MODE = os.getenv("TESTING_MODE", "no").lower() == "yes" or st.query_params.get("testing") == "yes" or "--testing=yes" in sys.argv
if not TESTING_MODE and not st.session_state.authenticated:
    st.title("🔐 NCADEMI Research Assistant")
    pwd = st.text_input("Enter Password", type="password")
    if st.button("Login") and pwd == "edtechRA61126":
        st.session_state.authenticated = True; st.rerun()
    st.stop()

# --- MAIN UI ---
st.markdown("""<a href="#product-url" id="skip-to-url" class="skip-link">Skip to Product URL</a>
<style>
    .skip-link { position: absolute; top: -100px; left: 15px; background: #336699; color: white !important; padding: 12px 24px; z-index: 100000; text-decoration: none; font-weight: bold; border: 2px solid white; border-radius: 4px; }
    .skip-link:focus { top: 15px; outline: 3px solid #FFD700; }
    button:focus, button:hover, input:focus, input:hover, textarea:focus, textarea:hover, [data-testid="stTextInput"] div:focus-within { outline: 3px solid #336699 !important; outline-offset: 2px !important; border-radius: 4px !important; transition: outline 0.1s ease-in-out; }
    [data-testid="stStatusWidget"] { display: none !important; }
    [data-testid="stHorizontalBlock"] { gap: 25px !important; justify-content: flex-start !important; align-items: flex-end !important; }
    [data-testid="stColumn"] { flex: none !important; }
    [data-testid="stColumn"]:has(div[data-testid="stTextInput"]) { width: 600px !important; min-width: 600px !important; }
    [data-testid="stColumn"]:has(button), [data-testid="stColumn"]:has(.stDownloadButton) { width: 150px !important; min-width: 150px !important; }
    div[data-testid="stTextInput"], div[data-testid="stTextInput"] input { width: 600px !important; }
    .stButton button, .stDownloadButton button { width: 150px !important; margin-bottom: 0px !important; }
    div.st-key-btn_docx button { background-color: #336699 !important; border-color: #336699 !important; }
    div.st-key-btn_docx button * { color: white !important; fill: white !important; }
    div.st-key-btn_html button { background-color: #333333 !important; border-color: #333333 !important; }
    div.st-key-btn_html button * { color: white !important; fill: white !important; }
    div[data-testid="stTextInput"] { margin-bottom: 0px !important; }
    div[data-testid="stSpinner"] { white-space: nowrap !important; }
    [data-testid="InputInstructions"] { display: none !important; }
</style>""", unsafe_allow_html=True)

st.title("NCADEMI EdTech Directory Research Assistant")
st.markdown("Enter a product URL below to generate a draft directory entry.")
st.components.v1.html("""<script>const setupSkip = () => { const link = window.parent.document.getElementById('skip-to-url'); if (link) { link.addEventListener('click', (e) => { e.preventDefault(); const input = window.parent.document.querySelector('input[aria-label="Product URL"]'); if (input) { input.focus(); input.scrollIntoView({behavior: 'smooth'}); } }); } }; setTimeout(setupSkip, 1000);</script>""", height=0)

SYSTEM_PROMPT = """You are an expert accessibility researcher for NCADEMI. 
RULES: 10 Vendor MAX, 10 Third-Party MAX. Direct URLs only. Use descriptive [Text](URL). 
Output format:
Product Name: [Name]
Vendor: [Vendor Name]
Description: [Description]
Product Website: [URL]

--- Accessibility Resources (From Vendor) ---
- [Text](URL)

--- Accessibility Insights (From Third-Party Sources) ---
- [Source]: [Summary] ([Text](URL))

--- Support ---
Support Contact: [Contact]

--- ACR / VPAT ---
Report Title: [Title]
VPAT Version: [Version]
Date Completed: [Date]
Evaluating Organization: [Org]
Link: [Text](URL)
"""

with st.form("research_form", clear_on_submit=False):
    col_time, col_url_input = st.columns([1, 2])
    with col_time: 
        max_search_time = st.slider("Max Research Time (minutes)", 1, 10, 5, 1, key="search_time")
    with col_url_input:
        url_input = st.text_input("Product URL", placeholder="https://example.com", key="url_field")
    
    col_gen, col_clear_btn = st.columns([1, 1])
    with col_gen:
        generate_clicked = st.form_submit_button("Generate Listing", type="primary")
    with col_clear_btn:
        # We can't put a regular button that reruns inside a form easily if we want it to act immediately
        # So we'll put the clear logic outside or handle it via session state.
        pass

if st.button("Clear All"): 
    st.session_state.current_result = None
    st.session_state.current_citations = []
    st.session_state.feedback_response = ""
    st.rerun()

if generate_clicked:
    u = st.session_state.url_field
    t = st.session_state.search_time
    if not u:
        st.error("Enter URL")
    else:
        with st.spinner(f"Running {t}-minute max research session...."):
            st.session_state.feedback_response = ""
            resp = client.models.generate_content(
                model="gemini-2.5-flash", 
                contents=f"Research: {u}", 
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT, 
                    tools=[types.Tool(google_search=types.GoogleSearchRetrieval())], 
                    temperature=0.0, 
                    http_options=types.HttpOptions(timeout=t*60*1000)
                )
            )
            st.session_state.current_result, _ = filter_broken_links(resp.text)
            cites = []
            if resp.candidates and resp.candidates[0].grounding_metadata:
                if resp.candidates[0].grounding_metadata.search_entry_point: 
                    cites.append(resp.candidates[0].grounding_metadata.search_entry_point.rendered_content)
            st.session_state.current_citations = cites
            name = "Product"
            for l in st.session_state.current_result.split('\n'):
                if "Product Name:" in l: name = l.replace("Product Name:", "").strip(); break
            st.session_state.history.append({"name": name, "url": u, "result": st.session_state.current_result, "citations": st.session_state.current_citations})
            st.rerun()

action_cols = st.columns([1, 1, 1])

if st.session_state.current_result:
    p_data = parse_markdown_to_dict(st.session_state.current_result)
    ts = datetime.now().strftime('%m-%d-%y-%H-%M-%S')
    clean_name = re.sub(r'[^\w\-]', '_', p_data['Product Name'])
    fname = f"{clean_name}-{ts}"
    with action_cols[0]: st.download_button("DOCX", data=create_docx(st.session_state.current_result), file_name=f"{fname}.docx", icon=":material/download:", key="btn_docx")
    with action_cols[1]: st.download_button("HTML", data=generate_ncademi_html(p_data), file_name=f"{fname}.html", icon=":material/download:", key="btn_html")

    st.write("")
    f_col, s_col = st.columns([1, 1])
    with f_col: feedback = st.text_input("Feedback (Beta)", placeholder="Instructions...", key="feedback_field")
    with s_col:
        if st.button("Send", key="send_feedback_btn"):
            if feedback:
                with st.spinner(f"Processing feedback for up to {max_search_time} minutes..."):
                    old_md = st.session_state.current_result
                    old_links = set(re.findall(r'https?://[^\)\s]+', old_md))
                    resp = client.models.generate_content(model="gemini-2.5-flash", contents=f"Draft:\n{old_md}\nFeedback: {feedback}", config=types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT, tools=[types.Tool(google_search=types.GoogleSearchRetrieval())], temperature=0.0, http_options=types.HttpOptions(timeout=max_search_time*60*1000)))
                    new_md, rej = filter_broken_links(resp.text)
                    if resp.candidates and resp.candidates[0].grounding_metadata and resp.candidates[0].grounding_metadata.search_entry_point:
                        st.session_state.current_citations.append(resp.candidates[0].grounding_metadata.search_entry_point.rendered_content)
                    new_links = set(re.findall(r'https?://[^\)\s]+', new_md))
                    add, rem = len(new_links - old_links), len(old_links - new_links)
                    if add > 0 and rem > 0: st.session_state.feedback_response = f"{add} new source(s) added; {rem} removed."
                    elif add > 0: st.session_state.feedback_response = f"{add} new source(s) added."
                    elif rem > 0: st.session_state.feedback_response = f"Source(s) removed as requested."
                    else: st.session_state.feedback_response = "Draft updated with provided details."
                    if rej > 0: st.session_state.feedback_response += f" ({rej} invalid rejected)."
                    try: bq_client.insert_rows_json("telemetry.feedback_logs", [{"timestamp": datetime.now().isoformat(), "product_url": url_input, "original_markdown": old_md, "user_feedback": feedback, "refined_markdown": new_md}])
                    except: pass
                    st.session_state.current_result = new_md; time.sleep(0.5); st.rerun()

    r_col, _ = st.columns([1, 1])
    with r_col: st.text_input("Response", value=st.session_state.feedback_response, disabled=True, key="response_output")

    # --- ADD RESOURCES WIDGET ---
    def add_manual_resources():
        new_md = st.session_state.current_result
        added_vendor = parse_manual_links(st.session_state.manual_vendor)
        added_other = parse_manual_links(st.session_state.manual_other)
        
        if added_vendor:
            v_lines = "\n".join([f"- [{t}]({u})" for t, u in added_vendor])
            if "--- Accessibility Resources (From Vendor) ---" in new_md:
                new_md = new_md.replace("--- Accessibility Resources (From Vendor) ---", f"--- Accessibility Resources (From Vendor) ---\n{v_lines}")
        
        if added_other:
            o_lines = "\n".join([f"- Manual Source: Added by User ([{t}]({u}))" for t, u in added_other])
            if "--- Accessibility Insights (From Third-Party Sources) ---" in new_md:
                new_md = new_md.replace("--- Accessibility Insights (From Third-Party Sources) ---", f"--- Accessibility Insights (From Third-Party Sources) ---\n{o_lines}")
        
        if added_vendor or added_other:
            temp_md, rej = filter_broken_links(new_md)
            if len(re.findall(r'https?://[^\)\s]+', temp_md)) > len(re.findall(r'https?://[^\)\s]+', st.session_state.current_result)):
                st.session_state.current_result = temp_md
                st.session_state.feedback_response = "Link(s) added successfully."
                if rej > 0: st.session_state.feedback_response += f" ({rej} invalid rejected)."
                st.session_state.manual_vendor = ""
                st.session_state.manual_other = ""
                try: bq_client.insert_rows_json("telemetry.feedback_logs", [{"timestamp": datetime.now().isoformat(), "product_url": st.session_state.url_field, "original_markdown": st.session_state.current_result, "user_feedback": "Manual link addition", "refined_markdown": temp_md}])
                except: pass
            else:
                st.session_state.feedback_response = "Error: Link(s) were invalid or already present."

    with st.expander("➕ Add Resources"):
        st.markdown("To add additional resources, add link text and the URL in this format: `Link text | URL; Link text | URL;...`")
        st.text_area("From Vendor", placeholder="Camtasia Accessibility | https://example.com; ...", key="manual_vendor")
        st.text_area("From Other Sources", placeholder="External Guide | https://example.com; ...", key="manual_other")
        st.button("Add to Listing", on_click=add_manual_resources)

if st.session_state.current_result:
    st.divider(); st.subheader("Generated Directory Entry")
    st.components.v1.html(generate_ncademi_html(parse_markdown_to_dict(st.session_state.current_result)), height=800, scrolling=True)
    with st.expander("🔍 Search Citations"):
        if st.session_state.current_citations:
            for c in st.session_state.current_citations: st.markdown(c, unsafe_allow_html=True)
        else: st.write("No citations found.")

st.divider()
with st.expander("🕒 Search History"):
    for idx, item in enumerate(reversed(st.session_state.history)):
        if st.button(f"{item['name']} ({item['url']})", key=f"hist_{idx}"):
            st.session_state.current_result, st.session_state.current_citations = item['result'], item['citations']
            st.rerun()
    if st.button("Clear History"): st.session_state.history = []; st.rerun()

st.caption("NCADEMI / WebAIM | Gemini 2.0 Flash")
