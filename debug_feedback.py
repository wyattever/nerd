import re

def analyze_changes(old_md, new_md):
    # Extract links using the same regex as app.py
    link_pattern = r'https?://[^\)\s]+'
    old_links = set(re.findall(link_pattern, old_md))
    new_links = set(re.findall(link_pattern, new_md))
    
    added = len(new_links - old_links)
    removed = len(old_links - new_links)
    
    # Logic from app.py
    if added > 0 and removed > 0:
        return f"{added} new source(s) added; {removed} removed as requested."
    elif added > 0:
        return f"{added} new source(s) added."
    elif removed > 0:
        return f"Source(s) removed as requested."
    else:
        return "No new sources found; draft updated with provided details."

# Test Scenario: Remove all links except two
OLD_MD = """
- [Link 1](https://a.com)
- [Link 2](https://b.com)
- [Accessibility](https://seesaw.com/a11y)
- [Differentiated Learning](https://seesaw.com/diff)
"""

NEW_MD = """
- [Accessibility](https://seesaw.com/a11y)
- [Differentiated Learning](https://seesaw.com/diff)
"""

print("--- ANALYZING CHANGES ---")
old_links_count = len(re.findall(r'https?://[^\)\s]+', OLD_MD))
new_links_count = len(re.findall(r'https?://[^\)\s]+', NEW_MD))
print("Old Links Count: " + str(old_links_count))
print("New Links Count: " + str(new_links_count))

response = analyze_changes(OLD_MD, NEW_MD)
print("Resulting Response: " + str(response))

# Check if an empty result or different pattern causes issues
if not response:
    print("❌ ERROR: Response was empty!")
else:
    print("✅ SUCCESS: Response generated correctly.")
