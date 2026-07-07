
import sys
from pathlib import Path

# Add the project root to the Python path
project_root = Path(__file__).resolve().parents[1]
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

try:
    from nerd_core.services import synthesize_insights
except ImportError as e:
    print(f"FATAL: Could not import nerd_core services. CWD: {Path.cwd()}. PYTHONPATH: {sys.path}. Error: {e}", file=sys.stderr)
    sys.exit(1)

def main():
    if len(sys.argv) != 2:
        print("Usage: python .scratch/rerun_synthesis.py <path_to_draft_file>", file=sys.stderr)
        sys.exit(1)

    draft_path = Path(sys.argv[1])
    if not draft_path.is_file():
        print(f"Error: File not found at {draft_path}", file=sys.stderr)
        sys.exit(1)

    draft_content = draft_path.read_text(encoding='utf-8')
    insights = synthesize_insights(draft_markdown=draft_content)
    print(insights)

if __name__ == "__main__":
    main()
