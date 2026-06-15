#!/usr/bin/env python3
"""
scripts/batch_processor.py — Robust batch research for NCADEMI candidates.

Features:
- Checkpointing: Skips already processed URLs.
- High Fidelity: Initial Research + Deep Dive + AI Synthesis.
- Multi-Artifact Storage: Saves MD, JSON, and WP-ready HTML fragments.
- Error Recovery: Continues processing if a single URL fails.
- Validation: Flags entries with missing key fields.
"""

import os
import sys
import json
import time
import hashlib
import logging
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any

# Path Bootstrap
PROJECT_ROOT = Path(__file__).parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from nerd_core.services import run_initial_research, run_deep_dive, synthesize_insights
from nerd_core.generators import parse_markdown_to_listing, render_listing_html
from jinja2 import Environment, FileSystemLoader

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler("batch_processor.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("nerd.batch")

# Directory Setup
OUTPUT_DIR = PROJECT_ROOT / "NCADEMI_candidates"
TEMPLATES_DIR = PROJECT_ROOT / "templates"
OUTPUT_DIR.mkdir(exist_ok=True)

_jinja = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))

def get_slug(url: str) -> str:
    """Generate a stable, safe filename slug from a URL."""
    clean_url = url.split("?")[0].split("#")[0].strip("/")
    # Hash the URL to ensure uniqueness even if names collide
    url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
    slug = re.sub(r'[^a-z0-9]', '-', clean_url.lower())
    slug = re.sub(r'-+', '-', slug).strip('-')
    # Limit length
    return f"{slug[:50]}-{url_hash}"

import re

def validate_listing(data: Any) -> List[str]:
    """Check for missing or suspicious data in a ListingData object."""
    issues = []
    if not data.product_name or data.product_name == "Unknown Product":
        issues.append("Missing Product Name")
    if not data.vendor_name:
        issues.append("Missing Vendor Name")
    if not data.product_description or len(data.product_description) < 20:
        issues.append("Incomplete or missing description")
    if not data.vendor_resources:
        issues.append("No Vendor Resources found")
    if not data.other_resources:
        issues.append("No Third-Party Resources found")
    if not data.support_contacts:
        issues.append("No Support Contacts found")
    if not data.acr_reports:
        issues.append("No Accessibility Conformance Reports (ACRs) found")
    return issues

def process_url(url: str, force: bool = False):
    """Run the complete research pipeline for a single URL."""
    slug = get_slug(url)
    json_path = OUTPUT_DIR / f"{slug}.json"
    md_path = OUTPUT_DIR / f"{slug}.md"
    html_path = OUTPUT_DIR / f"{slug}.html"

    if json_path.exists() and not force:
        logger.info(f"⏩ Skipping {url} (results exist at {json_path.name})")
        return

    logger.info(f"🔎 Processing: {url}")
    try:
        # 1. Initial Research
        logger.info("  Phase 1: Initial Research...")
        initial_draft, _ = run_initial_research(url, timeout_min=4)
        
        # 2. Deep Dive
        listing = parse_markdown_to_listing(initial_draft)
        logger.info(f"  Phase 2: Deep Dive for {listing.product_name}...")
        deep_dive_draft, _ = run_deep_dive(url, listing.product_name, initial_draft, timeout_min=4)
        
        # 3. AI Insights Synthesis
        logger.info("  Phase 3: Synthesizing Insights...")
        full_markdown = f"{initial_draft}\n\n## Additional Research\n\n{deep_dive_draft}"
        final_insights = synthesize_insights(full_markdown)
        
        # 4. Final Parse & Render
        final_listing = parse_markdown_to_listing(full_markdown)
        final_listing.ai_insights = final_insights
        
        # 5. Save Artifacts
        # Prepare pure ListingData for JSON
        pure_listing = {
            "product_name": final_listing.product_name,
            "vendor_name": final_listing.vendor_name,
            "vendor_directory_url": final_listing.vendor_directory_url,
            "product_description": final_listing.product_description,
            "product_website_url": final_listing.product_website_url,
            "vendor_resources": [asdict(r) for r in final_listing.vendor_resources],
            "other_resources": [asdict(r) for r in final_listing.other_resources],
            "ai_insights": final_listing.ai_insights,
            "support_contacts": [asdict(c) for c in final_listing.support_contacts],
            "acr_reports": [asdict(a) for a in final_listing.acr_reports],
            "last_updated": final_listing.last_updated,
        }

        # JSON (Pure ListingData Artifact)
        with open(json_path, "w") as f:
            json.dump(pure_listing, f, indent=2)

        # Markdown (Audit Trail)
        md_path.write_text(full_markdown)

        # HTML (WP Fragment - needs metadata for some template logic)
        data_dict = {**pure_listing, "url": url, "validation_issues": validate_listing(final_listing)}
        wp_template = _jinja.get_template("ncademi_wp_fragment.html")
        html_fragment = wp_template.render(**data_dict)
        html_path.write_text(html_fragment)

        logger.info(f"✅ Completed {url}")
        
    except Exception as e:
        logger.error(f"❌ Failed to process {url}: {str(e)}")
        # Save an error marker to prevent infinite loops if running in a loop
        error_path = OUTPUT_DIR / f"{slug}.error"
        error_path.write_text(f"URL: {url}\nError: {str(e)}\nTimestamp: {datetime.now()}")

from dataclasses import asdict

def run_batch(input_file: str):
    """Read URLs from file and process them sequentially."""
    input_path = Path(input_file)
    if not input_path.exists():
        logger.error(f"Input file not found: {input_file}")
        return

    urls = [line.strip() for line in input_path.read_text().splitlines() if line.strip()]
    logger.info(f"🚀 Starting batch run for {len(urls)} candidates.")

    for i, url in enumerate(urls):
        logger.info(f"Progress: [{i+1}/{len(urls)}]")
        process_url(url)
        # Polite delay to prevent quota spikes
        time.sleep(5)

    logger.info("🎉 Batch processing complete.")

def generate_summary():
    """Aggregate all results into a single standalone HTML report."""
    logger.info("📊 Generating summary report...")
    candidates = []
    
    for json_file in sorted(OUTPUT_DIR.glob("*.json")):
        with open(json_file, "r") as f:
            data = json.load(f)
            # Read the corresponding HTML fragment
            html_file = json_file.with_suffix(".html")
            if html_file.exists():
                data["html_fragment"] = html_file.read_text()
            else:
                data["html_fragment"] = "HTML Fragment Missing."
            
            candidates.append({
                "name": data.get("product_name", "Unknown"),
                "url": data.get("url", "#"),
                "issues": data.get("validation_issues", []),
                "html_fragment": data["html_fragment"]
            })

    success_count = sum(1 for c in candidates if not c["issues"])
    issue_count = sum(1 for c in candidates if c["issues"])

    report_template = _jinja.get_template("batch_report.html")
    report_html = report_template.render(
        candidates=candidates,
        total_count=len(candidates),
        success_count=success_count,
        issue_count=issue_count,
        generation_date=datetime.now().strftime("%B %d, %Y %I:%M %p")
    )

    summary_path = PROJECT_ROOT / "NCADEMI_candidates_summary.html"
    summary_path.write_text(report_html)
    logger.info(f"✨ Summary report generated at: {summary_path}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="NCADEMI Batch Research Tool")
    parser.add_argument("--input", help="Path to text file containing URLs")
    parser.add_argument("--report-only", action="store_true", help="Just generate the summary report")
    parser.add_argument("--force", action="store_true", help="Reprocess URLs even if results exist")
    
    args = parser.parse_args()

    if args.report_only:
        generate_summary()
    elif args.input:
        run_batch(args.input)
        generate_summary()
    else:
        parser.print_help()
