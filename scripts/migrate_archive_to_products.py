import json
import re
import os
from pathlib import Path
from bs4 import BeautifulSoup

# Define directories
ARCHIVE_DIR = Path("ncademi_archive/clean_content")
OUTPUT_DIR = Path(os.getenv("PRODUCTS_DIR", "NCADEMI_products"))
OUTPUT_DIR.mkdir(exist_ok=True)

def extract_product_data(html_content):
    soup = BeautifulSoup(html_content, 'html.parser')
    
    # 1. Product Name
    title_tag = soup.find('h1', class_='page-title')
    product_name = title_tag.get_text(strip=True) if title_tag else "Unknown Product"
    
    # 2. Description & Vendor
    summary_div = soup.find('div', class_='entry-summary')
    paragraphs = summary_div.find_all('p', recursive=False) if summary_div else []
    
    desc_parts = []
    vendor_name = ""
    product_website_url = "#"
    
    for p in paragraphs:
        # Detect Vendor
        if p.find('strong', string=re.compile("Vendor:")):
            vendor_name = p.get_text(strip=True).replace("Vendor:", "").strip()
            continue
        # Detect Website
        if p.find('i', class_='fa-globe'):
            link = p.find('a')
            if link: product_website_url = link.get('href', '#')
            continue
        # Append to Description if not meta
        text = p.get_text(strip=True)
        if text and not text.startswith("Product information last updated"):
            desc_parts.append(text)
            
    product_description = " ".join(desc_parts)

    # 3. Resources (Vendor vs Other)
    vendor_resources = []
    other_resources = []
    
    h3s = summary_div.find_all('h3') if summary_div else []
    for h3 in h3s:
        header_text = h3.get_text(strip=True)
        ul = h3.find_next_sibling('ul')
        if not ul: continue
        
        links = []
        for li in ul.find_all('li'):
            a = li.find('a')
            if a:
                links.append({"url": a.get('href', ''), "text": a.get_text(strip=True)})
        
        # Mapping logic: If vendor name is in header, it's vendor resources
        if vendor_name and vendor_name.lower() in header_text.lower():
             vendor_resources.extend(links)
        elif "From" in header_text and not "Other" in header_text:
             # Fallback for "From [Company]" where vendor_name might differ slightly
             vendor_resources.extend(links)
        else:
             other_resources.extend(links)

    # 4. Support
    support_contacts = []
    support_div = soup.find('div', class_='product-support')
    if support_div:
        for li in support_div.find_all('li'):
            a = li.find('a')
            if a:
                val = a.get('href', '')
                if val.startswith('mailto:'):
                    support_contacts.append({"type": "email", "value": val.replace('mailto:', ''), "label": ""})
                else:
                    support_contacts.append({"type": "url", "value": val, "label": a.get_text(strip=True)})
            else:
                support_contacts.append({"type": "text", "value": li.get_text(strip=True), "label": ""})

    # 5. ACRs
    acr_reports = []
    acr_div = soup.find('div', class_='edtech-acr')
    if acr_div:
        h4s = acr_div.find_all('h4')
        for h4 in h4s:
            a = h4.find('a')
            if a:
                acr_reports.append({"title": a.get_text(strip=True), "url": a.get('href', '')})
            else:
                acr_reports.append({"title": h4.get_text(strip=True), "url": "#"})

    # 6. Last Updated
    meta_p = soup.find('p', class_='entry-meta')
    last_updated = ""
    if meta_p:
        last_updated = meta_p.get_text(strip=True).replace("Product information last updated", "").strip()

    return {
        "product_name": product_name,
        "vendor_name": vendor_name,
        "vendor_directory_url": "#",
        "product_description": product_description,
        "product_website_url": product_website_url,
        "vendor_resources": vendor_resources,
        "other_resources": other_resources,
        "ai_insights": "", # Legacy products don't have this
        "support_contacts": support_contacts,
        "acr_reports": acr_reports,
        "last_updated": last_updated
    }

def run_migration():
    html_files = list(ARCHIVE_DIR.glob("*.html"))
    count = 0
    
    # We also need the render logic for the requested HTML pages
    import sys
    sys.path.append(".")
    from nerd_core.generators import render_listing_html
    from dataclasses import make_dataclass
    
    # Dummy dataclass for render_listing_html
    ListingData = make_dataclass("ListingData", [
        ("product_name", str), ("vendor_name", str), ("vendor_directory_url", str),
        ("product_description", str), ("product_website_url", str),
        ("vendor_resources", list), ("other_resources", list),
        ("ai_insights", str), ("support_contacts", list), ("acr_reports", list),
        ("last_updated", str)
    ])
    
    print(f"Starting transformation of {len(html_files)} files...")
    
    for html_file in html_files:
        try:
            content = html_file.read_text()
            data = extract_product_data(content)
            
            # Save JSON (for Injection)
            json_path = OUTPUT_DIR / f"{html_file.stem}.json"
            json_path.write_text(json.dumps(data, indent=2))
            
            # Save HTML (as requested)
            # We use our standard generator to ensure it looks like a N.E.R.D. result
            # But wait, generators expects specific types. Let's use simpler dict-based render if needed
            # For now, let's use the actual generator logic
            from api.conversions import pydantic_to_dataclass
            from api import schemas
            
            pydantic_obj = schemas.ListingData(**data)
            dc_obj = pydantic_to_dataclass(pydantic_obj)
            full_html = render_listing_html(dc_obj)
            
            html_path = OUTPUT_DIR / f"{html_file.stem}.html"
            html_path.write_text(full_html)
            
            count += 1
        except Exception as e:
            print(f"Error processing {html_file.name}: {e}")

    print(f"Successfully transformed {count} products into NCADEMI_products/")

if __name__ == "__main__":
    run_migration()