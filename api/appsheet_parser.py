import json
from pathlib import Path
from bs4 import BeautifulSoup
from fastapi import HTTPException

def get_empty_listing(product_name: str) -> dict:
    return {
        "product_name": product_name,
        "vendor_name": "Unknown",
        "product_description": "",
        "product_website_url": "",
        "vendor_resources": [],
        "other_resources": [],
        "support_contacts": [],
        "acr_reports": [],
        "last_updated": ""
    }

def safe_text(cell):
    if not cell: return ""
    return cell.get_text(strip=True)

def safe_link(cell):
    if not cell: return ""
    a = cell.find('a')
    if a and a.get('href'): return a.get('href')
    return ""

def parse_product_from_appsheet(product_name: str, base_dir: Path) -> dict:
    file_path = base_dir / "frontend" / "lib" / "appsheet-tables.json"
    if not file_path.exists():
        raise HTTPException(status_code=500, detail="appsheet-tables.json not found")
        
    data = json.loads(file_path.read_text())
    tables = {t.get("slug"): t.get("html", "") for t in data.get("tables", [])}
    
    # --- 1. Global Table ---
    soup_global = BeautifulSoup(tables.get("global", ""), "html.parser")
    product_row = None
    
    for row in soup_global.select("table.nerd-table--appsheet-products tbody tr"):
        if safe_text(row.select_one("td.nerd-col-aprod-name")) == product_name:
            product_row = row
            break
            
    if not product_row:
        raise HTTPException(status_code=404, detail=f"Product {product_name} not found")
        
    listing = get_empty_listing(product_name)
    listing["vendor_name"] = safe_text(product_row.select_one("td.nerd-col-aprod-vendor"))
    listing["product_description"] = safe_text(product_row.select_one("td.nerd-col-aprod-desc"))
    listing["product_website_url"] = safe_link(product_row.select_one("td.nerd-col-aprod-website"))
    listing["last_updated"] = safe_text(product_row.select_one("td.nerd-col-aprod-lastupdated"))
    
    resource_ids = [i.strip() for i in safe_text(product_row.select_one("td.nerd-col-aprod-resourceids")).split(',') if i.strip()]
    support_ids = [i.strip() for i in safe_text(product_row.select_one("td.nerd-col-aprod-supportids")).split(',') if i.strip()]
    acr_ids = [i.strip() for i in safe_text(product_row.select_one("td.nerd-col-aprod-acrids")).split(',') if i.strip()]
    
    # --- 2. Resources (Product) ---
    soup_pres = BeautifulSoup(tables.get("product-resources", ""), "html.parser")
    for row in soup_pres.select("table.nerd-table--product-resources tbody tr"):
        if safe_text(row.select_one("td.nerd-col-pres-product")) == product_name:
            if safe_text(row.select_one("td.nerd-col-pres-added")).lower() != "yes":
                continue
            
            source = safe_text(row.select_one("td.nerd-col-pres-source"))
            resource = {
                "title": safe_text(row.select_one("td.nerd-col-pres-name")),
                "url": safe_link(row.select_one("td.nerd-col-pres-url")),
                "source": "Vendor" if source == "Internal" else "Third-Party"
            }
            if resource["url"]:
                if source == "Internal":
                    listing["vendor_resources"].append(resource)
                else:
                    listing["other_resources"].append(resource)

    # --- 2.5 Resources (Vendor) ---
    soup_vres = BeautifulSoup(tables.get("vendor-resources", ""), "html.parser")
    for row in soup_vres.select("table.nerd-table--vendor-resources tbody tr"):
        if safe_text(row.select_one("td.nerd-col-vres-vendor")) == listing["vendor_name"]:
            if safe_text(row.select_one("td.nerd-col-vres-added")).lower() != "yes":
                continue
            
            source = safe_text(row.select_one("td.nerd-col-vres-source"))
            resource = {
                "title": safe_text(row.select_one("td.nerd-col-vres-name")),
                "url": safe_link(row.select_one("td.nerd-col-vres-url")),
                "source": "Vendor" if source == "Internal" else "Third-Party"
            }
            if resource["url"]:
                existing_urls = [r["url"] for r in listing["vendor_resources"] + listing["other_resources"]]
                if resource["url"] not in existing_urls:
                    if source == "Internal":
                        listing["vendor_resources"].append(resource)
                    else:
                        listing["other_resources"].append(resource)

    # --- 3. Supports (Product) ---
    soup_psup = BeautifulSoup(tables.get("product-supports", ""), "html.parser")
    for row in soup_psup.select("table.nerd-table--product-supports tbody tr"):
         if safe_text(row.select_one("td.nerd-col-psup-product")) == product_name:
            if safe_text(row.select_one("td.nerd-col-psup-added")).lower() != "yes":
                continue
                
            ctype = safe_text(row.select_one("td.nerd-col-psup-type"))
            support = {
                "contact_type": ctype,
                "title": safe_text(row.select_one("td.nerd-col-psup-websitename")) or "Support Link",
                "value": safe_text(row.select_one("td.nerd-col-psup-email")) if ctype == "Email" else safe_link(row.select_one("td.nerd-col-psup-websiteurl"))
            }
            if support["value"]:
                listing["support_contacts"].append(support)
                
    # --- 3.5 Supports (Vendor) ---
    soup_vsup = BeautifulSoup(tables.get("vendor-supports", ""), "html.parser")
    for row in soup_vsup.select("table.nerd-table--vendor-supports tbody tr"):
         if safe_text(row.select_one("td.nerd-col-vsup-vendor")) == listing["vendor_name"]:
            if safe_text(row.select_one("td.nerd-col-vsup-checkbox")).lower() != "yes":
                continue
                
            ctype = safe_text(row.select_one("td.nerd-col-vsup-type"))
            support = {
                "contact_type": ctype,
                "title": safe_text(row.select_one("td.nerd-col-vsup-websitename")) or "Support Link",
                "value": safe_text(row.select_one("td.nerd-col-vsup-email")) if ctype == "Email" else safe_link(row.select_one("td.nerd-col-vsup-websiteurl"))
            }
            if support["value"]:
                existing_values = [s["value"] for s in listing["support_contacts"]]
                if support["value"] not in existing_values:
                    listing["support_contacts"].append(support)
                
    # --- 4. ACRs ---
    soup_acr = BeautifulSoup(tables.get("acrs", ""), "html.parser")
    for row in soup_acr.select("table.nerd-table--acrs tbody tr"):
         row_id = safe_text(row.select_one("td.nerd-col-acr-rowid"))
         if row_id in acr_ids or safe_text(row.select_one("td.nerd-col-acr-product")) == product_name:
            if safe_text(row.select_one("td.nerd-col-acr-added")).lower() != "yes":
                continue
                
            acr = {
                "title": safe_text(row.select_one("td.nerd-col-acr-name")),
                "url": safe_link(row.select_one("td.nerd-col-acr-url")),
                "version": safe_text(row.select_one("td.nerd-col-acr-version")),
                "date": safe_text(row.select_one("td.nerd-col-acr-datepub")),
                "completed_by": safe_text(row.select_one("td.nerd-col-acr-completedby"))
            }
            if acr["url"]:
                listing["acr_reports"].append(acr)
                
    return listing
