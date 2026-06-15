import json
from pathlib import Path

REQUIRED_FIELDS = {
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

def validate():
    candidates_dir = Path("NCADEMI_candidates")
    json_files = list(candidates_dir.glob("*.json"))
    errors = 0
    
    print(f"Validating {len(json_files)} files...")
    
    for json_file in json_files:
        try:
            with open(json_file, "r") as f:
                data = json.load(f)
            
            found_fields = set(data.keys())
            
            # 1. Check for missing fields
            missing = REQUIRED_FIELDS - found_fields
            if missing:
                print(f"❌ {json_file.name}: Missing fields: {missing}")
                errors += 1
                continue
            
            # 2. Check for extra fields
            extra = found_fields - REQUIRED_FIELDS
            if extra:
                print(f"❌ {json_file.name}: Unexpected fields: {extra}")
                errors += 1
                continue
                
            # 3. Basic type check for lists (most critical for injection)
            list_fields = ["vendor_resources", "other_resources", "support_contacts", "acr_reports"]
            for field in list_fields:
                if not isinstance(data.get(field), list):
                    print(f"❌ {json_file.name}: Field '{field}' is not a list")
                    errors += 1
                    break
            
        except Exception as e:
            print(f"❌ {json_file.name}: Critical failure: {e}")
            errors += 1

    if errors == 0:
        print("✅ All files are bit-compatible with ListingData.")
    else:
        print(f"⚠️ Validation failed with {errors} errors.")

if __name__ == "__main__":
    validate()
