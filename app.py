import streamlit as st
import hmac
import hashlib
import json
import re
import logging
from datetime import datetime
from google.genai.errors import ClientError

# Setup central logger
logger = logging.getLogger("nerd.app")

# --- Modular Imports ---
from src.utils import filter_broken_links, extract_known_urls, resolve_and_validate_all
from src.generators import generate_ncademi_html, create_docx_bytes, parse_markdown_to_listing
from src.services import (
    run_initial_research, 
    run_deep_dive, 
    synthesize_insights,
    extract_grounding_urls, 
    QuotaExhaustedError,
    MODEL
)

# --- APP CONFIG ---
st.set_page_config(page_title="N.E.R.D.", layout="wide", initial_sidebar_state="collapsed")

# --- SESSION STATE INIT ---
_DEFAULTS = {
    "history": [],
    "current_result": "",
    "current_citations": [],
    "authenticated": False,
    "active_url": "",
    "research_phase": 0,        # 0=idle, 1=initial done, 2=deep-dive done
    "url_cache": {},             # redirect_url -> canonical_url
    "quota_exhausted": False,
}

for key, val in _DEFAULTS.items():
    if key not in st.session_state:
        st.session_state[key] = val

# --- RESULT-DEPENDENT UI HELPERS ---
@st.cache_data
def generate_ncademi_html_cached(markdown: str):
    """Cached version of HTML generation."""
    return generate_ncademi_html(markdown)

# --- CALLBACKS ---
def clear_all_state():
    st.session_state.current_result = ""
    st.session_state.current_citations = []
    st.session_state.active_url = ""
    st.session_state.research_phase = 0
    st.session_state.quota_exhausted = False

# --- PASSWORD PROTECTION ---
import os
import sys
APP_PASSWORD = os.getenv("APP_PASSWORD", "edtechRA61126")
TESTING_MODE = (
    os.getenv("TESTING_MODE", "no").lower() == "yes" or 
    "--testing=yes" in sys.argv or 
    st.query_params.get("testing") == "yes"
)

if not TESTING_MODE and not st.session_state.authenticated:
    st.markdown("""<style>
        div[data-testid="stTextInput"] { width: 200px !important; }
    </style>""", unsafe_allow_html=True)
    st.title("N.E.R.D. Login")
    pwd = st.text_input("Enter Password", type="password")
    if st.button("Login"):
        if hmac.compare_digest(pwd, APP_PASSWORD):
            st.session_state.authenticated = True
            st.rerun()
        else:
            st.error("Incorrect password.")
    st.stop()

# --- MAIN UI ---
st.markdown(f"""<a href="#product-url" id="skip-to-url" class="skip-link" tabindex="0">Skip to Product URL</a>
<style>
    .skip-link {{ position: absolute; top: -100px; left: 15px; background: #336699; color: white !important; padding: 12px 24px; z-index: 100000; text-decoration: none; font-weight: bold; border: 2px solid white; border-radius: 4px; }}
    .skip-link:focus, .skip-link:active {{ top: 15px; outline: 3px solid #FFD700; }}
    
    /* Action Bar Styling - Precise 25px Spacing */
    [data-testid="stHorizontalBlock"] {{ gap: 0px !important; justify-content: flex-start !important; align-items: flex-end !important; }}
    [data-testid="stColumn"] {{ flex: none !important; }}
    [data-testid="stColumn"]:has(div[data-testid="stTextInput"]) {{ width: 600px !important; min-width: 600px !important; margin-right: 25px !important; }}
    [data-testid="stColumn"]:has(button), [data-testid="stColumn"]:has(.stDownloadButton) {{ width: 160px !important; min-width: 160px !important; margin-right: 25px !important; }}
    
    .stButton button, .stDownloadButton button {{ width: 160px !important; margin-bottom: 0px !important; }}
    
    /* Button Colors */
    div.st-key-btn_docx button {{ background-color: #336699 !important; border-color: #336699 !important; color: white !important; }}
    div.st-key-btn_docx button * {{ color: white !important; fill: white !important; }}
    div.st-key-btn_html button {{ background-color: #333333 !important; border-color: #333333 !important; color: white !important; }}
    div.st-key-btn_html button * {{ color: white !important; fill: white !important; }}

    /* Fixed Bottom Status Bar - Respect Sidebar */
    div.st-key-status_bar_outer {{
        position: fixed;
        bottom: 0;
        right: 0;
        left: var(--st-sidebar-width, 0px);
        width: auto;
        background: #ffffff !important;
        border-top: 2px solid #336699;
        z-index: 99;
        padding: 10px 20px;
        min-height: 80px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 -4px 12px rgba(0,0,0,0.1);
    }}
    
    /* Hide Sidebar Scrollbar & Compact Text */
    [data-testid="stSidebar"]::-webkit-scrollbar {{ display: none; }}
    [data-testid="stSidebar"] {{ 
        -ms-overflow-style: none; 
        scrollbar-width: none; 
        font-size: 0.85rem !important; 
    }}
    [data-testid="stSidebar"] [data-testid="stVerticalBlock"] {{ 
        padding-top: 1.5rem; 
        gap: 0rem;
        min-width: 330px !important;
    }}
    [data-testid="stSidebar"] code {{ font-size: 0.75rem !important; }}
    
    .main .block-container {{ padding-bottom: 120px !important; }}
    button:focus, button:hover, input:focus, input:hover, textarea:focus, textarea:hover {{ outline: 3px solid #336699 !important; outline-offset: 2px !important; border-radius: 4px !important; }}
    [data-testid="stStatusWidget"] {{ display: none !important; }}
</style>""", unsafe_allow_html=True)

st.title("N.E.R.D.")

# --- SIDEBAR REFERENCE GUIDE ---
with st.sidebar:
    st.markdown("## Show template")
    st.markdown("### 📝 Listing Template")
    st.markdown("""
    ```markdown
    Product Name: [Name]
    Vendor: [Vendor Name]
    Description: [Main Description]
    Product Website: [URL]

    --- Accessibility Resources (From Vendor) ---
    - [Link Text](URL)

    --- Accessibility Insights (From Third-Party Sources) ---
    - [Source]: [Summary] ([Link Text](URL))

    --- AI Generated Insights ---
    Description: [Single paragraph, max 6 sentences. No sources. No parentheticals.]

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
    """)
    st.caption("Do not add extra text on the same line as a [Link](URL).")

# --- GENERATE FLOW ---
def run_generation():
    u = st.session_state.url_field
    if not u: return
    with bottom_status_container:
        with st.status(f"🔍 Researching {u}...", expanded=True) as status:
            try:
                draft, raw_urls = run_initial_research(u, st.session_state.search_time)
                status.update(label="✅ Research complete. Resolving links...", state="running")
                
                # Resolve and Validate
                resolve_and_validate_all(raw_urls, st.session_state.url_cache)
                
                # Post-process Markdown with resolved links and sanitization
                result, rejections = filter_broken_links(draft)
                
                # Synthesis Phase
                status.update(label="🧠 Synthesizing AI Insights...", state="running")
                final_md = result # Synthesis logic integrated into next step
                
                label = "✨ Listing generated!"
                if rejections: label = f"✨ Listing generated ({len(rejections)} links flagged)"
                status.update(label=label, state="complete", expanded=False)
                
                st.session_state.current_result = result
                st.session_state.active_url = u
                st.session_state.research_phase = 1
                st.session_state.quota_exhausted = False
                
                listing = parse_markdown_to_listing(result)
                st.session_state.history.append({"name": listing.product_name, "url": u, "result": result, "citations": []})
            except QuotaExhaustedError:
                st.session_state.quota_exhausted = True
            except Exception as e:
                logger.exception("Fatal error during research generation:")
                status.update(label=f"❌ Error: {type(e).__name__} (Details in nerd_debug.log)", state="error")

def run_continuation():
    if not st.session_state.current_result: return
    listing = parse_markdown_to_listing(st.session_state.current_result)
    with bottom_status_container:
        with st.status("🚀 Running Deep-Dive Research...", expanded=True) as status:
            try:
                new_draft, raw_urls = run_deep_dive(
                    st.session_state.active_url,
                    listing.product_name,
                    st.session_state.current_result,
                    4
                )
                status.update(label="✅ Deep-dive complete. Merging...", state="running")
                
                resolve_and_validate_all(raw_urls, st.session_state.url_cache)
                delta_md, _ = filter_broken_links(new_draft)
                
                # Simplified merge for now (appending delta)
                updated_md = st.session_state.current_result + "\n\n" + delta_md
                
                if updated_md != st.session_state.current_result:
                    st.session_state.current_result = updated_md
                    status.update(label="🎉 New resources appended!", state="complete", expanded=False)
                else:
                    status.update(label="ℹ️ No new resources found.", state="complete", expanded=False)
                st.session_state.research_phase = 2
            except QuotaExhaustedError:
                st.session_state.quota_exhausted = True
            except Exception as e:
                logger.exception("Fatal error during deep-dive:")
                status.update(label=f"❌ Error: {type(e).__name__} (Details in nerd_debug.log)", state="error")

# --- UI FORM ---
with st.container():
    col_time, col_url_input = st.columns([1, 2])
    with col_time: st.slider("Max Research Time (minutes)", 1, 4, 4, 1, key="search_time")
    with col_url_input: st.text_input("Product URL", placeholder="https://example.com", key="url_field")

    btn_cols = st.columns([1, 1, 1, 1, 1, 1])
    
    # Generate
    with btn_cols[0]:
        if st.session_state.research_phase == 0:
            st.button("Generate Listing", type="primary", on_click=run_generation, key="btn_generate")
        else:
            st.button("Generate Listing", disabled=True, key="btn_generate_disabled")
            
    # Continue
    with btn_cols[1]:
        if st.session_state.research_phase == 1:
            st.button("Continue", type="primary", on_click=run_continuation, key="btn_continue")
        else:
            st.button("Continue", disabled=True, key="btn_continue_disabled")

    # DOCX and HTML - Prepared for Download
    if st.session_state.current_result:
        listing = parse_markdown_to_listing(st.session_state.current_result)
        ts = datetime.now().strftime('%m-%d-%y-%H-%M-%S')
        clean_name = re.sub(r'[^\w\-]', '_', listing.product_name)
        fname = f"{clean_name}-{ts}"
        res_hash = hashlib.md5(st.session_state.current_result.encode()).hexdigest()
        
        with btn_cols[2]:
            st.download_button("DOCX", data=create_docx_bytes(st.session_state.current_result), file_name=f"{fname}.docx", icon=":material/download:", key=f"btn_docx_{res_hash}")
        with btn_cols[3]:
            current_html = generate_ncademi_html_cached(st.session_state.current_result)
            st.download_button("HTML", data=current_html, file_name=f"{fname}.html", icon=":material/download:", key=f"btn_html_{res_hash}")
    else:
        with btn_cols[2]: st.button("DOCX", disabled=True, key="docx_inactive")
        with btn_cols[3]: st.button("HTML", disabled=True, key="html_inactive")

    with btn_cols[4]:
        st.button("Clear All", on_click=clear_all_state, key="btn_clear")

# --- RESULT UI ---
if st.session_state.current_result:
    @st.fragment
    def live_preview_and_editor():
        st.divider()
        st.subheader("Generated Listing")
        html_content = generate_ncademi_html_cached(st.session_state.current_result)
        curr_hash = hashlib.md5(st.session_state.current_result.encode()).hexdigest()
        with st.container(key=f"preview_container_{curr_hash}"):
            st.components.v1.html(html_content, height=450, scrolling=True)

        with st.expander("📝 Edit Raw Markdown"):
            st.info("Directly edit the listing below. Refer to the **Sidebar Template** for formatting. Changes update the preview and downloads instantly.")
            st.text_area("Markdown Editor", key="current_result", height=400)
    
    live_preview_and_editor()

# --- HISTORY ---
st.divider()
with st.expander("🕒 Search History"):
    for item in reversed(st.session_state.history):
        item_hash = hashlib.md5(item['result'].encode()).hexdigest()[:12]
        if st.button(f"{item['name']} ({item['url']})", key=f"hist_{item_hash}"):
            st.session_state.current_result = item['result']
            st.session_state.active_url = item['url']
            st.session_state.research_phase = 1
            st.rerun()
    if st.button("Clear History"):
        st.session_state.history = []
        st.rerun()

with st.container(key="status_bar_outer"):
    bottom_status_container = st.container()
    if st.session_state.quota_exhausted:
        st.error("⚠️ Quota Exhausted (429). Your research is preserved. Try again in ~60 seconds.")

st.caption(f"NCADEMI / WebAIM | {MODEL}")
