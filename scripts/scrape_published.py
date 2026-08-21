#!/usr/bin/env python3
"""
Scrapes live ncademi.org product pages for every product marked
Status == "Published" in N.E.R.D.'s raw AppSheet Products export, and
writes a single JSON file matching N.E.R.D.'s internal listing schema
(vendor_resources / other_resources / support_contacts / acr_reports /
last_updated) so it can be diffed against internal data.

Usage:
    python3 scrape_published.py \
        --appsheet-json /path/to/appsheet-tables.json \
        --output ncademi_live_published_YYYY-MM-DD.json

Requires: requests, beautifulsoup4
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup

USER_AGENT = "Mozilla/5.0 (NERD-sync-script/1.0)"
REQUEST_TIMEOUT = 20
REQUEST_DELAY_SECONDS = 0.75  # be polite to the server


def load_published_products(appsheet_json_path):
    """
    Parses the raw AppSheet Products table (first table in the export)
    and returns a list of {"product_name": str, "ncademi_product_url": str|None}
    for every row with Status == "Published".
    """
    with open(appsheet_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    products_table = None
    for table in data.get("tables", []):
        html = table.get("html", "")
        if "nerd-table--appsheet-products" in html:
            products_table = table
            break

    if products_table is None:
        raise ValueError(
            "Could not find the AppSheet Products table in the supplied JSON "
            "(looked for a table containing class 'nerd-table--appsheet-products')."
        )

    soup = BeautifulSoup(products_table["html"], "html.parser")
    rows = soup.select("table.nerd-table--appsheet-products tbody tr")

    published = []
    for row in rows:
        name_cell = row.select_one("td.nerd-col-aprod-name")
        status_cell = row.select_one("td.nerd-col-aprod-status")
        url_anchor = row.select_one("td.nerd-col-aprod-ncademiurl a")

        name = name_cell.get_text(strip=True) if name_cell else None
        status = status_cell.get_text(strip=True) if status_cell else None
        url = url_anchor["href"].strip() if url_anchor and url_anchor.has_attr("href") else None

        if status == "Published":
            published.append({"product_name": name, "ncademi_product_url": url})

    return published


def text_or_none(el):
    if el is None:
        return None
    txt = el.get_text(strip=True)
    return txt if txt else None


def extract_resources(section, heading_text):
    """
    Given the .edtech-resources section, finds the <h3> whose text matches
    heading_text and returns the {text, url} items from the <ul> that
    immediately follows it.
    """
    if section is None:
        return []
    for h3 in section.select("h3"):
        if h3.get_text(strip=True) == heading_text:
            ul = h3.find_next_sibling("ul")
            if ul is None:
                return []
            items = []
            for li in ul.select("li"):
                a = li.find("a")
                if a and a.has_attr("href"):
                    items.append({"text": a.get_text(strip=True), "url": a["href"].strip()})
            return items
    return []


def extract_support_contacts(soup):
    section = soup.select_one("section.edtech-info-card--support")
    if section is None:
        return []
    contacts = []
    for li in section.select("ul li"):
        a = li.find("a")
        if not a or not a.has_attr("href"):
            continue
        href = a["href"].strip()
        if href.lower().startswith("mailto:"):
            contacts.append({
                "type": "email",
                "value": href[len("mailto:"):].strip(),
                "label": None,
            })
        else:
            contacts.append({
                "type": "url",
                "value": href,
                "label": a.get_text(strip=True) or None,
            })
    return contacts


def extract_acr_reports(soup):
    section = soup.select_one("section.edtech-info-card--reports")
    if section is None:
        return []

    articles = section.select("article")
    if not articles:
        # "Available on Request" / no-ACR fallback state, or genuinely empty
        body_text = text_or_none(section)
        if body_text and "Available on Request" in body_text:
            return [{
                "title": "Available on Request",
                "url": None,
                "version": None,
                "date": None,
                "auditor_name": None,
                "auditor_url": None,
            }]
        return []

    reports = []
    for art in articles:
        title_a = art.select_one("h3 a")
        title = text_or_none(title_a) or text_or_none(art.select_one("h3"))
        url = title_a["href"].strip() if title_a and title_a.has_attr("href") else None

        version = date = auditor_name = auditor_url = None
        for li in art.select("ul li"):
            label_el = li.find("strong")
            label = text_or_none(label_el)
            if not label:
                continue
            if label.startswith("Version"):
                version = li.get_text(strip=True).replace(label, "", 1).strip() or None
            elif label.startswith("Date"):
                date = li.get_text(strip=True).replace(label, "", 1).strip() or None
            elif label.startswith("Completed by"):
                a = li.find("a")
                if a and a.has_attr("href"):
                    auditor_name = a.get_text(strip=True)
                    auditor_url = a["href"].strip()
                else:
                    auditor_name = li.get_text(strip=True).replace(label, "", 1).strip() or None

        reports.append({
            "title": title,
            "url": url,
            "version": version,
            "date": date,
            "auditor_name": auditor_name,
            "auditor_url": auditor_url,
        })
    return reports


def extract_last_updated(soup):
    el = soup.select_one("p.text-end.text-body-secondary em")
    txt = text_or_none(el)
    if txt and txt.lower().startswith("product information last updated"):
        return txt[len("Product information last updated"):].strip()
    return txt


def scrape_product_page(url):
    resp = requests.get(url, timeout=REQUEST_TIMEOUT, headers={"User-Agent": USER_AGENT})
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    if soup.select_one("form.pw_form"):
        raise ValueError(
            "PAGE IS PASSWORD-PROTECTED (WordPress post_password form found). "
            "Content is not publicly viewable even though status is 'Published' "
            "in N.E.R.D. — flag this as a sync gap, not a scraper failure."
        )

    article = soup.select_one("article.nc-single-product") or soup.select_one("article.product")
    if article is None:
        raise ValueError("Could not find the product <article> container on the page.")

    h1 = article.select_one("h1")
    product_name = text_or_none(h1)

    vendor_p = article.select_one(".entry-content p.mb-2")
    vendor_name = None
    vendor_directory_url = None
    if vendor_p:
        a = vendor_p.find("a")
        if a:
            vendor_name = a.get_text(strip=True)
            vendor_directory_url = a.get("href", "").strip() or None
        else:
            raw = vendor_p.get_text(strip=True)
            vendor_name = raw.replace("Vendor:", "").strip() or None

    # description = the plain <p> in .entry-content with no class, after the vendor line
    product_description = None
    entry_content = article.select_one(".entry-content")
    if entry_content:
        for p in entry_content.select("p"):
            if not p.get("class"):
                product_description = p.get_text(strip=True)
                break

    website_a = article.select_one("p.edtech-website-link a")
    product_website_url = website_a["href"].strip() if website_a and website_a.has_attr("href") else None

    resources_section = article.select_one("section.edtech-resources")
    vendor_resources = extract_resources(resources_section, f"From {vendor_name}") if vendor_name else []
    other_resources = extract_resources(resources_section, "From Other Sources")

    support_contacts = extract_support_contacts(article)
    acr_reports = extract_acr_reports(article)
    last_updated = extract_last_updated(article)

    return {
        "product_name": product_name,
        "ncademi_product_url": url,
        "vendor_name": vendor_name,
        "vendor_directory_url": vendor_directory_url,
        "product_website_url": product_website_url,
        "product_description": product_description,
        "vendor_resources": vendor_resources,
        "other_resources": other_resources,
        "support_contacts": support_contacts,
        "acr_reports": acr_reports,
        "last_updated": last_updated,
        "ai_insights": None,  # not present on the live theme; reserved for schema parity
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--appsheet-json", required=True, help="Path to appsheet-tables.json")
    parser.add_argument("--output", required=True, help="Path to write the output JSON file")
    parser.add_argument("--delay", type=float, default=REQUEST_DELAY_SECONDS,
                         help="Seconds to wait between requests (default: %(default)s)")
    args = parser.parse_args()

    published = load_published_products(args.appsheet_json)
    print(f"Found {len(published)} product(s) with Status == 'Published' in AppSheet export.",
          file=sys.stderr)

    results = []
    errors = 0
    for i, item in enumerate(published, start=1):
        name = item["product_name"]
        url = item["ncademi_product_url"]

        if not url:
            print(f"[{i}/{len(published)}] SKIP (no NCADEMI URL on file): {name}", file=sys.stderr)
            results.append({
                "product_name": name,
                "ncademi_product_url": None,
                "_error": "No NCADEMI Product URL recorded in AppSheet export for this Published product.",
            })
            errors += 1
            continue

        print(f"[{i}/{len(published)}] Scraping: {name} -> {url}", file=sys.stderr)
        try:
            record = scrape_product_page(url)
            results.append(record)
        except Exception as exc:
            print(f"    ERROR: {exc}", file=sys.stderr)
            results.append({
                "product_name": name,
                "ncademi_product_url": url,
                "_error": str(exc),
            })
            errors += 1

        time.sleep(args.delay)

    output = {
        "scrape_meta": {
            "source": "Live scrape of ncademi.org product pages, "
                       "scoped to Status == 'Published' rows from AppSheet Products export.",
            "appsheet_json_source": args.appsheet_json,
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "total_published_in_appsheet": len(published),
            "total_scraped_successfully": len(published) - errors,
            "total_errors": errors,
        },
        "products": results,
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nDone. Wrote {len(results)} product record(s) to {args.output} "
          f"({errors} error(s)).", file=sys.stderr)


if __name__ == "__main__":
    main()
