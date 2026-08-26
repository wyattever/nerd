#!/usr/bin/env python3
"""
scrape_ncademi_live.py — Production live-scrape of the NCADEMI directory
(products + vendors), consolidating three prototype scripts written during
Phase 3 exploration:

  - build_live_index.py    -- WordPress REST API URL discovery
                               (get_rest_urls) and the password-protection
                               check (form.pw_form).
  - temp_content_scraper.py -- BeautifulSoup extraction of a public
                               product/vendor page into the frontend's
                               record shape (parse_public_product /
                               parse_public_vendor and their helpers).
  - dedupe_vendor_resources.py -- the (vendor_name, url) vendor-resource
                               dedup rule, reused here as
                               build_vendor_url_index / dedupe_vendor_resources
                               but applied to this run's own freshly-scraped
                               vendors rather than a committed vendors.json.

Consolidated into ONE pass per URL rather than the prototypes' two (a
discovery+status pass writing an intermediate live-index.json, then a
second fetch to actually parse): each URL is fetched exactly once here,
and branches immediately on protection status.

Usage:
    python3 scripts/scrape_ncademi_live.py

Output:
    frontend/lib/published-live.json -- full product detail (same shape as
        published.json's records) plus tracking_priority/tracking_status/
        tracking_gatherer/tracking_reviewer initialized to null on every
        non-protected record, so the file matches PublishedProductRecord
        (frontend/lib/published-tables.ts) even though nothing here has
        ever set a real tracking value -- that only happens in /editor.
    frontend/lib/vendors-live.json -- deliberately NOT full vendor detail:
        just vendor_name/vendor_directory_url/is_protected. The full
        resources/products detail is still scraped internally (see
        parse_public_vendor) and used for the product-vendor_resources
        dedup step below -- simplify_vendor_for_output() trims it only at
        the write step, so this file stays a lightweight name+URL list
        without breaking that dedup.
Both overwritten unconditionally on a successful run.

Progress streaming: alongside the existing human-readable prints (unchanged,
still meant for a person running this directly from a terminal), main()
also calls emit_progress() at five milestones -- "start", "products",
"vendors", "vendors_missing", "complete" -- each printing ONE line of the
form `PROGRESS_JSON:{...}`. frontend/app/api/local/scrape/route.ts spawns
this script (not execFile -- spawn's stdout is a live stream, execFile only
returns output after the process exits) and forwards each such line to the
browser as an SSE event, which is what makes /records' Messages log update
live instead of only after the whole ~1-2 minute run finishes. The
PYTHONUNBUFFERED=1 that route.ts sets when spawning is load-bearing here:
Python fully block-buffers stdout when it isn't a TTY, so without it every
print() -- progress lines included -- would sit in a buffer and only reach
Node in one lump at process exit, silently defeating the whole point of
streaming. emit_progress() also flushes explicitly, as defense in depth for
anyone invoking this script under a runner that doesn't set that env var.
"""

from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

# --- Configuration ---
USER_AGENT = "Mozilla/5.0 (compatible; NCADEMI-directory-audit/5.0)"
API_BASE = "https://ncademi.org/wp-json/wp/v2"
REST_PAGE_DELAY_SECONDS = 0.1
PAGE_FETCH_DELAY_SECONDS = 0.3
REQUEST_TIMEOUT_SECONDS = 15

# Must match PROGRESS_PREFIX in frontend/app/api/local/scrape/route.ts --
# the one thing that ties this script's stdout protocol to that route's
# parser. Anything printed on a line that doesn't start with this prefix is
# just the normal human-readable log and is not forwarded as an SSE event.
PROGRESS_PREFIX = "PROGRESS_JSON:"

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PRODUCTS = REPO_ROOT / "frontend" / "lib" / "published-live.json"
OUT_VENDORS = REPO_ROOT / "frontend" / "lib" / "vendors-live.json"

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": USER_AGENT})


# --- 1. REST API URL discovery (from build_live_index.py) ---
def get_rest_urls(post_type: str) -> set[str]:
    """Dynamically finds the REST endpoint for a post type and paginates to
    get every URL of that type."""
    urls: set[str] = set()
    try:
        type_info = SESSION.get(f"{API_BASE}/types/{post_type}").json()

        if "_links" in type_info and "wp:items" in type_info["_links"]:
            items_url = type_info["_links"]["wp:items"][0]["href"]
        else:
            # Fallback if the types endpoint doesn't return the standard link.
            items_url = f"{API_BASE}/{post_type}s"

        print(f"Discovered REST endpoint for '{post_type}': {items_url}")

        page = 1
        while True:
            resp = SESSION.get(f"{items_url}?per_page=100&page={page}")
            if resp.status_code != 200:
                break  # A 400-level error usually means the page is out of bounds.

            items = resp.json()
            if not items:
                break

            for item in items:
                if "link" in item:
                    urls.add(item["link"])

            page += 1
            time.sleep(REST_PAGE_DELAY_SECONDS)

    except Exception as e:
        print(f"Error fetching {post_type}s via REST API: {e}")

    print(f"Found {len(urls)} {post_type} URLs.")
    return urls


# --- 2. Single-fetch classification (protected / public / missing / error) ---
def fetch_page(url: str) -> tuple[str, str | None]:
    """Fetches url exactly once. Returns (status, html): status is one of
    'protected', 'public', 'missing', 'error'; html is populated for
    'protected' and 'public' only."""
    try:
        resp = SESSION.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
        if resp.status_code == 404:
            return "missing", None
        resp.raise_for_status()
    except requests.exceptions.RequestException as e:
        if getattr(e.response, "status_code", None) == 404:
            return "missing", None
        print(f"    ERROR fetching {url}: {e}")
        return "error", None
    except Exception as e:
        print(f"    ERROR fetching {url}: {e}")
        return "error", None

    soup = BeautifulSoup(resp.text, "html.parser")
    if soup.select_one("form.pw_form"):
        return "protected", resp.text
    return "public", resp.text


def slug_to_name(url: str) -> str:
    """Derives a readable name from a URL slug for protected pages."""
    path = urlparse(url).path.strip("/")
    slug = path.split("/")[-1]
    return slug.replace("-", " ").title()


def emit_progress(stage: str, message: str, **extra) -> None:
    """One machine-readable progress line for route.ts to parse -- see the
    module docstring's "Progress streaming" section for the full protocol.
    `stage` is a stable id ("start"/"products"/"vendors"/"vendors_missing"/
    "complete"); the frontend uses it to REPLACE that stage's row in place
    rather than appending a new one, which is what makes the "products"/
    "vendors" counters look like they're live-updating in the Messages log
    instead of spamming one new line per page. flush=True defeats Python's
    own line-buffering on top of the PYTHONUNBUFFERED env var route.ts
    already sets -- belt and suspenders, since this line existing at all
    only matters if it reaches Node promptly."""
    print(f"{PROGRESS_PREFIX}{json.dumps({'stage': stage, 'message': message, **extra})}", flush=True)


def make_protected_product_stub(url: str) -> dict:
    return {"product_name": slug_to_name(url), "ncademi_product_url": url, "is_protected": True}


def make_protected_vendor_stub(url: str) -> dict:
    return {"vendor_name": slug_to_name(url), "vendor_directory_url": url, "is_protected": True}


# --- 3. BeautifulSoup extraction (from temp_content_scraper.py, unchanged) ---
def text_or_none(el):
    if el is None:
        return None
    txt = el.get_text(strip=True)
    return txt if txt else None


def extract_resources(section, heading_text):
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
            contacts.append({"type": "email", "value": href[len("mailto:"):].strip(), "label": None})
        else:
            contacts.append({"type": "url", "value": href, "label": a.get_text(strip=True) or None})
    return contacts


def extract_acr_reports(soup):
    section = soup.select_one("section.edtech-info-card--reports")
    if section is None:
        return []
    articles = section.select("article")
    if not articles:
        body_text = text_or_none(section)
        if body_text and "Available on Request" in body_text:
            return [{"title": "Available on Request", "url": None, "version": None, "date": None, "auditor_name": None, "auditor_url": None}]
        return []
    reports = []
    for art in articles:
        title_a = art.select_one("h3 a")
        title = text_or_none(title_a) or text_or_none(art.select_one("h3"))
        url = title_a["href"].strip() if title_a and title_a.has_attr("href") else None
        version = date = auditor_name = auditor_url = None
        for li in art.select("ul li"):
            label = text_or_none(li.find("strong"))
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
        reports.append({"title": title, "url": url, "version": version, "date": date, "auditor_name": auditor_name, "auditor_url": auditor_url})
    return reports


def parse_public_product(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    article = soup.select_one("article.nc-single-product") or soup.select_one("article.product")
    if not article:
        raise ValueError("Could not find product <article> container.")

    product_name = text_or_none(article.select_one("h1"))
    vendor_p = article.select_one(".entry-content p.mb-2")
    vendor_name, vendor_directory_url = None, None
    if vendor_p:
        a = vendor_p.find("a")
        if a:
            vendor_name = a.get_text(strip=True)
            vendor_directory_url = a.get("href", "").strip() or None
        else:
            vendor_name = vendor_p.get_text(strip=True).replace("Vendor:", "").strip() or None

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

    el_updated = soup.select_one("p.text-end.text-body-secondary em")
    txt_updated = text_or_none(el_updated)
    last_updated = txt_updated[len("Product information last updated"):].strip() if txt_updated and txt_updated.lower().startswith("product information") else txt_updated

    return {
        "product_name": product_name,
        "ncademi_product_url": url,
        "vendor_name": vendor_name,
        "vendor_directory_url": vendor_directory_url,
        "product_website_url": product_website_url,
        "product_description": product_description,
        "vendor_resources": vendor_resources,
        "other_resources": other_resources,
        "support_contacts": extract_support_contacts(article),
        "acr_reports": extract_acr_reports(article),
        "last_updated": last_updated,
        "is_protected": False,
        # Editor-only workflow metadata (see published-tables.ts's
        # PublishedProductRecord and published-validate.ts's
        # OPTIONAL_STRING_FIELDS) -- always null here since a scrape has no
        # opinion on priority/status/gatherer/reviewer, but present (not
        # omitted) so a freshly-scraped record already matches the schema
        # /editor expects instead of silently lacking these keys.
        "tracking_priority": None,
        "tracking_status": None,
        "tracking_gatherer": None,
        "tracking_reviewer": None,
    }


def parse_public_vendor(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    vendor_name = text_or_none(soup.select_one("h1"))

    website_a = soup.select_one("p.edtech-website-link a")
    vendor_website_url = website_a["href"].strip() if website_a and website_a.has_attr("href") else None

    resources = []
    resources_section = soup.select_one("section.edtech-resources")
    if resources_section:
        for h3 in resources_section.select("h3"):
            text = h3.get_text(strip=True)
            if text.startswith("From ") and text != "From Other Sources":
                ul = h3.find_next_sibling("ul")
                if ul:
                    for li in ul.select("li"):
                        a = li.find("a")
                        if a and a.has_attr("href"):
                            url_val = a["href"].strip()
                            hashed_id = hashlib.md5(url_val.encode("utf-8")).hexdigest()[:8]
                            resources.append({
                                "id": hashed_id,
                                "text": a.get_text(strip=True),
                                "url": url_val,
                                "source": "Internal",
                                "label": None,
                                "date": None,
                                "added_to_site": True,
                            })

    products = []
    prod_section = soup.select_one("section.edtech-vendor-products")
    if prod_section:
        for art in prod_section.select("article"):
            a_tag = art.select_one("h3 a") or art.select_one("h5 a") or art.find("a")
            if a_tag and a_tag.has_attr("href"):
                products.append({
                    "product_name": a_tag.get_text(strip=True),
                    "ncademi_product_url": a_tag["href"].strip(),
                })

    return {
        "vendor_name": vendor_name,
        "vendor_directory_url": url,
        "vendor_website_url": vendor_website_url,
        "resources": resources,
        "products": products,
        "is_protected": False,
    }


# --- 4. Vendor-resource dedup rule (from dedupe_vendor_resources.py) ---
def build_vendor_url_index(vendors: list[dict]) -> dict[str, set[str]]:
    """{vendor_name: {resource url, ...}} from this run's own scraped
    vendors -- not a read of the committed frontend/lib/vendors.json."""
    index: dict[str, set[str]] = {}
    for vendor in vendors:
        name = vendor.get("vendor_name")
        if not name:
            continue
        urls = {r["url"] for r in vendor.get("resources", []) if r.get("url")}
        index[name] = urls
    return index


def dedupe_vendor_resources(products: list[dict], vendor_url_index: dict[str, set[str]]) -> int:
    """Strips a product's vendor_resources entries whose URL exactly matches
    one already captured under that SAME vendor_name in vendor_url_index --
    matching by (vendor_name, url), same rule as dedupe_vendor_resources.py,
    so a same-URL-different-vendor coincidence is never misattributed.
    Protected stubs have no vendor_name/vendor_resources keys and are a
    no-op here. Returns the number of URLs removed."""
    removed = 0
    for product in products:
        vendor_name = product.get("vendor_name")
        global_urls = vendor_url_index.get(vendor_name)
        if not global_urls:
            continue

        resources = product.get("vendor_resources")
        if not resources:
            continue

        kept = [r for r in resources if r.get("url") not in global_urls]
        removed += len(resources) - len(kept)
        product["vendor_resources"] = kept

    return removed


# --- 5. Output ---
def simplify_vendor_for_output(vendor: dict) -> dict:
    """Trims a scraped vendor record (parse_public_vendor's full detail, or
    make_protected_vendor_stub's already-minimal stub) down to just
    name/URL/protection status for vendors-live.json. The resources/
    products detail parse_public_vendor also computes is deliberately NOT
    persisted here -- it only exists to feed build_vendor_url_index/
    dedupe_vendor_resources below, which must run on the FULL vendor
    records (vendors_out), before this trim, or the dedup step would
    silently become a no-op."""
    return {
        "vendor_name": vendor.get("vendor_name"),
        "vendor_directory_url": vendor.get("vendor_directory_url"),
        "is_protected": vendor.get("is_protected", False),
    }


def write_output(path: Path, key: str, records: list[dict], last_scraped: str) -> None:
    payload = {
        "$meta": {
            "last_scraped": last_scraped,
            "total_records": len(records),
            "generated_by": "scrape_ncademi_live.py",
        },
        key: records,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main() -> None:
    # Milestone A. Fixed text per route.ts/records page's Messages log spec
    # -- printed before URL discovery even starts, so it's the first thing
    # a client streaming this process sees.
    emit_progress("start", "Retrieving data.")

    print("--- 1. REST API URL Discovery ---")
    product_urls = sorted(get_rest_urls("product"))
    vendor_urls = sorted(get_rest_urls("vendor"))
    print(f"\nTotal: {len(product_urls)} product URL(s), {len(vendor_urls)} vendor URL(s).")

    print("\n--- 2. Scraping products ---")
    products_out: list[dict] = []
    # Milestone B counts these two outcomes separately: "published" ==
    # fully scraped public pages (parse_public_product's full detail),
    # "added" == protected pages that only got a minimal stub (see
    # make_protected_product_stub) -- the two outcomes this loop can
    # actually produce for a product URL, distinct from "missing"/"error"
    # (skipped entirely, not counted here).
    published_count = 0
    added_count = 0
    for i, url in enumerate(product_urls, start=1):
        print(f"[{i}/{len(product_urls)}] {url}")
        status, html = fetch_page(url)
        if status == "protected":
            products_out.append(make_protected_product_stub(url))
            added_count += 1
        elif status == "public":
            try:
                products_out.append(parse_public_product(html, url))
                published_count += 1
            except Exception as e:
                print(f"    ERROR parsing {url}: {e}")
        # "missing"/"error" -- skip, already logged in fetch_page.
        emit_progress(
            "products",
            f"Retrieved {published_count} published product pages and {added_count} added product pages.",
            published=published_count,
            added=added_count,
        )
        time.sleep(PAGE_FETCH_DELAY_SECONDS)

    print("\n--- 3. Scraping vendors ---")
    vendors_out: list[dict] = []
    missing_vendor_urls: list[str] = []
    vendor_retrieved_count = 0
    for i, url in enumerate(vendor_urls, start=1):
        print(f"[{i}/{len(vendor_urls)}] {url}")
        status, html = fetch_page(url)
        if status == "protected":
            vendors_out.append(make_protected_vendor_stub(url))
            vendor_retrieved_count += 1
        elif status == "public":
            try:
                vendors_out.append(parse_public_vendor(html, url))
                vendor_retrieved_count += 1
            except Exception as e:
                print(f"    ERROR parsing {url}: {e}")
                missing_vendor_urls.append(url)
        else:
            # "missing"/"error" from fetch_page itself -- no vendor record
            # at all for this URL, which is exactly what Milestone D reports.
            missing_vendor_urls.append(url)
        # Milestone C -- same "replace this stage's row in place" live-
        # counter behavior as Milestone B above.
        emit_progress(
            "vendors",
            f"Retrieved {vendor_retrieved_count} vendor pages.",
            retrieved=vendor_retrieved_count,
        )
        time.sleep(PAGE_FETCH_DELAY_SECONDS)

    # Milestone D. Skipped entirely when nothing is missing -- a "there is
    # no record for the following: " message naming zero pages has nothing
    # useful to tell the user, so this milestone is conditional on the rest
    # of the fixed A/B/C/E progression, not always emitted.
    if missing_vendor_urls:
        missing_vendor_names = [slug_to_name(u) for u in missing_vendor_urls]
        emit_progress(
            "vendors_missing",
            "There is no record for the following vendor pages: " + "; ".join(missing_vendor_names) + ".",
            missing=missing_vendor_names,
        )

    print("\n--- 4. Deduplicating vendor resources ---")
    vendor_url_index = build_vendor_url_index(vendors_out)
    removed = dedupe_vendor_resources(products_out, vendor_url_index)
    print(f"Removed {removed} product-level vendor_resources URL(s) already captured under their vendor.")

    print("\n--- 5. Saving Results ---")
    last_scraped = datetime.now(timezone.utc).isoformat()
    write_output(OUT_PRODUCTS, "products", products_out, last_scraped)
    print(f"Saved {len(products_out)} products to {OUT_PRODUCTS.relative_to(REPO_ROOT)}")
    write_output(OUT_VENDORS, "vendors", [simplify_vendor_for_output(v) for v in vendors_out], last_scraped)
    print(f"Saved {len(vendors_out)} vendors to {OUT_VENDORS.relative_to(REPO_ROOT)}")

    # Milestone E. Fixed text, last line of the run.
    emit_progress(
        "complete",
        "Process complete",
        products=len(products_out),
        vendors=len(vendors_out),
    )


if __name__ == "__main__":
    main()
