#!/usr/bin/env python3
"""
scrape_vendors.py — Build a global vendors registry by scraping each
vendor's own NCADEMI directory page (https://ncademi.org/provide/directory/vendors/<slug>/),
starting from the deduplicated `vendor_directory_url`s found in a products JSON file.

Output shape follows the VendorRecord / VendorResource / VendorsFile
schema defined in vendor_schema_proposal.ts.
"""

import argparse
import hashlib
import json
import sys
import time
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup

USER_AGENT = "Mozilla/5.0 (compatible; NCADEMI-vendor-audit/1.0)"
REQUEST_TIMEOUT = 30

def extract_vendor_products(soup):
    """
    Finds the 'edtech-vendor-products' section and extracts all linked products.
    """
    section = soup.select_one("section.edtech-vendor-products")
    if not section:
        return []

    products = []
    for art in section.select("article"):
        a_tag = art.select_one("h3 a") or art.select_one("h5 a") or art.find("a")
        if a_tag and a_tag.has_attr("href"):
            products.append({
                "product_name": a_tag.get_text(strip=True),
                "ncademi_product_url": a_tag["href"].strip()
            })
    return products

def extract_vendor_resources(section):
    """
    Given the .edtech-resources section, finds the <h3> whose text starts
    with 'From ' (ignoring 'From Other Sources') and returns the formatted
    VendorResource items from the <ul> that immediately follows it.
    Safely handles null cases if the section or lists are missing.
    """
    if section is None:
        return []

    for h3 in section.select("h3"):
        text = h3.get_text(strip=True)
        if text.startswith("From ") and text != "From Other Sources":
            ul = h3.find_next_sibling("ul")
            if ul is None:
                return []

            items = []
            for li in ul.select("li"):
                a = li.find("a")
                if a and a.has_attr("href"):
                    url_val = a["href"].strip()
                    hashed_id = hashlib.md5(url_val.encode('utf-8')).hexdigest()[:8]
                    items.append({
                        "id": hashed_id,
                        "text": a.get_text(strip=True),
                        "url": url_val,
                        "source": "Internal",
                        "label": None,
                        "date": None,
                        "added_to_site": True
                    })
            return items
    return []

def scrape_vendor_page(vendor_directory_url: str):
    resp = requests.get(vendor_directory_url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    website_a = soup.select_one("p.edtech-website-link a")
    vendor_website_url = website_a["href"].strip() if website_a and website_a.has_attr("href") else None

    resources_section = soup.select_one("section.edtech-resources")
    resources = extract_vendor_resources(resources_section)
    products = extract_vendor_products(soup)

    return vendor_website_url, resources, products

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Path to products JSON file (e.g. .scratch/full_directory_products.json)")
    parser.add_argument("--output", required=True, help="Path to write the output vendors JSON file")
    parser.add_argument("--delay", type=float, default=0.75, help="Seconds to sleep between requests")
    args = parser.parse_args()

    print(f"Reading products from {args.input} ...", file=sys.stderr)
    with open(args.input, "r", encoding="utf-8") as f:
        data = json.load(f)

    products_list = data.get("products", [])

    unique_vendors = {}
    for p in products_list:
        v_name = p.get("vendor_name")
        v_dir_url = p.get("vendor_directory_url")
        if v_name and v_dir_url and v_name not in unique_vendors:
            unique_vendors[v_name] = v_dir_url

    print(f"Found {len(unique_vendors)} unique vendor(s) with a vendor_directory_url.", file=sys.stderr)

    vendor_records = []
    errors = 0

    for i, (v_name, v_dir_url) in enumerate(unique_vendors.items(), start=1):
        print(f"[{i}/{len(unique_vendors)}] Scraping vendor: {v_name} -> {v_dir_url}", file=sys.stderr)
        try:
            vendor_website_url, resources, v_products = scrape_vendor_page(v_dir_url)

            vendor_records.append({
                "vendor_name": v_name,
                "vendor_website_url": vendor_website_url,
                "vendor_directory_url": v_dir_url,
                "last_updated": None,
                "added_to_site": True,
                "notes": None,
                "resources": resources,
                "products": v_products
            })
        except Exception as exc:
            print(f"    ERROR: {exc}", file=sys.stderr)
            vendor_records.append({
                "vendor_name": v_name,
                "vendor_website_url": None,
                "vendor_directory_url": v_dir_url,
                "last_updated": None,
                "added_to_site": True,
                "notes": f"Scrape Error: {exc}",
                "resources": [],
                "products": []
            })
            errors += 1

        time.sleep(args.delay)

    output = {
        "$schema_version": 1,
        "$meta": {
            "purpose": "Global vendors registry, scraped from each vendor's own NCADEMI directory page.",
            "source_listing_url": "https://ncademi.org/provide/directory/vendors/",
            "snapshot_taken_at": datetime.now(timezone.utc).isoformat(),
            "total_vendors": len(vendor_records),
            "generated_from": args.input
        },
        "vendors": vendor_records
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nDone. Wrote {len(vendor_records)} vendor record(s) to {args.output} ({errors} error(s)).", file=sys.stderr)

if __name__ == "__main__":
    main()
