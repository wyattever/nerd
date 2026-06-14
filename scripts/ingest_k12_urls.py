
import re
import json
from pathlib import Path

def extract_urls_from_rtf(rtf_path):
    content = Path(rtf_path).read_text(encoding='ascii', errors='ignore')
    # More robust pattern for RTF hyperlinks
    # Find the HYPERLINK and capture the URL
    # Then skip to fldrslt and capture the text until the closing brace
    pattern = r'HYPERLINK "(?P<url>[^"]+)"\}.*?fldrslt\s+(?P<text>.*?)\}\}'
    matches = re.finditer(pattern, content, re.DOTALL)
    
    results = []
    for m in matches:
        url = m.group('url').strip()
        text = m.group('text').strip()
        # Clean up RTF formatting from text
        # RTF commands start with \ and end with a space or another \ or { }
        text = re.sub(r'\\[a-z0-9]+ ?', '', text)
        text = text.replace('{', '').replace('}', '').strip()
        
        # If text is empty or just whitespace after cleanup, use the URL as name
        if not text:
            text = url
            
        results.append({'name': text, 'url': url})
        
    # If no results with the complex regex, try a very simple one for just URLs
    if not results:
        url_pattern = r'HYPERLINK "(?P<url>[^"]+)"'
        matches = re.finditer(url_pattern, content)
        for m in matches:
            url = m.group('url').strip()
            results.append({'name': url, 'url': url})

    return results

def update_eval_data(new_entries):
    eval_data_path = Path('eval/eval_data.json')
    if eval_data_path.exists():
        with open(eval_data_path, 'r') as f:
            data = json.load(f)
    else:
        data = []
    
    existing_urls = {item['input_url'] for item in data}
    
    added_count = 0
    for entry in new_entries:
        if entry['url'] not in existing_urls:
            data.append({
                "product_name": entry['name'],
                "input_url": entry['url'],
                "ground_truth_vendor": [],
                "ground_truth_other": [],
                "metadata": {
                    "vendor_name": entry['name'],
                    "scraped_at": "2026-06-13T14:00:00Z",
                    "source_page": "k-12-URLs.rtf",
                    "difficulty": "unset",
                    "known_failure_mode": ""
                }
            })
            added_count += 1
            existing_urls.add(entry['url'])
            
    with open(eval_data_path, 'w') as f:
        json.dump(data, f, indent=2)
    
    return added_count

if __name__ == "__main__":
    rtf_path = 'k-12-URLs.rtf'
    if not Path(rtf_path).exists():
        print(f"Error: {rtf_path} not found")
    else:
        new_entries = extract_urls_from_rtf(rtf_path)
        count = update_eval_data(new_entries)
        print(f"Extracted {len(new_entries)} URLs. Added {count} new entries to eval_data.json")
