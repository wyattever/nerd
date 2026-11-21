#!/usr/bin/env python3
"""
scrape_ncademi_live.py — Production live-scrape of the NCADEMI directory
(products + vendors), consolidating three prototype scripts written during
Phase 3 exploration:

  - build_live_index.py    -- WordPress REST API URL discovery (now
                               discover(), which also reports completeness)
                               and the password-protection check
                               (form.pw_form).
  - temp_content_scraper.py -- BeautifulSoup extraction of a public
                               product/vendor page into the frontend's
                               record shape (parse_public_product /
                               parse_public_vendor and their helpers).
  - dedupe_vendor_resources.py -- the (vendor_name, url) vendor-resource
                               dedup rule, reused here as
                               build_vendor_url_index / dedupe_vendor_resources
                               but applied to this run's own freshly-scraped
                               vendors rather than a committed vendors.json.

Every run is a full run (products and vendors together; DECISION_LOG/plan
D18). Each discovered URL is fetched once and classified into exactly one
outcome (classify_product / classify_vendor) -- the sole exception is a
tracked protected product with a password on file, which takes a second
fetch to re-load it with the wp-postpass cookie once its password has been
POSTed.

Reads and writes Firestore, never the filesystem (DECISION_LOG.md #66). All
documents live in the `nerd_documents` collection, the same store the editor
uses via lib/server/documents.ts and scripts/nerd_documents.py.

Usage (no --target: every run is a full run):
    # local, against the Firestore emulator
    FIRESTORE_EMULATOR_HOST=localhost:8080 python3 scripts/scrape_ncademi_live.py
    # against the real project -- --prod is required, never the default
    python3 scripts/scrape_ncademi_live.py --prod

Input:
    nerd_documents/added and nerd_documents/passwords -- joined on exact
        product_name to build the Added-product unlock index. Both are
        required; a missing one aborts the run naming the key.

Output (all three written together in ONE Firestore batch, so a run either
writes all of them or none):
    nerd_documents/published-live -- records for product pages whose
        outcome is public_ok (same shape as published.json's records). No
        tracking_* keys: editor workflow metadata is decoupled into the
        tracking document and merged onto records at read time.
    nerd_documents/added-live -- same shape, for protected product pages
        whose outcome is protected_unlocked: unlocked with the vendor-review
        password on file (passwords matched to a page via added's
        product_name<->ncademi_product_url) by POSTing it to WordPress's
        wp-login.php?action=postpass and re-fetching with the resulting
        cookie, then parsed by the same parse_public_product().
    nerd_documents/vendors-live -- records for vendor pages whose outcome is
        public_ok, shaped as DirectoryRecord via
        map_vendor_to_directory_record() after the vendor-resource dedup.
        Protected vendor pages produce no record (outcome protected_vendor).
    Every snapshot's $meta carries the identical run record (plan section
    3.9): run_id, started_at, finished_at, target "all", discovery
    completeness per post type, and exactly one outcome per discovered URL
    (public_ok, protected_unlocked, password_rejected, no_password,
    not_tracked, protected_vendor, fetch_error, parse_error). The run is
    validated (check_outcomes) before writing; on any violation nothing is
    written and the script exits non-zero.

Progress milestones: alongside the ordinary human-readable prints, main()
also calls emit_progress() at six milestones -- "start", "published",
"added", "vendors", "outcomes" (counts per post type and status, plus
discovery completeness), "complete" -- each printing ONE line of the form
`PROGRESS_JSON:{...}`.

These lines have no frontend consumer. They used to be parsed by
frontend/app/api/local/scrape/route.ts, which spawned this script and
forwarded each one to the browser as an SSE event; that route was deleted
with the in-app scrape trigger (DECISION_LOG.md #66). The milestones are
kept because they mark the run's shape legibly for whoever is watching the
terminal, which is now the only place this output goes. emit_progress()
still flushes explicitly, so the ordering stays honest even when stdout is
piped somewhere that block-buffers it.

Retries: every GET (discovery's types and list pages, each product and
vendor page, and the unlock re-fetch) goes through _get_with_retries(). A
timeout, connection error, truncated body, or HTTP 408/429/500/502/503/504 is
retried after RETRY_DELAYS_SECONDS (5, 20, 60: four attempts in total); an
integer Retry-After on a 429/503 replaces the scheduled wait, capped at
MAX_RETRY_AFTER_SECONDS (120). 403, 404 and every other status are never
retried. After the last attempt the outcome is exactly what it was without
retries (the same fetch_error or incomplete-discovery detail). The unlock POST
is NEVER retried: one password request per page. Circuit breaker: if
MAX_CONSECUTIVE_EXHAUSTED (5) consecutive GETs exhaust their retries, main()
exits non-zero before the write, so an aborted run writes nothing and the last
good snapshots stay in place. A "Retries:" summary line precedes the save.
"""

from __future__ import annotations

import argparse
import hashlib
import html as html_lib
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit

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
PAGE_FETCH_DELAY_SECONDS = 0.3

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

# Read by load_added_passwords(); written by write_live_snapshots(). Named as
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


# --- 1-2. Added-product unlock index (URL discovery and per-URL fetching now
# live in section 6: discover(), classify_product(), classify_vendor()) ---
def load_added_passwords(client: firestore.Client) -> tuple[dict[str, dict], dict[str, str]]:
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
        build_added_entry() uses it to classify that case as no_password.

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


def emit_progress(stage: str, message: str, **extra) -> None:
    """One machine-readable progress line for route.ts to parse -- see the
    module docstring's "Progress streaming" section for the full protocol.
    `stage` is a stable id ("start"/"published"/"added"/"vendors"/
    "outcomes"/"complete"); the
    frontend uses it to REPLACE that stage's row in place rather than
    appending a new one, which is what makes the "published"/"added"/
    "vendors" counters look like they're live-updating in the Messages log
    instead of spamming one new line per page. flush=True defeats Python's
    own line-buffering on top of the PYTHONUNBUFFERED env var route.ts
    already sets -- belt and suspenders, since this line existing at all
    only matters if it reaches Node promptly."""
    print(f"{PROGRESS_PREFIX}{json.dumps({'stage': stage, 'message': message, **extra})}", flush=True)


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
    classify_product()'s postpass unlock (added-live), False for a genuinely public
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
    """Maps a scraped vendor record (parse_public_vendor's full detail;
    protected vendor pages produce no record at all) to the DirectoryRecord
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


def parse_args() -> argparse.Namespace:
    # No --target: every run is a full run (plan D18), so all three snapshots
    # always come from the same run.
    parser = argparse.ArgumentParser(description="Scrape the NCADEMI directory (products and vendors, always together).")
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
    reset_retry_state()
    args = parse_args()
    # Before URL discovery, not before the writes -- see assert_write_target.
    assert_write_target(args.prod)
    client = firestore_client()
    run_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc).isoformat()

    # Milestone A -- printed before any network work.
    emit_progress("start", "Retrieving data.")

    # Read before any network work: a missing `added` or `passwords` document
    # aborts here (DocumentMissingError), before anything is written.
    by_url, names_by_url = load_added_passwords(client)

    print("--- 1. REST API URL Discovery ---")
    # An incomplete discovery is recorded in the run record, not fatal (D15):
    # the promote planner proposes no deletions for an incomplete post type.
    product_disc = discover("product")
    vendor_disc = discover("vendor")
    for post_type, disc in (("product", product_disc), ("vendor", vendor_disc)):
        state = "complete" if disc["complete"] else f"INCOMPLETE ({disc['error']})"
        print(f"Found {disc['discovered']} {post_type} URLs (expected {disc['expected_total']}): {state}")

    outcomes: list[dict] = []
    published_out: list[dict] = []
    added_out: list[dict] = []

    print("\n--- 2. Scraping product pages ---")
    product_urls = sorted(product_disc["urls"])
    for i, url in enumerate(product_urls, start=1):
        o = classify_product(
            url,
            protected_by_rest=url in product_disc["protected"],
            rest_title=product_disc["titles"].get(url),
            added_entry=build_added_entry(url, by_url, names_by_url),
        )
        print(f"[{i}/{len(product_urls)}] {url} -> {o['status']}" + (f" ({o['detail']})" if o["detail"] else ""))
        _abort_if_site_unreachable()
        # Re-parse the classifier's page HTML with the same parser it validated
        # against; record shaping is unchanged from the previous main().
        if o["status"] == "public_ok":
            published_out.append(parse_public_product(o["html"], url))
        elif o["status"] == "protected_unlocked":
            added_out.append(parse_public_product(o["html"], url, is_protected=True))
        outcomes.append(o)
        emit_progress("published", f"Retrieved {len(published_out)} published product pages.", published=len(published_out))
        emit_progress("added", f"Retrieved {len(added_out)} added product pages.", added=len(added_out))
        time.sleep(PAGE_FETCH_DELAY_SECONDS)

    vendors_out: list[dict] = []
    print("\n--- 3. Scraping vendors ---")
    vendor_urls = sorted(vendor_disc["urls"])
    for i, url in enumerate(vendor_urls, start=1):
        o = classify_vendor(url, protected_by_rest=url in vendor_disc["protected"])
        print(f"[{i}/{len(vendor_urls)}] {url} -> {o['status']}" + (f" ({o['detail']})" if o["detail"] else ""))
        _abort_if_site_unreachable()
        # protected_vendor produces no vendors-live record (D22).
        if o["status"] == "public_ok":
            vendors_out.append(parse_public_vendor(o["html"], url))
        outcomes.append(o)
        emit_progress("vendors", f"Retrieved {len(vendors_out)} vendor pages.", retrieved=len(vendors_out))
        time.sleep(PAGE_FETCH_DELAY_SECONDS)

    # Every run is a full run, so the dedup always has products and vendors
    # from the same run. Applied to both product sets.
    print("\n--- 4. Deduplicating vendor resources ---")
    vendor_url_index = build_vendor_url_index(vendors_out)
    removed = dedupe_vendor_resources([*published_out, *added_out], vendor_url_index)
    print(f"Removed {removed} product-level vendor_resources URL(s) already captured under their vendor.")

    finished_at = datetime.now(timezone.utc).isoformat()
    discovery_by_type = {"product": product_disc, "vendor": vendor_disc}
    violations = check_outcomes(discovery_by_type, outcomes)
    if violations:
        print("Run record failed validation -- NOTHING was written:", file=sys.stderr)
        for v in violations:
            print(f"  - {v}", file=sys.stderr)
        raise SystemExit(1)
    run = build_run_record(run_id, started_at, finished_at, discovery_by_type, outcomes)

    counts = outcome_counts(run["outcomes"])
    discovery_complete = {"product": run["discovery"]["product"]["complete"], "vendor": run["discovery"]["vendor"]["complete"]}
    summary = "; ".join(
        f"{pt}: " + ", ".join(f"{status} {n}" for status, n in sorted(counts[pt].items()))
        for pt in ("product", "vendor")
    )
    emit_progress("outcomes", f"Outcomes -- {summary}.", counts=counts, discovery_complete=discovery_complete)

    print(
        f"Retries: {_retry_state['retried']} request(s) needed a retry; "
        f"{_retry_state['exhausted']} exhausted all attempts"
    )
    print("\n--- 5. Saving Results ---")
    published_fields = build_live_document_fields("products", published_out, finished_at, run)
    added_fields = build_live_document_fields("products", added_out, finished_at, run)
    vendors_fields = build_live_document_fields(
        "vendors", [map_vendor_to_directory_record(v) for v in vendors_out], finished_at, run
    )
    write_live_snapshots(client, published_fields, added_fields, vendors_fields)
    print(f"Saved {len(published_out)} records to {COLLECTION}/{DOC_PUBLISHED_LIVE} ({_size_note(published_fields)})")
    print(f"Saved {len(added_out)} records to {COLLECTION}/{DOC_ADDED_LIVE} ({_size_note(added_fields)})")
    print(f"Saved {len(vendors_out)} records to {COLLECTION}/{DOC_VENDORS_LIVE} ({_size_note(vendors_fields)})")

    emit_progress(
        "complete",
        "Process complete",
        published=len(published_out),
        added=len(added_out),
        vendors=len(vendors_out),
    )


# --- 6. Mirror-promote groundwork: discovery completeness + per-URL outcomes ---
# Called by main() (plan step 3b). Docs: docs/mirror-promote-plan-11-02-26.md.
# These implement the plan's run
# record (section 3.9) and decisions D10 (distinct outcomes), D15 (discovery
# completeness) and D22 (protected vendors are "exists, could not check").
# Every function takes an injectable `session` (default: SESSION) so tests can
# pass a fake; every HTTP call carries REQUEST_TIMEOUT_CONNECT_READ.

# (connect, read) seconds for every request made by the functions below.
REQUEST_TIMEOUT_CONNECT_READ = (10, 30)

# --- Retries for transient fetch failures (see the module docstring) ---
# Waits before retries 1, 2 and 3: four attempts in total per GET.
RETRY_DELAYS_SECONDS = (5, 20, 60)
# Upper bound on a server-supplied Retry-After (429/503 only), in seconds.
MAX_RETRY_AFTER_SECONDS = 120
TRANSIENT_STATUSES = frozenset({408, 429, 500, 502, 503, 504})
# main() aborts, writing nothing, after this many consecutive GETs end with
# every attempt failing transiently: the site is treated as down.
MAX_CONSECUTIVE_EXHAUSTED = 5
_TRANSIENT_EXCEPTIONS = (
    requests.exceptions.Timeout,
    requests.exceptions.ConnectionError,
    requests.exceptions.ChunkedEncodingError,
)

# exhausted_streak: consecutive GETs that ended exhausted (reset by any
# non-transient response). retried / exhausted: run statistics, each request
# counted once.
_retry_state = {"exhausted_streak": 0, "retried": 0, "exhausted": 0}


def reset_retry_state() -> None:
    """Zeroes the exhausted streak and the retry statistics (main() and tests)."""
    _retry_state.update(exhausted_streak=0, retried=0, exhausted=0)


def _sleep(seconds: float) -> None:
    """Every retry wait goes through here so tests can patch it."""
    time.sleep(seconds)


def _retry_after_seconds(resp) -> int | None:
    """A Retry-After header holding an integer number of seconds, clamped to
    0..MAX_RETRY_AFTER_SECONDS; None when absent or not an integer (an HTTP
    date is ignored)."""
    raw = resp.headers.get("Retry-After")
    if raw is None:
        return None
    try:
        value = int(str(raw).strip())
    except ValueError:
        return None
    return max(0, min(value, MAX_RETRY_AFTER_SECONDS))


def _get_with_retries(session, url: str, *, timeout=REQUEST_TIMEOUT_CONNECT_READ):
    """session.get(url, timeout=timeout) with bounded retries.

    Transient: a Timeout, ConnectionError or ChunkedEncodingError, or a status
    in TRANSIENT_STATUSES. Those are retried after RETRY_DELAYS_SECONDS (a
    429/503 integer Retry-After replaces the scheduled wait). After the last
    attempt the exception is re-raised, or the last response returned, so each
    call site's existing handling produces exactly the outcome it did before.
    Any other exception propagates at once; any other status (403 and 404
    included) is returned at once. Only GETs come through here -- the unlock
    POST is never retried. Retry lines show the URL path only."""
    total = len(RETRY_DELAYS_SECONDS)
    path = urlsplit(url).path
    counted = False
    for attempt in range(total + 1):
        last = attempt == total
        try:
            resp = session.get(url, timeout=timeout)
        except _TRANSIENT_EXCEPTIONS as e:
            if last:
                _retry_state["exhausted_streak"] += 1
                _retry_state["exhausted"] += 1
                raise
            reason = _request_failure_detail(e)
            delay = RETRY_DELAYS_SECONDS[attempt]
        else:
            if resp.status_code not in TRANSIENT_STATUSES:
                _retry_state["exhausted_streak"] = 0
                return resp
            if last:
                _retry_state["exhausted_streak"] += 1
                _retry_state["exhausted"] += 1
                return resp
            reason = f"HTTP {resp.status_code}"
            delay = RETRY_DELAYS_SECONDS[attempt]
            if resp.status_code in (429, 503):
                retry_after = _retry_after_seconds(resp)
                if retry_after is not None:
                    delay = retry_after
        if not counted:
            _retry_state["retried"] += 1
            counted = True
        print(f"  retry {attempt + 1}/{total} in {delay}s: GET {path} ({reason})", flush=True)
        _sleep(delay)
    raise AssertionError("unreachable: the final attempt always returns or raises")


def _abort_if_site_unreachable() -> None:
    """main()'s circuit breaker, checked after every classified URL: when
    MAX_CONSECUTIVE_EXHAUSTED consecutive GETs have exhausted their retries,
    exit non-zero before anything is written."""
    streak = _retry_state["exhausted_streak"]
    if streak >= MAX_CONSECUTIVE_EXHAUSTED:
        print(
            f"Site appears unreachable: {streak} consecutive requests failed after retries -- NOTHING was written",
            file=sys.stderr,
        )
        raise SystemExit(1)

PRODUCT_STATUSES = frozenset(
    {
        "public_ok",
        "protected_unlocked",
        "password_rejected",
        "no_password",
        "not_tracked",
        "fetch_error",
        "parse_error",
    }
)
VENDOR_STATUSES = frozenset({"public_ok", "protected_vendor", "fetch_error", "parse_error"})


def _request_failure_detail(exc: Exception) -> str:
    """Short, stable diagnostic for a failed request (no URLs, no secrets)."""
    if isinstance(exc, requests.exceptions.Timeout):
        return "timeout"
    if isinstance(exc, requests.exceptions.ConnectionError):
        return "connection error"
    return type(exc).__name__


def _short(text: object, limit: int = 120) -> str:
    s = str(text)
    return s if len(s) <= limit else s[: limit - 3] + "..."


def _has_password_form(page_html: str) -> bool:
    """WordPress's password-protected page test: a form.pw_form is present."""
    return BeautifulSoup(page_html, "html.parser").select_one("form.pw_form") is not None


def discover(post_type: str, session=None) -> dict:
    """REST URL discovery that reports completeness instead of swallowing errors.

    Endpoint resolution: the types endpoint's
    `_links["wp:items"][0]["href"]`, falling back to
    f"{API_BASE}/{post_type}s"), with a timeout and an explicit failure if the
    types request itself fails. Page 1 is requested with per_page=100; its
    X-WP-Total and X-WP-TotalPages headers drive explicit requests for pages
    2..TotalPages (no stopping on an empty page or a non-200 -- those are
    recorded). `complete` is True only if every request returned 200, nothing
    raised, both headers were present and parseable, and discovered ==
    expected_total. Never raises for network/HTTP/header problems.

    Returns {urls, protected, titles, complete, expected_total, discovered,
    error}; titles maps protected URLs to html.unescape(title.rendered)."""
    session = SESSION if session is None else session
    urls: set[str] = set()
    protected: set[str] = set()
    titles: dict[str, str] = {}
    errors: list[str] = []
    expected_total: int | None = None

    def result() -> dict:
        complete = not errors and expected_total is not None and len(urls) == expected_total
        if not errors and expected_total is not None and len(urls) != expected_total:
            errors.append(f"count mismatch: {len(urls)} of {expected_total}")
        return {
            "urls": urls,
            "protected": protected,
            "titles": titles,
            "complete": complete,
            "expected_total": expected_total,
            "discovered": len(urls),
            "error": "; ".join(errors) if errors else None,
        }

    def collect(items: object, page: int) -> None:
        if not isinstance(items, list):
            errors.append(f"page {page}: unexpected response body")
            return
        for item in items:
            if not isinstance(item, dict):
                continue
            link = item.get("link")
            if not link:
                continue
            urls.add(link)
            if "post-password-required" in (item.get("class_list") or []):
                protected.add(link)
                rendered = (item.get("title") or {}).get("rendered")
                if rendered:
                    titles[link] = html_lib.unescape(rendered)

    # Endpoint resolution, with a timeout and an explicit failure.
    try:
        type_resp = _get_with_retries(session, f"{API_BASE}/types/{post_type}")
    except requests.exceptions.RequestException as e:
        errors.append(f"endpoint resolution: {_request_failure_detail(e)}")
        return result()
    if type_resp.status_code != 200:
        errors.append(f"endpoint resolution: HTTP {type_resp.status_code}")
        return result()
    try:
        type_info = type_resp.json()
    except ValueError:
        errors.append("endpoint resolution: invalid JSON")
        return result()
    if isinstance(type_info, dict) and "_links" in type_info and "wp:items" in type_info["_links"]:
        items_url = type_info["_links"]["wp:items"][0]["href"]
    else:
        items_url = f"{API_BASE}/{post_type}s"

    def get_page(page: int):
        try:
            resp = _get_with_retries(session, f"{items_url}?per_page=100&page={page}")
        except requests.exceptions.RequestException as e:
            errors.append(f"{_request_failure_detail(e)} on page {page}")
            return None
        if resp.status_code != 200:
            errors.append(f"page {page}: HTTP {resp.status_code}")
            return None
        return resp

    first = get_page(1)
    if first is None:
        return result()

    total_pages: int | None = None
    raw_total = first.headers.get("X-WP-Total")
    raw_pages = first.headers.get("X-WP-TotalPages")
    if raw_total is None:
        errors.append("missing X-WP-Total")
    else:
        try:
            expected_total = int(raw_total)
        except ValueError:
            errors.append(f"unparseable X-WP-Total: {_short(raw_total, 20)}")
    if raw_pages is None:
        errors.append("missing X-WP-TotalPages")
    else:
        try:
            total_pages = int(raw_pages)
        except ValueError:
            errors.append(f"unparseable X-WP-TotalPages: {_short(raw_pages, 20)}")

    try:
        collect(first.json(), 1)
    except ValueError:
        errors.append("page 1: invalid JSON")

    if total_pages is not None:
        for page in range(2, total_pages + 1):
            resp = get_page(page)
            if resp is None:
                continue
            try:
                collect(resp.json(), page)
            except ValueError:
                errors.append(f"page {page}: invalid JSON")

    return result()


def classify_product(
    url: str,
    *,
    protected_by_rest: bool,
    rest_title: str | None,
    added_entry: dict | None,
    session=None,
) -> dict:
    """One plan-section-3.9 outcome for a product URL (plus `html`).

    Protection is decided from the page itself (form.pw_form);
    `protected_by_rest` only adds a note to `detail` when
    it disagrees with the page. `rest_title` must already be decoded (as
    discover() returns it). `added_entry` is this URL's Added entry
    {product_name, password} -- None when the URL is not tracked in `added`;
    a falsy password means tracked-without-password. password_rejected means
    ONLY that the password form was shown again after a successful unlock
    request; request failures are fetch_error and parse failures are
    parse_error. Cookies are cleared first because WordPress's wp-postpass
    cookie is site-wide: an earlier unlock would otherwise make the next
    protected page look public."""
    session = SESSION if session is None else session

    def outcome(status: str, name: str | None = None, detail: str | None = None, page_html: str | None = None) -> dict:
        return {"url": url, "post_type": "product", "status": status, "name": name, "detail": detail, "html": page_html}

    session.cookies.clear()
    try:
        resp = _get_with_retries(session, url)
    except requests.exceptions.RequestException as e:
        return outcome("fetch_error", detail=_request_failure_detail(e))
    if resp.status_code != 200:
        return outcome("fetch_error", detail=f"HTTP {resp.status_code}")

    page_html = resp.text
    is_protected = _has_password_form(page_html)
    rest_note = None
    if protected_by_rest != is_protected:
        rest_note = f"REST protected flag ({protected_by_rest}) disagrees with page"

    if not is_protected:
        try:
            parsed = parse_public_product(page_html, url)
        except Exception as e:
            return outcome("parse_error", detail=_short(e))
        return outcome("public_ok", name=parsed.get("product_name"), detail=rest_note, page_html=page_html)

    if added_entry is None:
        return outcome("not_tracked", name=rest_title, detail=rest_note)
    password = added_entry.get("password")
    if not password:
        return outcome("no_password", name=added_entry.get("product_name"), detail=rest_note)

    # Unlock: POST the password to postpass, then re-fetch with the resulting cookie.
    try:
        post_resp = session.post(
            POSTPASS_URL,
            data={"post_password": password, "Submit": "Submit"},
            headers={"Referer": url},
            allow_redirects=False,
            timeout=REQUEST_TIMEOUT_CONNECT_READ,
        )
    except requests.exceptions.RequestException as e:
        return outcome("fetch_error", detail=f"unlock request: {_request_failure_detail(e)}")
    # WordPress answers a successful postpass POST with a redirect (302), so
    # only a 4xx/5xx counts as a failed unlock request.
    if post_resp.status_code >= 400:
        return outcome("fetch_error", detail=f"unlock request: HTTP {post_resp.status_code}")
    try:
        unlocked = _get_with_retries(session, url)
    except requests.exceptions.RequestException as e:
        return outcome("fetch_error", detail=f"unlock re-fetch: {_request_failure_detail(e)}")
    if unlocked.status_code != 200:
        return outcome("fetch_error", detail=f"unlock re-fetch: HTTP {unlocked.status_code}")

    unlocked_html = unlocked.text
    if _has_password_form(unlocked_html):
        return outcome("password_rejected", name=added_entry.get("product_name"))
    try:
        parsed = parse_public_product(unlocked_html, url, is_protected=True)
    except Exception as e:
        return outcome("parse_error", name=added_entry.get("product_name"), detail=_short(e))
    return outcome("protected_unlocked", name=parsed.get("product_name"), page_html=unlocked_html)


def classify_vendor(url: str, *, protected_by_rest: bool, session=None) -> dict:
    """One plan-section-3.9 outcome for a vendor URL (plus `html`).

    Protected (by the REST flag or the page's password form) is
    protected_vendor with name None -- never a slug-derived name (D22)."""
    session = SESSION if session is None else session

    def outcome(status: str, name: str | None = None, detail: str | None = None, page_html: str | None = None) -> dict:
        return {"url": url, "post_type": "vendor", "status": status, "name": name, "detail": detail, "html": page_html}

    try:
        resp = _get_with_retries(session, url)
    except requests.exceptions.RequestException as e:
        return outcome("fetch_error", detail=_request_failure_detail(e))
    if resp.status_code != 200:
        return outcome("fetch_error", detail=f"HTTP {resp.status_code}")

    page_html = resp.text
    if protected_by_rest or _has_password_form(page_html):
        return outcome("protected_vendor")
    try:
        parsed = parse_public_vendor(page_html, url)
    except Exception as e:
        return outcome("parse_error", detail=_short(e))
    return outcome("public_ok", name=parsed.get("vendor_name"), page_html=page_html)


def check_outcomes(discovery_by_type: dict, outcomes: list[dict]) -> list[str]:
    """Validates the plan-section-3.9 invariants. Pure; returns violation
    strings (empty list = valid).

    `discovery_by_type` is {"product": discover(...), "vendor": discover(...)}.
    Checks: exactly one outcome per discovered URL (no duplicates, none
    missing, none undiscovered), each outcome's post_type matches the type
    its URL was discovered under, and each status is valid for its post_type."""
    violations: list[str] = []
    allowed = {"product": PRODUCT_STATUSES, "vendor": VENDOR_STATUSES}
    discovered_type: dict[str, str] = {}
    for post_type, disc in discovery_by_type.items():
        for u in disc.get("urls", ()):
            if u in discovered_type and discovered_type[u] != post_type:
                violations.append(f"URL discovered under both {discovered_type[u]} and {post_type}: {u}")
            discovered_type[u] = post_type

    seen: dict[str, int] = {}
    for o in outcomes:
        u, pt, status = o.get("url"), o.get("post_type"), o.get("status")
        seen[u] = seen.get(u, 0) + 1
        if pt not in allowed:
            violations.append(f"unknown post_type {pt!r}: {u}")
            continue
        if status not in allowed[pt]:
            violations.append(f"status {status!r} not valid for {pt}: {u}")
        if u not in discovered_type:
            violations.append(f"outcome for undiscovered URL: {u}")
        elif discovered_type[u] != pt:
            violations.append(f"outcome post_type {pt} but URL discovered as {discovered_type[u]}: {u}")

    for u, n in seen.items():
        if n > 1:
            violations.append(f"duplicate outcome ({n}x): {u}")
    for u in discovered_type:
        if u not in seen:
            violations.append(f"missing outcome: {u}")
    return violations


def build_added_entry(url: str, by_url: dict[str, dict], names_by_url: dict[str, str]) -> dict | None:
    """This URL's Added entry for classify_product(). Pure.

    load_added_passwords() leaves a tracked product with no password OUT of
    by_url (it only appears in names_by_url), so by_url alone would make it
    look untracked. Returns by_url's entry if present; else
    {"product_name", "password": None} for a tracked product; else None."""
    if url in by_url:
        return by_url[url]
    if url in names_by_url:
        return {"product_name": names_by_url[url], "password": None}
    return None


def build_run_record(
    run_id: str, started_at: str, finished_at: str, discovery_by_type: dict, outcomes: list[dict]
) -> dict:
    """The plan-section-3.9 `run` block. Pure.

    Discovery is reduced to {complete, expected_total, discovered, error}
    per post type; each outcome is reduced to exactly {url, post_type,
    status, name, detail} (the classifiers' `html` is dropped)."""

    def reduce_discovery(d: dict) -> dict:
        return {
            "complete": d["complete"],
            "expected_total": d["expected_total"],
            "discovered": d["discovered"],
            "error": d["error"],
        }

    return {
        "run_id": run_id,
        "started_at": started_at,
        "finished_at": finished_at,
        "target": "all",
        "discovery": {
            "product": reduce_discovery(discovery_by_type["product"]),
            "vendor": reduce_discovery(discovery_by_type["vendor"]),
        },
        "outcomes": [
            {"url": o["url"], "post_type": o["post_type"], "status": o["status"], "name": o["name"], "detail": o["detail"]}
            for o in outcomes
        ],
    }


def outcome_counts(outcomes: list[dict]) -> dict[str, dict[str, int]]:
    """{post_type: {status: count}} for the "outcomes" progress milestone. Pure."""
    counts: dict[str, dict[str, int]] = {"product": {}, "vendor": {}}
    for o in outcomes:
        bucket = counts.setdefault(o["post_type"], {})
        bucket[o["status"]] = bucket.get(o["status"], 0) + 1
    return counts


# Firestore's per-field value ceiling for an un-indexed string (the same
# figure lib/server/documents.ts cites). A snapshot over it would fail the
# whole batch, so write_live_snapshots() refuses before committing.
FIRESTORE_MAX_FIELD_BYTES = 1_048_487


def build_live_document_fields(key: str, records: list[dict], finished_at: str, run: dict) -> dict:
    """The Firestore fields for one live snapshot document. Pure apart from
    the SERVER_TIMESTAMP sentinel.

    BYTE AND ETAG CONVENTION, load-bearing (unchanged from the previous
    single-document writer): `bytes` is json.dumps(payload, indent=2,
    ensure_ascii=False) plus a trailing newline -- byte-identical to what
    scripts/nerd_documents.py `push` stores -- and `etag` is SHA-256 over the
    UTF-8 encoding of exactly those bytes, matching nerd_documents.py's
    etag_of() and lib/server/documents.ts's etagOf(). $meta carries
    last_scraped (= the run's finished_at), total_records, generated_by and
    the run record; there is no $meta.missing any more."""
    meta = {
        "last_scraped": finished_at,
        "total_records": len(records),
        "generated_by": "scrape_ncademi_live.py",
        "run": run,
    }
    payload = {
        "$meta": meta,
        key: records,
    }
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    raw = text.encode("utf-8")
    return {
        "bytes": text,
        "etag": hashlib.sha256(raw).hexdigest(),
        "size_bytes": len(raw),
        "updated_at": firestore.SERVER_TIMESTAMP,
        "updated_by": f"scrape_ncademi_live.py:{os.getenv('USER', 'unknown')}",
    }


def write_live_snapshots(client: firestore.Client, published_fields: dict, added_fields: dict, vendors_fields: dict) -> None:
    """Writes all three live snapshots in ONE Firestore batch: either all
    three land or none do (plan D16). The three document keys are named
    explicitly, one per batch.set() -- never computed or iterated (see the
    DOC_* constants' comment, DECISION_LOG.md #66)."""
    for label, fields in (("published-live", published_fields), ("added-live", added_fields), ("vendors-live", vendors_fields)):
        if fields["size_bytes"] > FIRESTORE_MAX_FIELD_BYTES:
            raise RuntimeError(
                f"{label} snapshot is {fields['size_bytes']:,} bytes, over the "
                f"{FIRESTORE_MAX_FIELD_BYTES:,}-byte Firestore field limit; nothing was written."
            )
    batch = client.batch()
    batch.set(client.collection(COLLECTION).document(DOC_PUBLISHED_LIVE), published_fields)
    batch.set(client.collection(COLLECTION).document(DOC_ADDED_LIVE), added_fields)
    batch.set(client.collection(COLLECTION).document(DOC_VENDORS_LIVE), vendors_fields)
    batch.commit()


def _size_note(fields: dict) -> str:
    size = fields["size_bytes"]
    return f"{size:,} bytes, {size / FIRESTORE_MAX_FIELD_BYTES:.1%} of the {FIRESTORE_MAX_FIELD_BYTES:,}-byte limit"


if __name__ == "__main__":
    main()
