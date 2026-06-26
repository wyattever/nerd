import json
import os
from pathlib import Path

def run_inventory():
    """
    Scans all candidate JSON files and reports on data quality issues
    as defined in DECISION_LOG.md (Decision 16).
    """
    candidates_dir = Path(__file__).parent.parent.parent / "NCADEMI_candidates"
    if not candidates_dir.is_dir():
        print("ERROR: Directory not found: ")
        print(candidates_dir)
        return

    report = {
        "total_files_scanned": 0,
        "files_with_empty_acr_fields": set(),
        "files_with_misfiled_auditor": set(),
        "files_with_placeholder_vendor_url": set(),
        "files_with_duplicate_support_email": set()
    }

    misfiled_auditor_keyword = "webaim"

    for file_path in sorted(candidates_dir.glob("*.json")):
        if "e2e-test-candidate" in file_path.name or "test-product-29" in file_path.name:
            continue

        report["total_files_scanned"] += 1
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except json.JSONDecodeError:
            print(f"WARNING: Could not decode JSON from {file_path.name}")
            continue

        listing_data = data.get("listing_data", {})

        if listing_data.get("vendor_directory_url") == "#":
            report["files_with_placeholder_vendor_url"].add(file_path.name)

        acr_reports = listing_data.get("acr_reports", [])
        if acr_reports:
            for acr in acr_reports:
                if not (acr.get("version") or acr.get("date") or acr.get("auditor_name")):
                    report["files_with_empty_acr_fields"].add(file_path.name)
                    break

        other_resources = listing_data.get("other_resources", [])
        for resource in other_resources:
            text = resource.get("text", "").lower()
            if misfiled_auditor_keyword in text:
                report["files_with_misfiled_auditor"].add(file_path.name)
                break
        
        support_contacts = listing_data.get("support_contacts", [])
        if support_contacts:
            support_emails = {c.get("value") for c in support_contacts if c.get("type") == "email"}
            for resource in other_resources:
                text = resource.get("text", "").lower()
                for email in support_emails:
                    if email and email.lower() in text:
                        report["files_with_duplicate_support_email"].add(file_path.name)
                        break
                if file_path.name in report["files_with_duplicate_support_email"]:
                    break

    print("---")
    print("Candidate Inventory Report")
    print("---")
    print(f"Total .json files scanned: {report['total_files_scanned']}")

    print("")
    print(f"{len(report['files_with_placeholder_vendor_url'])} files with placeholder vendor URL ('#'):")
    for fname in sorted(list(report['files_with_placeholder_vendor_url'])):
        print(f"  - {fname}")

    print("")
    print(f"{len(report['files_with_empty_acr_fields'])} files with one or more empty ACR sub-fields (version/date/auditor):")
    for fname in sorted(list(report['files_with_empty_acr_fields'])):
        print(f"  - {fname}")

    print("")
    print(f"{len(report['files_with_misfiled_auditor'])} files with a potential misfiled auditor ('{misfiled_auditor_keyword}'):")
    for fname in sorted(list(report['files_with_misfiled_auditor'])):
        print(f"  - {fname}")

    print("")
    print(f"{len(report['files_with_duplicate_support_email'])} files with a potential duplicate support email:")
    for fname in sorted(list(report['files_with_duplicate_support_email'])):
        print(f"  - {fname}")

if __name__ == "__main__":
    run_inventory()