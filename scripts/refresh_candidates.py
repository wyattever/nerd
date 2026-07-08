import sys
import json
import asyncio
from datetime import datetime
from pathlib import Path
from pydantic import TypeAdapter

# Local imports
from nerd_core.services import run_initial_research
from nerd_core.generators import parse_markdown_to_listing
from nerd_core.utils import resolve_and_validate_all
from api.schemas import ListingData

ROOT = Path(".")
CANDIDATES_DIR = ROOT / "NCADEMI_candidates"

def find_file(name_part):
    """Searches for a file in the directory that contains the name_part."""
    matches = list(CANDIDATES_DIR.glob(f"*{name_part}*.json"))
    return matches[0] if matches else None

async def refresh_candidate(name_part):
    path = find_file(name_part)
    if not path:
        print(f"⚠️  File not found matching: {name_part}")
        return

    print(f"🔄 Refreshing {path.name}...")
    with open(path, 'r') as f:
        data = json.load(f)
        url = data.get("product_website_url") or data.get("url")

    if not url:
        print(f"⚠️  No URL found in {path.name}")
        return

    # 1. Run Research
    draft, _ = run_initial_research(url, timeout_min=3)
    
    # 2. Parse
    listing = parse_markdown_to_listing(draft)
    
    # 3. Helper to process a list of ResourceLink objects
    async def process_resources(resources):
        if not resources:
            return []
            
        urls = [r.url for r in resources]
        resolved_map = await resolve_and_validate_all(urls)
        
        updated = []
        for r in resources:
            new_url = resolved_map.get(r.url, r.url)
            if not str(new_url).startswith("ERROR:"):
                r.url = new_url
                updated.append(r)
        return updated

    # 4. Clean/Validate Resources (Async)
    listing.vendor_resources = await process_resources(listing.vendor_resources)
    listing.other_resources = await process_resources(listing.other_resources)
    
    # 5. Prepare data using TypeAdapter for Pydantic V2 compatibility
    # This avoids potential AttributeErrors with model_dump()
    adapter = TypeAdapter(ListingData)
    new_data = adapter.dump_python(listing, mode="json")
    
    new_data['last_updated'] = datetime.now().strftime("%B %d, %Y")
    
    # 6. Overwrite
    with open(path, 'w') as f:
        json.dump(new_data, f, indent=2)
    print(f"✅ {path.name} clean-refreshed.")

async def main(names):
    for name in names:
        await refresh_candidate(name)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Provide candidate name parts: python3 scripts/refresh_candidates.py dreambox")
    else:
        asyncio.run(main(sys.argv[1:]))