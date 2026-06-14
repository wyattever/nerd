import os
import json
import time
import logging
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from datetime import datetime

# Configuration
BASE_URL = "https://ncademi.org/provide/directory/products/"
ARCHIVE_DIR = "ncademi_archive"
RAW_DIR = os.path.join(ARCHIVE_DIR, "raw_html")
CLEAN_DIR = os.path.join(ARCHIVE_DIR, "clean_content")
MANIFEST_PATH = os.path.join(ARCHIVE_DIR, "manifest.json")
ERROR_LOG = "error_log.txt"
DELAY = 10  # Seconds between requests

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(ERROR_LOG),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

def run_check():
    """Verifies and creates the required directory structure."""
    dirs = [ARCHIVE_DIR, RAW_DIR, CLEAN_DIR]
    for d in dirs:
        if not os.path.exists(d):
            os.makedirs(d)
            logger.info(f"Created directory: {d}")
        else:
            logger.info(f"Directory exists: {d}")

def get_slug(url):
    """Extracts a filename-friendly slug from the URL."""
    path = urlparse(url).path
    slug = path.strip("/").split("/")[-1]
    if not slug or slug == "products":
        return "index"
    return slug

def load_manifest():
    """Loads the crawl manifest if it exists."""
    if os.path.exists(MANIFEST_PATH):
        try:
            with open(MANIFEST_PATH, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load manifest: {e}")
    return {"visited": {}, "queue": [BASE_URL]}

def save_manifest(manifest):
    """Saves the current crawl state to the manifest."""
    try:
        with open(MANIFEST_PATH, "w") as f:
            json.dump(manifest, f, indent=4)
    except Exception as e:
        logger.error(f"Failed to save manifest: {e}")

def sanitize_content(html_content):
    """Extracts and sanitizes the content using fallbacks for .entry-content."""
    soup = BeautifulSoup(html_content, "html.parser")
    # Follow the fallback logic from WordPress Integration Best Practices.md
    target = soup.find(class_="entry-content") or soup.find("main") or soup.find("body")
    
    if target:
        # If it's the directory index, we specifically want the entry-content
        # but for product pages, it's often entry-summary or the whole article content.
        # Let's try to be a bit smarter: if it's an article, maybe just get the article content?
        # Actually, let's just stick to the requested fallback chain.
        return target.encode_contents().decode("utf-8").strip()
    return None

def crawl():
    """Main crawl loop with persistence and politeness."""
    run_check()
    manifest = load_manifest()
    
    # Ensure BASE_URL is in queue if manifest was empty
    if not manifest["queue"] and not manifest["visited"]:
        manifest["queue"] = [BASE_URL]

    while manifest["queue"]:
        url = manifest["queue"].pop(0)
        
        if url in manifest["visited"]:
            continue
            
        logger.info(f"Processing: {url}")
        
        try:
            response = requests.get(url, timeout=20, headers={
                "User-Agent": "NCADEMI-Archive-Crawler/1.0 (+https://ncademi.org)"
            })
            
            if response.status_code != 200:
                logger.error(f"HTTP {response.status_code} for {url}")
                manifest["visited"][url] = {"status": response.status_code, "timestamp": str(datetime.now())}
                save_manifest(manifest)
                continue

            html_content = response.text
            slug = get_slug(url)
            filename = f"{slug}.html"
            
            # 1. Save Raw HTML
            raw_path = os.path.join(RAW_DIR, filename)
            with open(raw_path, "w", encoding="utf-8") as f:
                f.write(html_content)
            
            # 2. WordPress Integration Pass (Clean Content)
            clean_html = sanitize_content(html_content)
            if clean_html:
                clean_path = os.path.join(CLEAN_DIR, filename)
                with open(clean_path, "w", encoding="utf-8") as f:
                    f.write(clean_html)
                logger.info(f"Saved clean content for {slug}")
            else:
                logger.warning(f"No .entry-content found for {url}")

            # 3. Discovery (only if we are on a listing or directory page)
            if "/products/" in url:
                soup = BeautifulSoup(html_content, "html.parser")
                for a in soup.find_all("a", href=True):
                    href = a["href"]
                    full_url = urljoin(url, href)
                    
                    # Normalize URL (remove fragments/query params for consistency)
                    full_url = full_url.split("#")[0].split("?")[0]
                    if not full_url.endswith("/"):
                        full_url += "/"

                    # Only stay within the products directory
                    if full_url.startswith(BASE_URL) and full_url not in manifest["visited"] and full_url not in manifest["queue"]:
                        manifest["queue"].append(full_url)

            # Update manifest
            manifest["visited"][url] = {
                "status": 200,
                "filename": filename,
                "timestamp": str(datetime.now())
            }
            save_manifest(manifest)
            
            logger.info(f"Successfully archived {url}")
            
            # Politeness delay
            if manifest["queue"]:
                logger.info(f"Sleeping for {DELAY} seconds...")
                time.sleep(DELAY)

        except Exception as e:
            logger.error(f"Error crawling {url}: {e}", exc_info=True)
            # We don't mark as visited so we can retry on next run if it was a transient error
            # But we should probably save the queue state
            manifest["queue"].insert(0, url) # Re-insert to retry later or just leave for next session
            save_manifest(manifest)
            time.sleep(DELAY) # Still sleep to be safe

    logger.info("Crawl complete!")

if __name__ == "__main__":
    crawl()
