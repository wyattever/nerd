import json
import re
import shutil
from pathlib import Path

VENDORS_FILE = Path("frontend/lib/vendors.json")
BACKUP_FILE = Path("frontend/lib/vendors.json.bak")

def slugify(text: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')

def migrate():
    if not VENDORS_FILE.exists():
        print(f"Error: {VENDORS_FILE} not found.")
        return

    # Create backup
    shutil.copy(VENDORS_FILE, BACKUP_FILE)
    print(f"Backed up original vendors to {BACKUP_FILE.name}")

    with open(VENDORS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    vendors = data.get("vendors", [])
    migrated_vendors = []

    for v in vendors:
        # Split single resources array into vendor_resources and other_resources
        raw_resources = v.get("resources", [])
        vendor_resources = []
        other_resources = []
        for res in raw_resources:
            mapped_res = {"text": res.get("title", ""), "url": res.get("url", "")}
            if res.get("source") == "Vendor":
                vendor_resources.append(mapped_res)
            else:
                other_resources.append(mapped_res)

        # Map support contacts (fixing the contact_type bug)
        support_contacts = []
        for sc in v.get("support_contacts", []):
            contact_type = sc.get("type", sc.get("contact_type", "")).lower()
            if contact_type not in ["email", "url"]:
                contact_type = "url" 
            support_contacts.append({
                "type": contact_type,
                "value": sc.get("value", ""),
                "label": sc.get("title", None)
            })

        migrated = {
            "kind": "vendor",  # Explicit discriminant
            "slug": slugify(v.get("vendor_name", "unknown")),
            "product_name": v.get("vendor_name", ""),
            "vendor_name": v.get("vendor_name", ""),
            "vendor_directory_url": v.get("vendor_directory_url", None),
            "product_website_url": v.get("vendor_website_url", None),
            "product_description": v.get("notes", None),
            "vendor_resources": vendor_resources,
            "other_resources": other_resources,
            "support_contacts": support_contacts,
            "acr_reports": [],
            "products": v.get("products", []),
            "last_updated": v.get("last_updated", None),
            "ai_insights": None,
            "tracking_status": v.get("tracking_status", None)
        }
        migrated_vendors.append(migrated)

    data["vendors"] = migrated_vendors

    with open(VENDORS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    
    print(f"Successfully migrated {len(migrated_vendors)} vendors to the unified schema with kind: vendor.")

if __name__ == "__main__":
    migrate()
