#!/usr/bin/env python3
"""
scrape_ncademi_directory.py — Extract structured accessibility data for every
product page on the NCADEMI EdTech Accessibility Directory
(https://ncademi.org/provide/directory/products/), and write it to a single
JSON file matching N.E.R.D.'s internal listing schema (vendor_resources /
other_resources / support_contacts / acr_reports / last_updated).

Unlike scrape_published.py, this script does NOT depend on N.E.R.D.'s
AppSheet export -- it crawls the live directory index itself and processes
every product page it finds there, regardless of Status. Output uses the
same top-level shape and per-product schema as scrape_published.py, so
either file can be diffed against N.E.R.D.'s internal data the same way.

Usage:
    python3 scrape_ncademi_directory.py --output FILE [--delay SECONDS] [--limit N]

    --output   Output JSON path. Required -- pass the path you want the file
               written to (e.g. into .scratch/verification/ alongside
               ncademi_live_published_*.json).
    --delay    Seconds to sleep between product-page requests (default: 0.75).
               Be polite to ncademi.org -- this is a small nonprofit site,
               not an API. Do not remove the delay for a full-directory run.
    --limit    Only process the first N products (useful for testing changes
               to this script before a full run).

Notes on page structure (as of the version this script was written against):
  - Not every product has a vendor link (some pages go straight from the H1
    to the "[Product] Website" link with no separate vendor attribution).
  - The "Vendor:" line's anchor, when present, points to an INTERNAL NCADEMI
    vendor directory page (not the external vendor site) -- captured as
    vendor_directory_url, distinct from product_website_url.
  - The "Accessibility Documentation & Resources" section has one H3 for
    vendor-published resources (heading text varies: "From Adobe", "From
    Kahoot!", etc.) and, optionally, a second H3 titled exactly "From Other
    Sources" for third-party resources.
  - Not every product has an ACR/VPAT. When absent, the "Accessibility
    Conformance Reports" card shows "Available on Request" as plain text
    instead of a report block -- recorded as one acr_reports entry with
    title="Available on Request" and url=None, matching scrape_published.py.
  - Some pages are password-protected (WordPress post_password form) despite
    appearing in the public directory index -- recorded as an _error, not
    silently skipped.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup

DIRECTORY_INDEX_URL = "https://ncademi.org/provide/directory/products/"
USER_AGENT = "Mozilla/5.0 (compatible; NCADEMI-directory-audit/1.0)"
REQUEST_TIMEOUT = 30


def get_product_urls() -> list[tuple[str, str]]:
    """Return [(product_name, product_page_url), ...] from the directory index."""
    resp = requests.get(DIRECTORY_INDEX_URL, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    main = soup.find("main") or soup.find(id="primary") or soup
    products: list[tuple[str, str]] = []
    seen = set()
    for a in main.find_all("a", href=True):
        href = a["href"]
        if "/provide/directory/products/" in href and href.rstrip("/") != DIRECTORY_INDEX_URL.rstrip("/"):
            if href not in seen:
                seen.add(href)
                products.append((a.get_text(strip=True), href))
    return products


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


def scrape_product_page(url: str) -> dict:
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    if soup.select_one("form.pw_form"):
        raise ValueError(
            "PAGE IS PASSWORD-PROTECTED (WordPress post_password form found). "
            "Content is not publicly viewable despite appearing in the directory index."
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
        "ai_insights": None,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", required=True, help="Path to write the output JSON file")
    parser.add_argument("--delay", type=float, default=0.75)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    print(f"Fetching product index from {DIRECTORY_INDEX_URL} ...", file=sys.stderr)
    products = get_product_urls()
    print(f"Found {len(products)} product link(s) on the directory index.", file=sys.stderr)

    if args.limit:
        products = products[: args.limit]

    results = []
    errors = 0
    for i, (name, url) in enumerate(products, start=1):
        print(f"[{i}/{len(products)}] Scraping: {name or url} -> {url}", file=sys.stderr)
        try:
            record = scrape_product_page(url)
            results.append(record)
        except Exception as exc:
            print(f"    ERROR: {exc}", file=sys.stderr)
            results.append({
                "product_name": name or None,
                "ncademi_product_url": url,
                "_error": str(exc),
            })
            errors += 1
        time.sleep(args.delay)

    output = {
        "scrape_meta": {
            "source": "Live scrape of every product page found on the ncademi.org "
                       "directory index, independent of N.E.R.D.'s internal Status field.",
            "source_listing_url": DIRECTORY_INDEX_URL,
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "total_products_found": len(products),
            "total_scraped_successfully": len(products) - errors,
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
