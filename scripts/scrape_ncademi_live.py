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

Reads and writes Firestore, never the filesystem (DECISION_LOG.md #66). All
documents live in the `nerd_documents` collection, the same store the editor
uses via lib/server/documents.ts and scripts/nerd_documents.py.

Usage:
    # local, against the Firestore emulator
    FIRESTORE_EMULATOR_HOST=localhost:8080 python3 scripts/scrape_ncademi_live.py
    # against the real project -- --prod is required, never the default
    python3 scripts/scrape_ncademi_live.py --prod

Input:
    nerd_documents/added and nerd_documents/passwords -- joined on exact
        product_name to build the Added-product unlock index. Both are
        required; a missing one aborts the run naming the key.

Output:
    nerd_documents/published-live -- full product detail (same shape as
        published.json's records). No tracking_* keys: editor workflow
        metadata is decoupled into frontend/lib/tracking.json (see
        frontend/lib/tracking.ts) and merged onto records at read time, so
        a scrape neither carries nor needs an opinion on it. Publicly-
        visible product pages ONLY: a password-protected page is skipped
        entirely here (it belongs in added-live instead).
    nerd_documents/added-live -- same shape as published-live, but
        for the password-protected ("Added to Site", pending vendor
        review) product pages. Each is unlocked with its vendor-review
        password (nerd_documents/passwords, matched to a page via
        nerd_documents/added's product_name<->ncademi_product_url) by
        POSTing that password to WordPress's wp-login.php?action=postpass
        endpoint and re-fetching with the resulting wp-postpass cookie,
        then parsed by the SAME parse_public_product() the public pages
        use. An Added Product whose on-file password is rejected is
        reported via the "added_passwords_failed" progress milestone and
        omitted; a protected page with no password on file at all is
        skipped with a stdout note (not an Added Product this tracks).
    nerd_documents/vendors-live -- full vendor detail, shaped to match
        DirectoryRecord (frontend/lib/directory-schema.ts) via
        map_vendor_to_directory_record(), the same field mapping
        scripts/migrate_vendors_to_unified.py used to produce the
        already-migrated frontend/lib/vendors.json. That mapping only runs
        at the write step, after the product-vendor_resources dedup step
        below, which needs parse_public_vendor's raw "resources" key on the
        FULL vendors_out records -- mapping first would silently turn dedup
        into a no-op.
Both overwritten unconditionally on a successful run.

Progress milestones: alongside the ordinary human-readable prints, main()
also calls emit_progress() at up to seven milestones -- "start",
"published", "added", "added_passwords_failed", "vendors",
"vendors_missing", "complete" -- each printing ONE line of the form
`PROGRESS_JSON:{...}`.

These lines have no frontend consumer. They used to be parsed by
frontend/app/api/local/scrape/route.ts, which spawned this script and
forwarded each one to the browser as an SSE event; that route was deleted
with the in-app scrape trigger (DECISION_LOG.md #66). The milestones are
kept because they mark the run's shape legibly for whoever is watching the
terminal, which is now the only place this output goes. emit_progress()
still flushes explicitly, so the ordering stays honest even when stdout is
piped somewhere that block-buffers it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from google.cloud import firestore

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

# Prefix for the machine-readable milestone lines emit_progress() prints:
# one line of the form `PROGRESS_JSON:{"stage": ..., "message": ...}`.
# Anything printed on a line that doesn't start with this prefix is just the
# normal human-readable log.
#
# This protocol now has NO frontend consumer. It used to be parsed by
# frontend/app/api/local/scrape/route.ts and forwarded to the browser as SSE
# events; that route was deleted with the in-app scrape trigger (see
# DECISION_LOG.md #66). The lines are kept because they mark the run's
# progress legibly for a person watching the terminal, which is now the only
# place this output goes.
PROGRESS_PREFIX = "PROGRESS_JSON:"

# --- Firestore ---------------------------------------------------------------
# The scrape reads and writes documents in the `nerd_documents` collection --
# the same store lib/server/documents.ts and scripts/nerd_documents.py use.
# There is no filesystem I/O; see DECISION_LOG.md #66.
COLLECTION = "nerd_documents"

# THE PROJECT IS PINNED HERE, IN CODE, ON PURPOSE.
#
# GOOGLE_CLOUD_PROJECT is NEVER consulted. This machine exports it globally as
# "acp-vertex-core" for unrelated tooling, and an explicit constructor argument
# is the only resolution layer that outranks it (see
# docs/firestore-local-auth-09-03-26.md section 2). Without this pin, that
# variable would win and every read and write here would target the wrong
# database.
#
# The usual reassurance -- "a wrong-project write just fails with 403" --
# does NOT apply. It assumes the caller has no permissions on the leaked
# project. The developer running this script DOES have write access to
# acp-vertex-core, so a leaked write would SUCCEED SILENTLY into the wrong
# Firestore: no error, no prompt, wrong data written. Same reasoning as
# scripts/nerd_documents.py's docstring and lib/server/firebase-admin.ts.
PROJECT_ID = "edtech-agent-2026"

# Read by load_added_passwords(); written by save_live_document(). Named as
# literals at every call site -- never computed, never iterated. IAM cannot
# scope Firestore below the database level and Security Rules do not apply to
# a service-account/ADC client, so a wrong key computed at runtime would
# silently overwrite `published`, `vendors`, `passwords`, or `tracking` with
# scrape output, with no ETag guard in the way (DECISION_LOG.md #66).
DOC_ADDED = "added"
DOC_PASSWORDS = "passwords"
DOC_PUBLISHED_LIVE = "published-live"
DOC_ADDED_LIVE = "added-live"
DOC_VENDORS_LIVE = "vendors-live"


class DocumentMissingError(RuntimeError):
    """A `nerd_documents` document the scrape requires does not exist."""


def firestore_client() -> firestore.Client:
    """The one Firestore client for this run, pinned to PROJECT_ID.

    FIRESTORE_EMULATOR_HOST, when set, redirects the client to the emulator and
    makes the project id nominal -- that is the local development path and it
    is honored automatically by the client library."""
    client = firestore.Client(project=PROJECT_ID)
    if client.project != PROJECT_ID:
        raise RuntimeError(
            f"Firestore client resolved project {client.project!r}, expected "
            f"{PROJECT_ID!r}. Refusing to continue -- see the PROJECT_ID comment "
            "above for why a wrong project here fails silently rather than loudly."
        )
    return client


def read_document(client: firestore.Client, key: str) -> dict:
    """Parsed contents of `nerd_documents/{key}`.

    The document stores the JSON verbatim in a `bytes` string field, exactly as
    scripts/nerd_documents.py writes it. Raises DocumentMissingError naming the
    key when the document does not exist -- an absent input is a hard failure,
    never a silent empty result."""
    snap = client.collection(COLLECTION).document(key).get()
    if not snap.exists:
        raise DocumentMissingError(
            f"{COLLECTION}/{key} does not exist. Seed it first: "
            f"python3 scripts/nerd_documents.py push --project {PROJECT_ID}"
        )
    return json.loads(snap.get("bytes"))


SESSION = requests.Session()
SESSION.headers.update({"User-Agent": USER_AGENT})


# --- 1. REST API URL discovery (from build_live_index.py) ---
def get_rest_urls(post_type: str) -> tuple[set[str], set[str]]:
    """Dynamically finds the REST endpoint for a post type and paginates to
    get every URL of that type. Returns (all_urls, protected_urls).

    protected_urls is read from each item's own `class_list` -- WordPress
    core appends the literal string "post-password-required" there
    (get_post_class() / post_password_required()) whenever a post has a
    password set, the exact same condition fetch_page() re-derives later
    from form.pw_form on the rendered page. Classifying protection at
    discovery time this way costs ZERO extra requests: class_list is
    already present in the same paginated item list this function fetches
    to build all_urls. Confirmed empirically against the real API: a known-
    protected product's class_list carries post-password-required AND its
    rendered page carries form.pw_form; a known-public product's carries
    neither. See DECISION_LOG.md for the recon this enabled (--target added
    now fetches only the protected subset, see main())."""
    urls: set[str] = set()
    protected: set[str] = set()
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
                link = item.get("link")
                if not link:
                    continue
                urls.add(link)
                if "post-password-required" in item.get("class_list", []):
                    protected.add(link)

            page += 1
            time.sleep(REST_PAGE_DELAY_SECONDS)

    except Exception as e:
        print(f"Error fetching {post_type}s via REST API: {e}")

    print(f"Found {len(urls)} {post_type} URLs.")
    return urls, protected


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


def load_added_passwords(
    client: firestore.Client,
) -> tuple[dict[str, dict], dict[str, str]]:
    """Returns (by_url, names_by_url):

      by_url: {ncademi_product_url: {"product_name", "password"}} -- the
        `added` document (which carries product_name<->ncademi_product_url)
        joined to the `passwords` document (product_name<->password) on
        exact product_name, the same matching convention the rest of the app
        uses to cross-reference a product (see lib/passwords.ts's own
        header). Only entries with a password on file. This is what the
        caller attempts to unlock.
      names_by_url: {ncademi_product_url: product_name} for EVERY tracked
        Added Product regardless of whether it has a password -- by_url
        alone cannot name a product that turns out to have NO password on
        file (it's excluded from by_url precisely because it has none), so
        the caller uses this to label that case in added-live.json's
        $meta.missing.

    Both documents are required. A missing one raises DocumentMissingError
    naming the key rather than returning an empty index -- scraping on with no
    passwords would silently skip every Added page and look like a clean run.
    This is also the fix for the staleness bug in DECISION_LOG.md #65: the
    passwords now come from the document the editor actually writes, not from
    frontend/lib/passwords.json, which has had no writer since Phase 2."""
    added = read_document(client, DOC_ADDED).get("products", [])
    pw_by_name = {
        r["product_name"]: r["password"]
        for r in read_document(client, DOC_PASSWORDS).get("passwords", [])
        if r.get("product_name") and r.get("password")
    }

    by_url: dict[str, dict] = {}
    names_by_url: dict[str, str] = {}
    for product in added:
        name = product.get("product_name")
        url = product.get("ncademi_product_url")
        if not (name and url):
            continue
        names_by_url[url] = name
        if name in pw_by_name:
            by_url[url] = {"product_name": name, "password": pw_by_name[name]}
    return by_url, names_by_url


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
        # No tracking_* keys: editor workflow metadata
        # (priority/status/gatherer/reviewer) is decoupled into
        # frontend/lib/tracking.json (see frontend/lib/tracking.ts) and
        # merged onto records at read time -- a scrape has no opinion on it
        # and emitting nulls here would just be noise the promote step has
        # to strip again.
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

    acr_reports/product_description/last_updated/ai_insights have no
    vendor-page equivalent to scrape (mirrors the migration's own "vendors
    have no ACR reports" stance) and stay null/empty. tracking_status is
    not emitted at all -- like a product's tracking_* fields it is
    decoupled into frontend/lib/tracking.json (see frontend/lib/tracking.ts)
    and merged on at read time."""
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
        "is_protected": vendor.get("is_protected", False),
    }


def save_live_document(
    client: firestore.Client,
    doc_key: str,
    key: str,
    records: list[dict],
    last_scraped: str,
    missing: list[dict] | None = None,
) -> None:
    """Writes one live snapshot to `nerd_documents/{doc_key}`.

    `doc_key` is always supplied by the caller as a literal -- see the DOC_*
    constants' comment above for why this must never become a computed or
    iterated lookup.

    `missing`, when not None, is added to $meta as `$meta.missing` -- used
    only by the added-live call site, for the Added Products this run could
    not put in `records` (no password on file, or the password on file
    failed to unlock the page; see main()'s scrape_added branch). The other
    two call sites (published-live, vendors-live) pass nothing, leaving
    $meta exactly as before -- see BYTE AND ETAG CONVENTION below.

    BYTE AND ETAG CONVENTION, load-bearing. The stored string is
    byte-identical to what scripts/nerd_documents.py's `push` would have
    stored for the same content: json.dumps with indent=2, ensure_ascii=False,
    plus a trailing newline -- exactly what the previous json.dump(..., f) +
    f.write("\\n") produced on disk. The etag is SHA-256 over the UTF-8
    encoding of precisely those bytes, hex-encoded, matching
    nerd_documents.py's etag_of() and lib/server/documents.ts's etagOf().
    Diverging on either would surface in the editor as spurious 412s that look
    like concurrency conflicts. `missing` defaulting to None (omitted from
    $meta entirely, not written as null/[]) is what keeps this convention
    byte-identical for the two call sites that never pass it."""
    meta = {
        "last_scraped": last_scraped,
        "total_records": len(records),
        "generated_by": "scrape_ncademi_live.py",
    }
    if missing is not None:
        meta["missing"] = missing
    payload = {
        "$meta": meta,
        key: records,
    }
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    raw = text.encode("utf-8")
    client.collection(COLLECTION).document(doc_key).set(
        {
            "bytes": text,
            "etag": hashlib.sha256(raw).hexdigest(),
            "size_bytes": len(raw),
            "updated_at": firestore.SERVER_TIMESTAMP,
            "updated_by": f"scrape_ncademi_live.py:{os.getenv('USER', 'unknown')}",
        }
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape the NCADEMI directory for products and/or vendors.")
    parser.add_argument(
        "--target",
        choices=["all", "published", "added", "vendors"],
        default="all",
        help="Which category to scrape (default: all). 'published' scrapes only publicly-visible "
        "product pages; 'added' scrapes only password-protected product pages, unlocking each with its "
        "vendor-review password. Each single-category run writes only that category's output document and "
        "skips the cross-category vendor-resource dedup step, which requires all datasets loaded.",
    )
    parser.add_argument(
        "--prod",
        action="store_true",
        help="Required to read and write the real "
        f"{PROJECT_ID} Firestore. Ignored when FIRESTORE_EMULATOR_HOST is set, which "
        "always wins. Without either, the script refuses to run rather than touch "
        "production by default.",
    )
    return parser.parse_args()


def assert_write_target(prod: bool) -> None:
    """Decides -- and announces -- which Firestore this run will use.

    Called first thing in main(), before any URL discovery: a ten-minute
    scrape that only then refuses to write is strictly worse than a fast
    failure, so the decision happens up front.

    FIRESTORE_EMULATOR_HOST wins outright when set, and --prod is ignored in
    that case -- there is no production target to protect. Without it the run
    is aimed at real data, and has to say so explicitly."""
    emulator = os.getenv("FIRESTORE_EMULATOR_HOST")
    if emulator:
        print(f"[target] Firestore EMULATOR at {emulator} (project {PROJECT_ID}) -- --prod ignored.")
        return

    if not prod:
        print(
            "Refusing to run: FIRESTORE_EMULATOR_HOST is not set, so this would read "
            f"and write the REAL {PROJECT_ID} Firestore.\n"
            "  run locally:          FIRESTORE_EMULATOR_HOST=localhost:8080 "
            "python3 scripts/scrape_ncademi_live.py\n"
            "  run against prod:     python3 scripts/scrape_ncademi_live.py --prod",
            file=sys.stderr,
        )
        raise SystemExit(2)

    print(f"[target] PRODUCTION Firestore, project {PROJECT_ID} -- live snapshots will be overwritten.")


def main() -> None:
    args = parse_args()
    # Before URL discovery, not before the writes -- see assert_write_target.
    assert_write_target(args.prod)
    client = firestore_client()
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
    # Both "published" and "added" scrape from the single product post type.
    # get_rest_urls() also classifies protection status for free from the
    # same discovery response (see its own docstring) -- a target=="added"
    # run uses that to fetch ONLY the protected subset below, since public
    # pages are never relevant to it. target=="published"/"all" still fetch
    # every URL: "all" needs both public and protected pages from the same
    # single pass, and this optimization is scoped to added-only per this
    # pass's own recon (the same filtering would apply symmetrically to
    # published -- skipping protected pages without fetching them -- but
    # that is not implemented here).
    all_product_urls, protected_product_urls = (
        get_rest_urls("product") if scrape_products else (set(), set())
    )
    all_vendor_urls, _ = get_rest_urls("vendor") if scrape_vendors else (set(), set())
    product_urls = sorted(protected_product_urls if target == "added" else all_product_urls)
    vendor_urls = sorted(all_vendor_urls)
    print(f"\nTotal: {len(product_urls)} product URL(s), {len(vendor_urls)} vendor URL(s).")

    published_out: list[dict] = []
    added_out: list[dict] = []
    # product_name of each Added Product whose vendor-review password was on
    # file but did not unlock its page (rejected by WordPress, or the page
    # errored/failed to parse). Reported once, after the loop, as the
    # added_passwords_failed milestone; those pages are omitted from
    # added-live.json.
    failed_added: list[str] = []
    # Every tracked Added Product that does NOT end up in added_out this run
    # -- both the "no password on file" and "password on file failed to
    # unlock" cases -- written into added-live.json's $meta.missing so these
    # products survive past the run instead of being visible only in stdout
    # (see the SKIP print and the failed_added.append() calls below, which
    # both also feed this list).
    missing_added: list[dict] = []
    if scrape_products:
        print("\n--- 2. Scraping product pages ---")
        added_passwords, added_names_by_url = (
            load_added_passwords(client) if scrape_added else ({}, {})
        )
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
                    print(f"    SKIP protected page with no vendor-review password on file: {url}")
                    # Only record it if it's a tracked Added Product (present
                    # in the `added` document) that simply lacks a password --
                    # a protected page with no added.json entry at all is not
                    # our concern to unlock and stays stdout-only, unchanged.
                    tracked_name = added_names_by_url.get(url)
                    if tracked_name:
                        missing_added.append(
                            {
                                "product_name": tracked_name,
                                "ncademi_product_url": url,
                                "reason": "no_password",
                            }
                        )
                else:
                    unlocked_status, unlocked_html = fetch_protected_page(url, entry["password"])
                    if unlocked_status == "public":
                        try:
                            added_out.append(parse_public_product(unlocked_html, url, is_protected=True))
                            added_count += 1
                        except Exception as e:
                            print(f"    ERROR parsing {url}: {e}")
                            failed_added.append(entry["product_name"])
                            missing_added.append(
                                {
                                    "product_name": entry["product_name"],
                                    "ncademi_product_url": url,
                                    "reason": "password_rejected",
                                }
                            )
                    else:
                        # "protected" (password rejected) or "error" -- either
                        # way this page did not yield content.
                        failed_added.append(entry["product_name"])
                        missing_added.append(
                            {
                                "product_name": entry["product_name"],
                                "ncademi_product_url": url,
                                "reason": "password_rejected",
                            }
                        )
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
        # Each document key is a literal, one per call site. Never a variable,
        # never a lookup -- see the DOC_* constants' comment.
        save_live_document(client, DOC_PUBLISHED_LIVE, "products", published_out, last_scraped)
        print(f"Saved {len(published_out)} published products to {COLLECTION}/{DOC_PUBLISHED_LIVE}")
    if scrape_added:
        save_live_document(
            client, DOC_ADDED_LIVE, "products", added_out, last_scraped, missing=missing_added
        )
        print(f"Saved {len(added_out)} added products to {COLLECTION}/{DOC_ADDED_LIVE}")
        if missing_added:
            print(f"  {len(missing_added)} tracked Added Product(s) missing this run -- see $meta.missing.")
    if scrape_vendors:
        save_live_document(
            client, DOC_VENDORS_LIVE, "vendors", [map_vendor_to_directory_record(v) for v in vendors_out], last_scraped
        )
        print(f"Saved {len(vendors_out)} vendors to {COLLECTION}/{DOC_VENDORS_LIVE}")

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
