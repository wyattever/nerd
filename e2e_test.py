import os
import re
import io
import json
import logging
from datetime import datetime

# --- LOGIC EXTRACTED FROM APP.PY ---

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
                    if m: curr["LinkText"], curr["Link"] = m.group(1), m.group(2)
                elif "Note:" in line: curr["Note"] = line.replace("Note:", "").strip()
    return data

def generate_ncademi_html(data):
    vendor_res = "".join([f'<li><a href="{u}" target="_blank">{t}</a></li>' for t, u in data["Vendor Resources"]]) if data["Vendor Resources"] else "<li>No vendor accessibility resources found.</li>"
    third_res = "".join([f'<li>{s}: {sm} (<a href="{u}" target="_blank">{lt}</a>)</li>' for s, sm, lt, u in data["Third Party Insights"]]) if data["Third Party Insights"] else "<li>No authoritative third-party accessibility reviews found.</li>"
    acr_res = "".join([f'<div style="margin-bottom:20px;border-bottom:1px solid #eee;padding-bottom:10px;"><strong>{a["Title"]}</strong><br><small>Version: {a["Version"]} | Date: {a["Date"]}</small><br><small>Org: {a["Org"]}</small><br><a href="{a["Link"]}" target="_blank">{a["LinkText"]}</a>' + (f'<br><small>Note: {a["Note"]}</small>' if a["Note"] else "") + '</div>' for a in data["ACRs"]]) if data["ACRs"] else "<p>No ACR information found.</p>"
    
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

# --- DUMMY DATA ---
DUMMY_MARKDOWN = """
Product Name: Test Product
Vendor: Test Vendor
Description: This is a dummy description for E2E testing purposes.
Product Website: https://example.com

--- Accessibility Resources (From Vendor) ---
- [Accessibility Page](https://example.com/a11y)
- [ACR Repo](https://example.com/vpat)

--- Accessibility Insights (From Third-Party Sources) ---
- WebAIM: Good contrast found on main dashboard. ([WebAIM Review](https://webaim.org/test))

--- Support ---
Support Contact: support@example.com

--- ACR / VPAT ---
Report Title: Test VPAT 2.4
VPAT Version: 2.4
Date Completed: January, 2026
Evaluating Organization: Internal
Link: [Download VPAT](https://example.com/vpat.pdf)
Note: Report provided in PDF format only.
"""

def test_markdown_parsing():
    print("Testing Markdown Parsing...")
    data = parse_markdown_to_dict(DUMMY_MARKDOWN)
    assert data["Product Name"] == "Test Product"
    assert data["Vendor"] == "Test Vendor"
    assert len(data["Vendor Resources"]) == 2
    assert data["Support Contact"] == "support@example.com"
    assert len(data["ACRs"]) == 1
    assert data["ACRs"][0]["Version"] == "2.4"
    print("✅ Markdown Parsing Passed")
    return data

def test_html_generation(data):
    print("Testing HTML Generation...")
    html = generate_ncademi_html(data)
    assert "Test Product" in html
    assert "Test Vendor" in html
    assert "https://example.com/a11y" in html
    assert "fa-regular fa-globe" in html
    print("✅ HTML Generation Passed")

def run_e2e_suite():
    print("--- STARTING NCADEMI E2E REVIEW ---")
    data = test_markdown_parsing()
    test_html_generation(data)
    print("--- E2E REVIEW COMPLETE ---")

if __name__ == "__main__":
    run_e2e_suite()
