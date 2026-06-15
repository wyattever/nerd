import json
from pathlib import Path

# Define the fields required by the frontend ListingData interface
ALLOWED_FIELDS = {
    "product_name",
    "vendor_name",
    "vendor_directory_url",
    "product_description",
    "product_website_url",
    "vendor_resources",
    "other_resources",
    "ai_insights",
    "support_contacts",
    "acr_reports",
    "last_updated"
}

def migrate():
    candidates_dir = Path("NCADEMI_candidates")
    json_files = list(candidates_dir.glob("*.json"))
    
    print(f"Found {len(json_files)} candidates to migrate.")
    
    for json_file in json_files:
        try:
            with open(json_file, "r") as f:
                data = json.load(f)
            
            # Create a clean version with ONLY allowed fields
            clean_data = {k: v for k, v in data.items() if k in ALLOWED_FIELDS}
            
            with open(json_file, "w") as f:
                json.dump(clean_data, f, indent=2)
            
            print(f"✅ Migrated {json_file.name}")
        except Exception as e:
            print(f"❌ Failed to migrate {json_file.name}: {e}")

if __name__ == "__main__":
    migrate()
