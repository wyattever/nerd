#!/usr/bin/env python3
"""
scrape_ncademi_directory.py — Extract every URL from every product page on the
NCADEMI EdTech Accessibility Directory (https://ncademi.org/provide/directory/products/),
categorized by type, and write the result to a CSV.

Usage:
    python3 scrape_ncademi_directory.py [--output FILE] [--delay SECONDS] [--limit N]

    --output   Output CSV path (default: ncademi_directory_urls.csv)
    --delay    Seconds to sleep between product-page requests (default: 0.5).
               Be polite to ncademi.org -- this is a small nonprofit site, not
               an API. Do not remove the delay entirely for a full-directory run.
    --limit    Only process the first N products (useful for testing changes
               to this script before a full run).

Output columns:
    product_name   Product's display name (from the page <h1>)
    product_slug   URL slug (e.g. "adobe-acrobat")
    url_type       One of: Product Website | Vendor Directory Page |
                    Vendor Resource | Third-Party Resource | Support Website |
                    Support Email | ACR/VPAT | ACR Auditor
    link_text      The visible text of the link
    url            The URL itself (mailto: links included verbatim)

Notes on page structure (as of the version this script was written against):
  - Not every product has a vendor link (some pages go straight from the H1 to
    the "[Product] Website" link with no separate vendor attribution).
  - The "Accessibility Documentation & Resources" section has one H3 for
    vendor-published resources (heading text varies: "From Adobe", "From
    Kahoot!", etc. -- match by position, not by exact heading text) and,
    optionally, a second H3 titled exactly "From Other Sources" for
    third-party resources.
  - Not every product has an ACR/VPAT. When absent, the "Accessibility
    Conformance Reports" H2 is followed by plain <p> text ("Available on
    Request", "...information is not currently listed...") instead of an H3
    + link. This script records that as an absence, not an error -- it does
    NOT emit a row for products with no ACR.
  - "Contact Us" and "Follow Us" are NCADEMI's own site chrome, not
    product-specific data, and are excluded by stopping traversal at the
    "Contact Us" H2.
"""

from __future__ import annotations

import argparse
import csv
import sys
import time

import requests
from bs4 import BeautifulSoup

DIRECTORY_INDEX_URL = "https://ncademi.org/provide/directory/products/"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; NCADEMI-directory-audit/1.0)"}


def get_product_urls() -> list[tuple[str, str]]:
    """Return [(product_name, product_page_url), ...] from the directory index."""
    resp = requests.get(DIRECTORY_INDEX_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    main = soup.find("main") or soup.find(id="primary") or soup
    products = []
    seen = set()
    for a in main.find_all("a", href=True):
        href = a["href"]
        if "/provide/directory/products/" in href and href.rstrip("/") != DIRECTORY_INDEX_URL.rstrip("/"):
            if href not in seen:
                seen.add(href)
                products.append((a.get_text(strip=True), href))
    return products


def scrape_product_page(url: str) -> list[dict]:
    """Return a list of row dicts (url_type, link_text, url) for one product page."""
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    main = soup.find("main") or soup.find(id="primary") or soup
    h1 = main.find("h1")
    if h1 is None:
        return []

    rows: list[dict] = []
    seen_urls: set[str] = set()

    def add(url_type: str, link_text: str, href: str):
        key = (url_type, href)
        if href and key not in seen_urls:
            seen_urls.add(key)
            rows.append({"url_type": url_type, "link_text": link_text.strip(), "url": href})

    # Walk forward from H1, tracking which section we're in.
    section = "header"  # header -> vendor_resources | other_sources -> support -> acr -> stop
    acr_report_seen_link = False

    el = h1
    while True:
        el = el.find_next(["h2", "h3", "a", "p"])
        if el is None:
            break

        if el.name == "h2":
            heading = el.get_text(strip=True)
            if heading == "Contact Us":
                break  # site chrome from here on -- stop traversal
            elif heading == "Accessibility Documentation & Resources":
                section = "awaiting_vendor_heading"
            elif heading == "Support":
                section = "support"
            elif heading == "Accessibility Conformance Reports":
                section = "acr"
                acr_report_seen_link = False
            continue

        if el.name == "h3":
            heading = el.get_text(strip=True)
            if section == "awaiting_vendor_heading":
                section = "vendor_resources"
            elif heading == "From Other Sources":
                section = "other_sources"
            elif section == "acr":
                acr_report_seen_link = False  # new report block; next link is the report itself
            continue

        if el.name == "a" and el.get("href"):
            href = el["href"]
            text = el.get_text(strip=True)

            if section == "header":
                if href.startswith("mailto:") or href.startswith("tel:"):
                    continue
                if "/provide/directory/vendors/" in href:
                    add("Vendor Directory Page", text, href)
                elif "Website" in text:
                    add("Product Website", text, href)
            elif section == "vendor_resources":
                add("Vendor Resource", text, href)
            elif section == "other_sources":
                add("Third-Party Resource", text, href)
            elif section == "support":
                if href.startswith("mailto:"):
                    add("Support Email", text, href)
                elif href.startswith("tel:"):
                    pass  # not a URL
                else:
                    add("Support Website", text, href)
            elif section == "acr":
                if not acr_report_seen_link:
                    add("ACR/VPAT", text, href)
                    acr_report_seen_link = True
                else:
                    add("ACR Auditor", text, href)

    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", default="ncademi_directory_urls.csv")
    parser.add_argument("--delay", type=float, default=0.5)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    print(f"Fetching product index from {DIRECTORY_INDEX_URL} ...", file=sys.stderr)
    products = get_product_urls()
    print(f"Found {len(products)} products.", file=sys.stderr)

    if args.limit:
        products = products[: args.limit]

    all_rows = []
    for i, (name, url) in enumerate(products, 1):
        slug = url.rstrip("/").rsplit("/", 1)[-1]
        print(f"[{i}/{len(products)}] {name} ({slug})", file=sys.stderr)
        try:
            page_rows = scrape_product_page(url)
        except requests.RequestException as e:
            print(f"  ERROR fetching {url}: {e}", file=sys.stderr)
            continue
        for row in page_rows:
            row["product_name"] = name
            row["product_slug"] = slug
            all_rows.append(row)
        time.sleep(args.delay)

    with open(args.output, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=["product_name", "product_slug", "url_type", "link_text", "url"]
        )
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"Wrote {len(all_rows)} rows across {len(products)} products to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
