# fix_appsheet_candidate_vendor.py
#
# Run from repo root: python3 fix_appsheet_candidate_vendor.py
#
# 1. "global" table: any row whose Vendor cell (nerd-col-aprod-vendor)
#    equals exactly "CANDIDATE" -> vendor cell becomes "NULL", and that
#    row's Status cell (nerd-col-aprod-status) becomes "Candidate".
# 2. "vendors" table: any row whose Vendor Name cell (nerd-col-vend-name)
#    equals exactly "CANDIDATE" -> that cell becomes "NULL".
#
# Operates directly on frontend/lib/appsheet-tables.json's embedded HTML
# strings. Prints a change count per table and re-validates the file as
# JSON before writing, so a partial/bad edit never gets saved.

import json
import re
import sys

PATH = "frontend/lib/appsheet-tables.json"

def get_cell_text(row_html, col_class):
    m = re.search(rf'<td class="{col_class}"[^>]*>(.*?)</td>', row_html, re.DOTALL)
    return m.group(1).strip() if m else None

def set_cell_text(row_html, col_class, new_text):
    return re.sub(
        rf'(<td class="{col_class}"[^>]*>)(.*?)(</td>)',
        lambda m: f"{m.group(1)}{new_text}{m.group(3)}",
        row_html,
        count=1,
        flags=re.DOTALL,
    )

def fix_global_table(html):
    body_match = re.search(r"(<tbody>)(.*?)(</tbody>)", html, re.DOTALL)
    if not body_match:
        print("ERROR: could not find <tbody> in global table -- aborting.")
        sys.exit(1)

    body = body_match.group(2)
    rows = re.findall(r"<tr>.*?</tr>", body, re.DOTALL)

    changed = 0
    new_rows = []
    for row in rows:
        vendor = get_cell_text(row, "nerd-col-aprod-vendor")
        if vendor == "CANDIDATE":
            row = set_cell_text(row, "nerd-col-aprod-vendor", "NULL")
            row = set_cell_text(row, "nerd-col-aprod-status", "Candidate")
            changed += 1
        new_rows.append(row)

    new_body = "".join(new_rows)
    new_html = html[: body_match.start(2)] + new_body + html[body_match.end(2) :]
    return new_html, changed

def fix_vendors_table(html):
    body_match = re.search(r"(<tbody>)(.*?)(</tbody>)", html, re.DOTALL)
    if not body_match:
        print("ERROR: could not find <tbody> in vendors table -- aborting.")
        sys.exit(1)

    body = body_match.group(2)
    rows = re.findall(r"<tr>.*?</tr>", body, re.DOTALL)

    changed = 0
    new_rows = []
    for row in rows:
        name = get_cell_text(row, "nerd-col-vend-name")
        if name == "CANDIDATE":
            row = set_cell_text(row, "nerd-col-vend-name", "NULL")
            changed += 1
        new_rows.append(row)

    new_body = "".join(new_rows)
    new_html = html[: body_match.start(2)] + new_body + html[body_match.end(2) :]
    return new_html, changed

def main():
    with open(PATH, "r", encoding="utf-8") as f:
        raw = f.read()

    data = json.loads(raw)  # fail loudly if the file isn't valid JSON to start with

    global_table = next((t for t in data["tables"] if t["slug"] == "global"), None)
    vendors_table = next((t for t in data["tables"] if t["slug"] == "vendors"), None)

    if global_table is None:
        print("ERROR: 'global' table not found in appsheet-tables.json -- aborting.")
        sys.exit(1)
    if vendors_table is None:
        print("ERROR: 'vendors' table not found in appsheet-tables.json -- aborting.")
        sys.exit(1)

    global_table["html"], global_changed = fix_global_table(global_table["html"])
    vendors_table["html"], vendors_changed = fix_vendors_table(vendors_table["html"])

    print(f"global table: {global_changed} row(s) updated (vendor CANDIDATE -> NULL, status -> Candidate)")
    print(f"vendors table: {vendors_changed} row(s) updated (vendor name CANDIDATE -> NULL)")

    # Re-validate before writing -- catches any regex mishap immediately
    # rather than saving a corrupted file.
    new_raw = json.dumps(data, ensure_ascii=False, indent=2)
    try:
        json.loads(new_raw)
    except json.JSONDecodeError as e:
        print(f"ERROR: output failed JSON re-validation, not writing file. {e}")
        sys.exit(1)

    with open(PATH, "w", encoding="utf-8") as f:
        f.write(new_raw)

    print(f"Wrote {PATH}")

if __name__ == "__main__":
    main()