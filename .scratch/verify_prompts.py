import os
import sys
from pathlib import Path

# Add the project root to the Python path
project_root = Path(__file__).resolve().parents[1]
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

try:
    from nerd_core.services import run_initial_research, synthesize_insights
except ImportError as e:
    print(f"FATAL: Could not import nerd_core services. CWD: {Path.cwd()}. PYTHONPATH: {sys.path}. Error: {e}", file=sys.stderr)
    sys.exit(1)

# --- CONFIGURATION ---
BASE_OUTPUT_DIR = project_root / ".scratch" / "verification"
FIXTURE_DIR = project_root / ".scratch" / "fixtures"
PRODUCTS_TO_TEST = {
    "canvas": "https://www.instructure.com/canvas",
    "sparknotes": "https://www.sparknotes.com/",
    "bookcreator": "https://bookcreator.com/"
}

def get_next_run_path(base_dir, product_name, content_type, extension=".md"):
    """Finds the next available file path to avoid overwriting, e.g., _run1, _run2."""
    run_number = 1
    while True:
        file_path = base_dir / f"phase1_{product_name}_{content_type}_run{run_number}{extension}"
        if not file_path.exists():
            return file_path
        run_number += 1

def run_verification():
    """
    Executes the prompt verification task.
    """
    BASE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)

    print("About to make 7 live API calls (3 initial research, 3 synthesis, 1 synthetic synthesis).")

    markdown_draft_paths = {}

    # --- PART 1: run_initial_research ---
    print("\n--- START PART 1: run_initial_research ---")
    for name, url in PRODUCTS_TO_TEST.items():
        print(f"--- Running initial research for: {name} ---")
        try:
            # Retry once on failure
            try:
                markdown_draft, _ = run_initial_research(product_url=url)
            except Exception:
                print("    -> First attempt failed, retrying once...")
                markdown_draft, _ = run_initial_research(product_url=url)
            
            output_path = get_next_run_path(BASE_OUTPUT_DIR, name, "draft")
            output_path.write_text(markdown_draft, encoding='utf-8')
            markdown_draft_paths[name] = output_path
            print(f"    -> Saved draft to: {output_path.relative_to(project_root)}")
        except Exception as e:
            print(f"    !!! ERROR during initial research for {name}: {e} !!!")
            markdown_draft_paths[name] = None

    # --- PART 2: synthesize_insights ---
    print("\n--- START PART 2: synthesize_insights ---")
    for name, draft_path in markdown_draft_paths.items():
        if not draft_path:
            print(f"--- SKIPPING synthesis for {name} due to research error. ---")
            continue
        print(f"--- Running synthesis for: {name} ---")
        try:
            draft_content = draft_path.read_text(encoding='utf-8')
            insights = synthesize_insights(draft_markdown=draft_content)
            output_path = get_next_run_path(BASE_OUTPUT_DIR, name, "insights")
            output_path.write_text(insights, encoding='utf-8')
            print(f"    -> Saved insights to: {output_path.relative_to(project_root)}")
        except Exception as e:
            print(f"    !!! ERROR during synthesis for {name}: {e} !!!")

    # --- PART 3: Synthetic Thin Draft ---
    print("\n--- START PART 3: Synthetic Thin Draft ---")
    synthetic_draft = '''### Vendor Resources\n\n*   [About Us](https://example.com/about) {confidence: 0.2, why: "page mentions general company info, weak accessibility relevance"}\n\n### Third-Party Insights\n\n'''
    fixture_path = FIXTURE_DIR / "synthetic_thin_draft.md"
    fixture_path.write_text(synthetic_draft, encoding='utf-8')
    print(f"    -> Saved synthetic fixture to: {fixture_path.relative_to(project_root)}")

    try:
        print("--- Running synthesis for: synthetic_thin_draft ---")
        synthetic_insights = synthesize_insights(draft_markdown=synthetic_draft)
        output_path = get_next_run_path(BASE_OUTPUT_DIR, "synthetic_thin", "insights")
        output_path.write_text(synthetic_insights, encoding='utf-8')
        print(f"    -> Saved synthetic insights to: {output_path.relative_to(project_root)}")
    except Exception as e:
        print(f"    !!! ERROR during synthetic synthesis: {e} !!!")

    print("\n--- Verification run complete. ---")

if __name__ == "__main__":
    run_verification()

