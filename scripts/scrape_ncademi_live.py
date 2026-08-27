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
second fetch to actually parse): each URL is fetched once and branches
immediately on protection status -- the sole exception is a protected
page on an "added" run, which takes a second fetch to re-load it with the
wp-postpass cookie once its password has been POSTed.

Usage:
    python3 scripts/scrape_ncademi_live.py

Output:
    frontend/lib/published-live.json -- full product detail (same shape as
        published.json's records) plus tracking_priority/tracking_status/
        tracking_gatherer/tracking_reviewer initialized to null on every
        record, so the file matches PublishedProductRecord
        (frontend/lib/published-tables.ts) even though nothing here has
        ever set a real tracking value -- that only happens in /editor.
        Publicly-visible product pages ONLY: a password-protected page is
        skipped entirely here (it belongs in added-live.json instead).
    frontend/lib/added-live.json -- same shape as published-live.json, but
        for the password-protected ("Added to Site", pending vendor
        review) product pages. Each is unlocked with its vendor-review
        password (frontend/lib/passwords.json, matched to a page via
        frontend/lib/added.json's product_name<->ncademi_product_url) by
        POSTing that password to WordPress's wp-login.php?action=postpass
        endpoint and re-fetching with the resulting wp-postpass cookie,
        then parsed by the SAME parse_public_product() the public pages
        use. An Added Product whose on-file password is rejected is
        reported via the "added_passwords_failed" progress milestone and
        omitted; a protected page with no password on file at all is
        skipped with a stdout note (not an Added Product this tracks).
    frontend/lib/vendors-live.json -- full vendor detail, shaped to match
        DirectoryRecord (frontend/lib/directory-schema.ts) via
        map_vendor_to_directory_record(), the same field mapping
        scripts/migrate_vendors_to_unified.py used to produce the
        already-migrated frontend/lib/vendors.json. That mapping only runs
        at the write step, after the product-vendor_resources dedup step
        below, which needs parse_public_vendor's raw "resources" key on the
        FULL vendors_out records -- mapping first would silently turn dedup
        into a no-op.
Both overwritten unconditionally on a successful run.

Progress streaming: alongside the existing human-readable prints (unchanged,
still meant for a person running this directly from a terminal), main()
also calls emit_progress() at up to seven milestones -- "start",
"published", "added", "added_passwords_failed", "vendors",
"vendors_missing", "complete" -- each printing ONE line of the form
`PROGRESS_JSON:{...}`. frontend/app/api/local/scrape/route.ts spawns
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

import argparse
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
# WordPress's built-in handler for a password-protected post's unlock form
# (see the pw_form on any protected page). POSTing post_password here sets a
# wp-postpass_<hash> cookie on the session that a subsequent GET of the page
# presents to render full content instead of the form.
POSTPASS_URL = "https://ncademi.org/wp-login.php?action=postpass"
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
OUT_ADDED = REPO_ROOT / "frontend" / "lib" / "added-live.json"
OUT_VENDORS = REPO_ROOT / "frontend" / "lib" / "vendors-live.json"
ADDED_PATH = REPO_ROOT / "frontend" / "lib" / "added.json"
PASSWORDS_PATH = REPO_ROOT / "frontend" / "lib" / "passwords.json"

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


def load_added_passwords() -> dict[str, dict]:
    """{ncademi_product_url: {"product_name", "password"}} -- frontend/lib/
    added.json (which carries product_name<->ncademi_product_url) joined to
    frontend/lib/passwords.json (product_name<->password) on exact
    product_name, the same matching convention the rest of the app uses to
    cross-reference a product (see lib/passwords.ts's own header). A page in
    added.json with no passwords.json entry is simply absent from the
    result -- the caller treats "no password on file" the same as a
    rejected password (both land in the added_passwords_failed milestone)."""
    try:
        added = json.loads(ADDED_PATH.read_text(encoding="utf-8")).get("products", [])
        pw_by_name = {
            r["product_name"]: r["password"]
            for r in json.loads(PASSWORDS_PATH.read_text(encoding="utf-8")).get("passwords", [])
            if r.get("product_name") and r.get("password")
        }
    except (OSError, json.JSONDecodeError, KeyError) as e:
        print(f"    ERROR loading Added-product passwords: {e}")
        return {}

    index: dict[str, dict] = {}
    for product in added:
        name = product.get("product_name")
        url = product.get("ncademi_product_url")
        if name and url and name in pw_by_name:
            index[url] = {"product_name": name, "password": pw_by_name[name]}
    return index


def fetch_protected_page(url: str, password: str) -> tuple[str, str | None]:
    """Unlocks a password-protected page: POSTs `password` to WordPress's
    postpass endpoint (setting a wp-postpass_<hash> cookie on SESSION), then
    re-fetches `url` with that cookie. Returns (status, html) matching
    fetch_page's contract -- 'public' with full HTML when the password is
    accepted, 'protected' when it is rejected (pw_form still present), or
    'error' on a network failure."""
    try:
        SESSION.post(
            POSTPASS_URL,
            data={"post_password": password, "Submit": "Submit"},
            headers={"Referer": url},
            allow_redirects=False,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        resp = SESSION.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
        resp.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"    ERROR unlocking {url}: {e}")
        return "error", None

    if BeautifulSoup(resp.text, "html.parser").select_one("form.pw_form"):
        return "protected", None
    return "public", resp.text


def slug_to_name(url: str) -> str:
    """Derives a readable name from a URL slug for protected pages."""
    path = urlparse(url).path.strip("/")
    slug = path.split("/")[-1]
    return slug.replace("-", " ").title()


def emit_progress(stage: str, message: str, **extra) -> None:
    """One machine-readable progress line for route.ts to parse -- see the
    module docstring's "Progress streaming" section for the full protocol.
    `stage` is a stable id ("start"/"published"/"added"/
    "added_passwords_failed"/"vendors"/"vendors_missing"/"complete"); the
    frontend uses it to REPLACE that stage's row in place rather than
    appending a new one, which is what makes the "published"/"added"/
    "vendors" counters look like they're live-updating in the Messages log
    instead of spamming one new line per page. flush=True defeats Python's
    own line-buffering on top of the PYTHONUNBUFFERED env var route.ts
    already sets -- belt and suspenders, since this line existing at all
    only matters if it reaches Node promptly."""
    print(f"{PROGRESS_PREFIX}{json.dumps({'stage': stage, 'message': message, **extra})}", flush=True)


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


def parse_public_product(html: str, url: str, is_protected: bool = False) -> dict:
    """Parses a rendered product page into the frontend's record shape.
    `is_protected` is a passthrough for the returned record's own field --
    True when `html` is a password-protected page unlocked via
    fetch_protected_page() (added-live.json), False for a genuinely public
    page (published-live.json). The markup is identical either way; the one
    visible difference WordPress introduces on a protected post is the
    "Protected: " title prefix, stripped below."""
    soup = BeautifulSoup(html, "html.parser")
    article = soup.select_one("article.nc-single-product") or soup.select_one("article.product")
    if not article:
        raise ValueError("Could not find product <article> container.")

    product_name = text_or_none(article.select_one("h1"))
    # WordPress's default protected_title_format is "Protected: %s" -- drop
    # that prefix so an unlocked page's product_name matches its
    # added.json/passwords.json counterpart exactly.
    if is_protected and product_name and product_name.startswith("Protected: "):
        product_name = product_name[len("Protected: "):]
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
        "is_protected": is_protected,
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
        "support_contacts": extract_support_contacts(soup),
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
    so a same-URL-different-vendor coincidence is never misattributed. A
    product with no vendor_name or no vendor_resources is a no-op here.
    Returns the number of URLs removed."""
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
def map_vendor_to_directory_record(vendor: dict) -> dict:
    """Maps a scraped vendor record (parse_public_vendor's full detail, or
    make_protected_vendor_stub's already-minimal stub) to the DirectoryRecord
    shape frontend/lib/directory-schema.ts defines, for vendors-live.json --
    same field mapping scripts/migrate_vendors_to_unified.py established for
    the already-migrated frontend/lib/vendors.json: a resource only lands in
    vendor_resources when its source is exactly "Vendor"; every other
    resource (parse_public_vendor's own resources are all tagged "Internal")
    lands in other_resources instead, matching that migration's split and
    the resulting shape already on disk in vendors.json.

    Must run on the FULL vendor records (vendors_out) -- same as the trimmed
    version this replaces -- and, like that version, only AFTER
    build_vendor_url_index/dedupe_vendor_resources below, which need the raw
    "resources" key this function doesn't preserve; running it first would
    silently turn the dedup step into a no-op.

    acr_reports/product_description/last_updated/ai_insights/tracking_status
    have no vendor-page equivalent to scrape (mirrors the migration's own
    "vendors have no ACR reports" stance) and stay null/empty, same as a
    freshly-scraped product's tracking_* fields in parse_public_product."""
    resources = vendor.get("resources", [])
    vendor_resources = [{"text": r["text"], "url": r["url"]} for r in resources if r.get("source") == "Vendor"]
    other_resources = [{"text": r["text"], "url": r["url"]} for r in resources if r.get("source") != "Vendor"]

    return {
        "kind": "vendor",
        "product_name": vendor.get("vendor_name"),
        "vendor_name": vendor.get("vendor_name"),
        "vendor_directory_url": vendor.get("vendor_directory_url"),
        "product_website_url": vendor.get("vendor_website_url"),
        "product_description": None,
        "vendor_resources": vendor_resources,
        "other_resources": other_resources,
        "support_contacts": vendor.get("support_contacts", []),
        "acr_reports": [],
        "products": vendor.get("products", []),
        "last_updated": None,
        "ai_insights": None,
        "tracking_status": None,
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
    # open(path, "w") already truncates-and-rewrites, so this unlink is
    # belt-and-suspenders, not load-bearing -- explicit per request, to
    # guarantee no lingering file artifact survives an overwrite. Worth
    # noting the tradeoff: this creates a brief window where `path` does
    # not exist at all (between the unlink and the new file being written),
    # unlike a plain truncating write, which never leaves the path missing.
    # Fine for this local, single-writer dev script; would NOT be the right
    # call for something like lib/local-write.ts's atomic temp-file+rename
    # writes, which exist specifically to avoid ever exposing a missing or
    # partial file to a concurrent reader.
    path.unlink(missing_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape the NCADEMI directory for products and/or vendors.")
    parser.add_argument(
        "--target",
        choices=["all", "published", "added", "vendors"],
        default="all",
        help="Which category to scrape (default: all). 'published' scrapes only publicly-visible "
        "product pages; 'added' scrapes only password-protected product pages, unlocking each with its "
        "vendor-review password. Each single-category run writes only that category's output file and "
        "skips the cross-category vendor-resource dedup step, which requires all datasets loaded.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    target = args.target
    scrape_published = target in ("published", "all")
    scrape_added = target in ("added", "all")
    scrape_vendors = target in ("vendors", "all")
    scrape_products = scrape_published or scrape_added

    # Milestone A. Fixed text per route.ts/records page's Messages log spec
    # -- printed before URL discovery even starts, so it's the first thing
    # a client streaming this process sees.
    emit_progress("start", "Retrieving data." if target == "all" else f"Retrieving {target} data.")

    print("--- 1. REST API URL Discovery ---")
    # Both "published" and "added" scrape from the single product post type
    # -- the only difference is which protection status each keeps -- so one
    # URL discovery + one fetch per URL serves both.
    product_urls = sorted(get_rest_urls("product")) if scrape_products else []
    vendor_urls = sorted(get_rest_urls("vendor")) if scrape_vendors else []
    print(f"\nTotal: {len(product_urls)} product URL(s), {len(vendor_urls)} vendor URL(s).")

    published_out: list[dict] = []
    added_out: list[dict] = []
    # product_name of each Added Product whose vendor-review password was on
    # file but did not unlock its page (rejected by WordPress, or the page
    # errored/failed to parse). Reported once, after the loop, as the
    # added_passwords_failed milestone; those pages are omitted from
    # added-live.json. Protected pages with NO password on file are not
    # Added Products we track and don't count here (stdout note only).
    failed_added: list[str] = []
    if scrape_products:
        print("\n--- 2. Scraping product pages ---")
        added_passwords = load_added_passwords() if scrape_added else {}
        published_count = 0
        added_count = 0
        for i, url in enumerate(product_urls, start=1):
            print(f"[{i}/{len(product_urls)}] {url}")
            # WordPress's wp-postpass_ cookie is site-wide (keyed by the site
            # URL, not the individual post), so an unlock from a previous
            # iteration would otherwise carry over and make the next
            # protected page misclassify as "public". Clear per-iteration --
            # this scraper holds no session state worth preserving.
            SESSION.cookies.clear()
            status, html = fetch_page(url)

            if status == "public" and scrape_published:
                try:
                    published_out.append(parse_public_product(html, url))
                    published_count += 1
                except Exception as e:
                    print(f"    ERROR parsing {url}: {e}")
            elif status == "protected" and scrape_added:
                entry = added_passwords.get(url)
                if not entry:
                    # Protected, but not an Added Product we track (no
                    # added.json + passwords.json entry) -- e.g. a page still
                    # gated for reasons outside this workflow. Not our
                    # concern to unlock; note it on stdout only, keep it out
                    # of the added_passwords_failed milestone.
                    print(f"    SKIP protected page with no vendor-review password on file: {url}")
                else:
                    unlocked_status, unlocked_html = fetch_protected_page(url, entry["password"])
                    if unlocked_status == "public":
                        try:
                            added_out.append(parse_public_product(unlocked_html, url, is_protected=True))
                            added_count += 1
                        except Exception as e:
                            print(f"    ERROR parsing {url}: {e}")
                            failed_added.append(entry["product_name"])
                    else:
                        # "protected" (password rejected) or "error" -- either
                        # way this page did not yield content.
                        failed_added.append(entry["product_name"])
            # Every other combination -- a public page on an added-only run,
            # a protected page on a published-only run, or "missing"/"error"
            # from fetch_page (already logged there) -- is skipped.

            if scrape_published:
                emit_progress(
                    "published",
                    f"Retrieved {published_count} published product pages.",
                    published=published_count,
                )
            if scrape_added:
                emit_progress(
                    "added",
                    f"Retrieved {added_count} added product pages.",
                    added=added_count,
                )
            time.sleep(PAGE_FETCH_DELAY_SECONDS)

        # Milestone: the Added-product passwords that failed. Conditional on
        # there being any -- same "nothing useful to say about zero" stance
        # as the vendors_missing milestone below.
        if scrape_added and failed_added:
            failed_sorted = sorted(failed_added)
            emit_progress(
                "added_passwords_failed",
                "The following Added Product passwords failed: " + "; ".join(failed_sorted) + ".",
                failed=failed_sorted,
            )

    vendors_out: list[dict] = []
    missing_vendor_urls: list[str] = []
    if scrape_vendors:
        print("\n--- 3. Scraping vendors ---")
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

    # Dedup requires this run's product AND vendor scrapes loaded together,
    # so it only makes sense -- and only runs -- for target=='all'. Applied
    # to both product sets: an unlocked "added" page carries the same
    # vendor_resources markup a public one does.
    if target == "all":
        print("\n--- 4. Deduplicating vendor resources ---")
        vendor_url_index = build_vendor_url_index(vendors_out)
        removed = dedupe_vendor_resources([*published_out, *added_out], vendor_url_index)
        print(f"Removed {removed} product-level vendor_resources URL(s) already captured under their vendor.")

    print("\n--- 5. Saving Results ---")
    last_scraped = datetime.now(timezone.utc).isoformat()
    if scrape_published:
        write_output(OUT_PRODUCTS, "products", published_out, last_scraped)
        print(f"Saved {len(published_out)} published products to {OUT_PRODUCTS.relative_to(REPO_ROOT)}")
    if scrape_added:
        write_output(OUT_ADDED, "products", added_out, last_scraped)
        print(f"Saved {len(added_out)} added products to {OUT_ADDED.relative_to(REPO_ROOT)}")
    if scrape_vendors:
        write_output(OUT_VENDORS, "vendors", [map_vendor_to_directory_record(v) for v in vendors_out], last_scraped)
        print(f"Saved {len(vendors_out)} vendors to {OUT_VENDORS.relative_to(REPO_ROOT)}")

    # Milestone E. Last line of the run -- only reports counts for the
    # category/categories actually scraped this run, so a targeted run never
    # reports a misleading 0 for the category it didn't touch.
    complete_extra: dict = {}
    if scrape_published:
        complete_extra["published"] = len(published_out)
    if scrape_added:
        complete_extra["added"] = len(added_out)
    if scrape_vendors:
        complete_extra["vendors"] = len(vendors_out)
    emit_progress("complete", "Process complete", **complete_extra)


if __name__ == "__main__":
    main()
