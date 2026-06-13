"""
eval/optimize.py — DSPy + GEPA Prompt Optimization Loop for N.E.R.D.
=====================================================================
Periodically tunes the N.E.R.D. research agent's system instructions by
running the GEPA (Generalized Evolutionary Prompt Adaptation) optimizer
against our Golden Dataset.

This is an OFFLINE, manually-triggered job — not a CI gate.
Run it when you want to improve the prompt, then commit the resulting
prompts/optimized_instructions.json if the validation Recall improves.

Usage
-----
  # Light run (~6 candidate prompts — good for a first pass):
  python eval/optimize.py --auto light

  # Heavy run (recommended for real optimization):
  python eval/optimize.py --auto heavy

  # Use all products regardless of difficulty metadata:
  python eval/optimize.py --auto light --no-filter

  # Dry-run: load data and print split sizes, then exit without calling APIs:
  python eval/optimize.py --dry-run

  # Set number of parallel evaluation threads (default 2):
  python eval/optimize.py --auto light --threads 4

Output
------
  prompts/optimized_instructions.json  — full DSPy program state
  prompts/optimized_instructions_diff.txt  — human-readable diff of what changed

⚠️  Critical Architecture Note: Grounding and the LiteLLM Bridge
-----------------------------------------------------------------
DSPy routes all LM calls through LiteLLM. As of mid-2026, LiteLLM
silently drops Google Search Grounding metadata (grounding_chunks,
web_search_queries) when it normalizes Vertex AI responses into the
OpenAI response schema (LiteLLM issue #5659 / ADK issue #5659).

This means the GEPA optimization loop CANNOT score the student model
on its ability to *find* URLs via live grounding — it can only score
the quality of the *formatted Markdown output* the student produces,
using grounding results that were pre-resolved offline.

The two-phase design below handles this explicitly:

  Phase 1 (Offline — src/services.py path):
    The production research pipeline (with real Google Search Grounding)
    runs against the Golden Dataset. Its resolved canonical URLs are
    cached to eval/grounding_cache.json so Phase 2 has ground-truth
    predicted URLs to score against.

  Phase 2 (GEPA loop — DSPy/LiteLLM path):
    GEPA optimizes the FORMATTING and STRUCTURAL instructions — the
    schema compliance, section ordering, link-only mandate, and AI
    Insights synthesis quality — using the pre-resolved URLs from the
    cache as reference answers. This is still highly valuable: the
    most common failure mode observed is not "missed URL" but
    "URL found but placed in wrong section" or "narrative text leaked
    into Vendor Resources."

  The net effect: GEPA improves prompt *structure* quality; Promptfoo
  (provider.py + assertions.py) measures URL *Recall* on the live
  grounding path. Both are necessary; neither alone is sufficient.

Dependencies
------------
  pip install dspy-ai gepa litellm google-genai google-cloud-bigquery
"""

from __future__ import annotations

import argparse
import difflib
import json
import logging
import os
import sys
import textwrap
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import dspy

# ---------------------------------------------------------------------------
# Path bootstrap
# ---------------------------------------------------------------------------
_PROJECT_ROOT = Path(__file__).parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.utils import normalize_url  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
EVAL_DIR          = Path(__file__).parent
GOLDEN_DATASET    = EVAL_DIR / "eval_data.json"
GROUNDING_CACHE   = EVAL_DIR / "grounding_cache.json"
PROMPTS_DIR       = _PROJECT_ROOT / "prompts"
OUTPUT_JSON       = PROMPTS_DIR / "optimized_instructions.json"
OUTPUT_DIFF       = PROMPTS_DIR / "optimized_instructions_diff.txt"

# ---------------------------------------------------------------------------
# GCP configuration (read from environment — never hardcoded)
# ---------------------------------------------------------------------------
GCP_PROJECT  = os.environ.get("GOOGLE_CLOUD_PROJECT",  "edtech-agent-2026")
GCP_LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")

STUDENT_MODEL    = f"vertex_ai/gemini-2.5-flash"
REFLECTION_MODEL = f"vertex_ai/gemini-2.5-pro"


# ===========================================================================
# 1.  DSPy Signature & Module
# ===========================================================================

class AccessibilityResearch(dspy.Signature):
    """Research and compile accessibility documentation for an EdTech product.

    You are an expert accessibility researcher for the NCADEMI EdTech Directory.
    Given a product name and its official website URL, find and format all
    relevant accessibility documentation.

    Output a complete Markdown listing with these exact sections:
    - ### Vendor Resources  (bulleted [Text](URL) links only — no narrative)
    - ### Third-Party Insights  (bulleted [Text](URL) links only — no narrative)
    - ### AI Generated Insights  (one paragraph, max 6 sentences, no citations)

    Focus on: official accessibility statements, VPATs/ACRs, conformance reports,
    help center articles about accessibility features, and third-party reviews
    from sources like webaim.org, deque.com, and institutional (.edu) audits.

    Use the URLs provided in `found_resources` to build the listing.
    """
    product_name: str = dspy.InputField(
        desc="The commercial name of the EdTech product (e.g., 'Adobe Acrobat')"
    )
    product_url: str = dspy.InputField(
        desc="The official product website URL (e.g., 'https://www.adobe.com/acrobat.html')"
    )
    found_resources: str = dspy.InputField(
        desc="Comma-separated list of raw URLs discovered via research to be categorized and formatted."
    )
    known_urls: str = dspy.InputField(
        desc="Comma-separated list of URLs already in the draft (for deep-dive continuation). "
             "Empty string on first pass.",
        default="",
    )
    markdown_listing: str = dspy.OutputField(
        desc="Complete NCADEMI-formatted Markdown listing with all three sections"
    )


class NERDResearchAgent(dspy.Module):
    """
    N.E.R.D. research agent wrapped as a DSPy module for GEPA optimization.

    Uses ChainOfThought so GEPA can inspect the reasoning trace when
    analyzing failures — this gives the reflection_lm more signal than
    a bare Predict call.
    """
    def __init__(self):
        super().__init__()
        self.research = dspy.ChainOfThought(AccessibilityResearch)

    def forward(
        self,
        product_name: str,
        product_url: str,
        found_resources: str = "",
        known_urls: str = "",
    ) -> dspy.Prediction:
        return self.research(
            product_name=product_name,
            product_url=product_url,
            found_resources=found_resources,
            known_urls=known_urls,
        )


# ===========================================================================
# 2.  Dataset loading & metadata filtering
# ===========================================================================

def load_dataset(
    path: Path = GOLDEN_DATASET,
    grounding_cache_path: Path = GROUNDING_CACHE,
    filter_by_difficulty: bool = True,
) -> tuple[list[dspy.Example], list[dspy.Example]]:
    """
    Load eval_data.json and split into train/val sets.

    Filtering strategy (when filter_by_difficulty=True):
      - difficulty == "hard"   → trainset  (more signal for GEPA on hard cases)
      - difficulty == "unset"  → trainset  (treat unknowns as potential hard cases)
      - difficulty == "easy" or "medium" → valset (stable measurement baseline)

    If the golden dataset has no difficulty metadata yet (all "unset"), the
    entire dataset goes into trainset and a 20% holdout is created for val.
    This matches GEPA's convention of maximizing trainset size.

    Also loads grounding_cache.json (if present) to attach pre-resolved
    predicted_urls to each Example — used by the metric for Phase 2 scoring.
    See the architecture note in the module docstring.
    """
    if not path.exists():
        raise FileNotFoundError(
            f"Golden Dataset not found at {path}. "
            "Run: python scraper.py to build it first."
        )

    with open(path) as f:
        raw: list[dict] = json.load(f)

    # Load grounding cache if available
    grounding_cache: dict[str, list[str]] = {}
    if grounding_cache_path.exists():
        with open(grounding_cache_path) as f:
            grounding_cache = json.load(f)
        logger.info("Loaded grounding cache: %d entries", len(grounding_cache))
    else:
        logger.warning(
            "Grounding cache not found at %s. "
            "Run eval/build_grounding_cache.py first for Phase 2 scoring. "
            "Falling back to output-quality-only metric.",
            grounding_cache_path,
        )

    def _to_example(record: dict) -> dspy.Example:
        golden = (
            record.get("ground_truth_vendor", [])
            + record.get("ground_truth_other", [])
        )
        predicted_cached = grounding_cache.get(record["input_url"], [])
        return dspy.Example(
            product_name=record["product_name"],
            product_url=record.get("input_url", ""),
            found_resources=", ".join(predicted_cached),
            known_urls="",
            # Ground truth for the metric
            golden_urls=[normalize_url(u) for u in golden if u],
            # Pre-resolved predictions from the production pipeline (Phase 2)
            cached_predicted_urls=[normalize_url(u) for u in predicted_cached if u],
            # Raw metadata for filtering and debugging
            difficulty=record.get("metadata", {}).get("difficulty", "unset"),
            known_failure_mode=record.get("metadata", {}).get("known_failure_mode", ""),
            product_name_display=record["product_name"],
        ).with_inputs("product_name", "product_url", "found_resources", "known_urls")

    examples = [_to_example(r) for r in raw]

    if not filter_by_difficulty:
        # No split — use all for train, holdout last 20% for val
        split = max(1, int(len(examples) * 0.8))
        train, val = examples[:split], examples[split:]
        logger.info(
            "No difficulty filter — train: %d | val: %d (80/20 split)",
            len(train), len(val),
        )
        return train, val

    # Check if any difficulty metadata has been set
    has_difficulty = any(
        e.difficulty not in ("unset", "") for e in examples
    )

    if not has_difficulty:
        logger.warning(
            "No difficulty metadata found in golden dataset. "
            "All examples have difficulty='unset'. "
            "Using 80/20 split instead of metadata-based filtering. "
            "Tip: After your first eval run, set 'difficulty' in eval_data.json "
            "to 'hard', 'medium', or 'easy' based on observed Recall scores."
        )
        split = max(1, int(len(examples) * 0.8))
        train, val = examples[:split], examples[split:]
    else:
        train = [e for e in examples if e.difficulty in ("hard", "unset")]
        val   = [e for e in examples if e.difficulty in ("easy", "medium")]

        # Ensure val is not empty
        if not val:
            logger.warning(
                "No easy/medium examples found for val set. "
                "Taking last 20%% of trainset as fallback val."
            )
            split = max(1, int(len(train) * 0.8))
            train, val = train[:split], train[split:]

    logger.info(
        "Dataset split — train: %d (hard/unset) | val: %d (easy/medium)",
        len(train), len(val),
    )
    return train, val


# ===========================================================================
# 3.  Metric: URL Recall with textual feedback for GEPA
# ===========================================================================

def url_recall_with_feedback(
    gold: dspy.Example,
    pred: dspy.Prediction,
    trace=None,
    pred_name: Optional[str] = None,
    pred_trace=None,
) -> dspy.Prediction:
    """
    GEPA-compatible metric: returns a Prediction with scalar `score` and
    textual `feedback` explaining exactly which URLs were missed and why.

    Scoring Logic:
    Isolates and scores the model's formatting and structural compliance
    (Did it successfully output the URLs it was handed?) rather than its
    search retrieval accuracy.

    Two scoring modes depending on what's available:

    Mode A — Grounding cache available (Phase 2, recommended):
      Scores the URLs in the parsed Markdown (output_urls) directly against
      the URLs that were injected into the prompt (`gold.cached_predicted_urls`).
      This provides GEPA with positive signal for correctly formatting and
      categorizing the resources it was explicitly given.

    Mode B — No cache (fallback):
      Scores the `markdown_listing` output for structural compliance only:
      - Are the three required headers present?
      - Are the link-only sections actually link-only (no narrative text)?
      - Is the AI Insights section within the 6-sentence limit?

    The textual feedback specifically names what was wrong so the
    reflection_lm can generate targeted instruction improvements.
    """
    import re

    markdown = getattr(pred, "markdown_listing", "") or ""

    # ------------------------------------------------------------------
    # Mode A: Formatting-based scoring (preferred)
    # ------------------------------------------------------------------
    # Use cached_predicted_urls as the target, as these were injected into found_resources
    predicted_set = set(gold.cached_predicted_urls) if gold.cached_predicted_urls else set()

    if predicted_set:
        # Extract URLs from the markdown output
        output_urls = {
            normalize_url(u)
            for u in re.findall(r'https?://[^\s<>"\')\]]+', markdown)
            if u
        }
        
        # Score: how many of the injected URLs made it into the output
        hits   = predicted_set & output_urls
        misses = predicted_set - output_urls
        extras = output_urls - predicted_set

        formatting_recall = len(hits) / len(predicted_set) if predicted_set else 1.0

        feedback_lines = [
            f"Product: {gold.product_name_display}",
            f"Formatting Score: {formatting_recall:.0%} ({len(hits)}/{len(predicted_set)} injected URLs successfully formatted in output)",
        ]
        
        if misses:
            feedback_lines.append(
                f"DROPPED URLs (were provided in 'found_resources' but missing from your output — "
                f"check section placement and link format):\n"
                + "\n".join(f"  - {u}" for u in sorted(misses))
            )

        if extras:
            feedback_lines.append(
                f"HALLUCINATION PENALTY: You included {len(extras)} URLs not provided in the input "
                f"(check for duplicate or fabricated links):\n"
                + "\n".join(f"  - {u}" for u in sorted(extras))
            )
            
        if gold.known_failure_mode:
            feedback_lines.append(
                f"Known failure pattern for this product: {gold.known_failure_mode}"
            )

        # Apply structural compliance penalties
        struct_issues = _check_structure(markdown)
        if struct_issues:
            feedback_lines.append("Structural issues:\n" + "\n".join(f"  - {i}" for i in struct_issues))
        
        # Calculate final score with penalties
        # 10% penalty per structural issue, 5% penalty per hallucinated URL
        final_score = formatting_recall
        final_score -= (len(struct_issues) * 0.1)
        final_score -= (len(extras) * 0.05)
        final_score = max(0.0, final_score)

        return dspy.Prediction(
            score=final_score,
            feedback="\n".join(feedback_lines),
        )

    # ------------------------------------------------------------------
    # Mode B: Structure-only scoring (fallback when no cache)
    # ------------------------------------------------------------------
    struct_issues = _check_structure(markdown)
    n_issues = len(struct_issues)
    # Max 5 structural issues tracked; each costs 0.2 off the score
    score = max(0.0, 1.0 - (n_issues * 0.2))

    feedback_lines = [
        f"Product: {gold.product_name_display}",
        f"Structure score: {score:.0%} ({n_issues} issues found)",
        "(No grounding cache available — scoring structure only)",
    ]
    if struct_issues:
        feedback_lines.append(
            "Structural issues:\n" + "\n".join(f"  - {i}" for i in struct_issues)
        )
    else:
        feedback_lines.append("Output is structurally compliant.")

    return dspy.Prediction(
        score=score,
        feedback="\n".join(feedback_lines),
    )


def _check_structure(markdown: str) -> list[str]:
    """
    Validate NCADEMI Markdown schema compliance.
    Returns a list of human-readable issue descriptions.
    """
    import re

    issues: list[str] = []
    REQUIRED_HEADERS = [
        "### Vendor Resources",
        "### Third-Party Insights",
        "### AI Generated Insights",
    ]
    LINK_ONLY_SECTIONS = ["### Vendor Resources", "### Third-Party Insights"]
    LINK_RE  = re.compile(r'^\s*-\s*\[.+?\]\(https?://[^\)]+\)\s*$')
    URL_RE   = re.compile(r'https?://\S+')

    for header in REQUIRED_HEADERS:
        if header not in markdown:
            issues.append(f"Missing required section: '{header}'")

    lines = markdown.splitlines()
    current_section: Optional[str] = None

    for line in lines:
        stripped = line.strip()
        if stripped in REQUIRED_HEADERS:
            current_section = stripped
            continue
        if stripped.startswith("### ") and stripped not in REQUIRED_HEADERS:
            current_section = None
            continue

        if current_section in LINK_ONLY_SECTIONS:
            if not stripped or stripped.startswith("#"):
                continue
            if stripped.startswith("-") and not LINK_RE.match(line):
                # Bullet without a properly formatted link
                if URL_RE.search(stripped):
                    issues.append(
                        f"Malformed link in '{current_section}': {stripped[:80]}"
                    )
                else:
                    issues.append(
                        f"Narrative text (no URL) in link-only section "
                        f"'{current_section}': {stripped[:80]}"
                    )

    # Check AI Insights sentence count
    insights_match = re.search(
        r'### AI Generated Insights\s*(.*?)(?=\n###|\Z)', markdown, re.DOTALL
    )
    if insights_match:
        insights_text = insights_match.group(1).strip()
        sentences = [s.strip() for s in re.split(r'[.!?]+', insights_text) if s.strip()]
        if len(sentences) > 6:
            issues.append(
                f"AI Generated Insights exceeds 6-sentence limit "
                f"({len(sentences)} sentences found)"
            )
        if re.search(r'\(https?://', insights_text):
            issues.append(
                "AI Generated Insights contains a parenthetical URL citation "
                "(source-stripping mandate violated)"
            )

    return issues


# ===========================================================================
# 4.  Serialization: save program state + human-readable diff
# ===========================================================================

def _extract_instructions(program: NERDResearchAgent) -> dict[str, str]:
    """
    Extract the current signature instructions from all named predictors.
    Returns {predictor_name: instructions_string}.

    DSPy saves these as `signature_instructions` in the JSON state.
    After GEPA optimization, this is what changed.
    """
    instructions: dict[str, str] = {}
    for name, predictor in program.named_predictors():
        instr = getattr(predictor.signature, "instructions", None)
        if instr:
            instructions[name] = instr
    return instructions


def save_optimized_program(
    baseline_program: NERDResearchAgent,
    optimized_program: NERDResearchAgent,
    baseline_score: float,
    optimized_score: float,
    auto_budget: str,
) -> None:
    """
    Save the optimized program state as JSON and write a human-readable diff.
    """
    PROMPTS_DIR.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Save the full DSPy program state
    # ------------------------------------------------------------------
    optimized_program.save(str(OUTPUT_JSON), save_program=False)
    logger.info("Saved optimized program state to %s", OUTPUT_JSON)

    # ------------------------------------------------------------------
    # Extract instructions before/after for the diff
    # ------------------------------------------------------------------
    baseline_instrs  = _extract_instructions(baseline_program)
    optimized_instrs = _extract_instructions(optimized_program)

    # ------------------------------------------------------------------
    # Write the diff file
    # ------------------------------------------------------------------
    diff_lines: list[str] = [
        "=" * 72,
        "N.E.R.D. GEPA Optimization Diff",
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
        f"Budget: auto='{auto_budget}'",
        f"Baseline val Recall:  {baseline_score:.1%}",
        f"Optimized val Recall: {optimized_score:.1%}",
        f"Delta: {optimized_score - baseline_score:+.1%}",
        "=" * 72,
        "",
    ]

    all_predictor_names = sorted(
        set(baseline_instrs.keys()) | set(optimized_instrs.keys())
    )

    for name in all_predictor_names:
        before = baseline_instrs.get(name, "(not present)")
        after  = optimized_instrs.get(name, "(not present)")

        diff_lines.append(f"── Predictor: {name} " + "─" * (50 - len(name)))

        if before == after:
            diff_lines.append("  (no change)")
        else:
            before_lines = textwrap.wrap(before, width=68) or [before]
            after_lines  = textwrap.wrap(after,  width=68) or [after]

            diff = list(difflib.unified_diff(
                before_lines,
                after_lines,
                fromfile=f"{name} [baseline]",
                tofile=f"{name} [optimized]",
                lineterm="",
            ))
            diff_lines.extend(diff if diff else ["  (instructions identical)"])

        diff_lines.append("")

    diff_text = "\n".join(diff_lines)
    OUTPUT_DIFF.write_text(diff_text, encoding="utf-8")

    # Also print to stdout for CI log visibility
    print("\n" + diff_text)
    logger.info("Saved diff to %s", OUTPUT_DIFF)


# ===========================================================================
# 5.  Evaluation helper: score a program on the val set
# ===========================================================================

def evaluate_program(
    program: NERDResearchAgent,
    examples: list[dspy.Example],
    label: str = "eval",
) -> float:
    """Run the DSPy Evaluate harness and return mean score."""
    evaluator = dspy.Evaluate(
        devset=examples,
        metric=url_recall_with_feedback,
        num_threads=1,           # serial for eval to avoid quota issues
        display_progress=True,
        display_table=False,
    )
    result = evaluator(program)
    score = result.score
    logger.info("%s mean score: %.1f%%", label, score)
    return float(score) / 100.0


# ===========================================================================
# 6.  Main optimization loop
# ===========================================================================

def run_optimization(
    auto: str = "light",
    num_threads: int = 2,
    filter_by_difficulty: bool = True,
    dry_run: bool = False,
) -> None:
    """
    Full GEPA optimization pipeline:
      1. Configure DSPy LMs (student + reflection)
      2. Load and split the Golden Dataset
      3. Score the baseline program
      4. Run GEPA to produce an optimized program
      5. Score the optimized program on val
      6. Save if improved; warn and skip if regressed
    """

    # ------------------------------------------------------------------
    # Configure student LM (Gemini 2.5 Flash via LiteLLM→Vertex)
    # Note: grounding is NOT available through this path — see module docstring.
    # temperature=1.0 recommended by DSPy for optimization runs.
    # ------------------------------------------------------------------
    student_lm = dspy.LM(
        model=STUDENT_MODEL,
        temperature=1.0,
        max_tokens=4096,
        vertex_project=GCP_PROJECT,
        vertex_location=GCP_LOCATION,
        cache=False,  # disable caching during optimization so GEPA sees real variance
    )
    dspy.configure(lm=student_lm)

    # ------------------------------------------------------------------
    # Configure reflection LM (Gemini 2.5 Pro)
    # Called only a handful of times — cost is negligible.
    # High max_tokens because GEPA's reflection generates long rationales.
    # ------------------------------------------------------------------
    reflection_lm = dspy.LM(
        model=REFLECTION_MODEL,
        temperature=1.0,
        max_tokens=32000,
        vertex_project=GCP_PROJECT,
        vertex_location=GCP_LOCATION,
        cache=False,
    )

    # ------------------------------------------------------------------
    # Load dataset
    # ------------------------------------------------------------------
    train_set, val_set = load_dataset(filter_by_difficulty=filter_by_difficulty)

    logger.info(
        "Running GEPA optimization | budget=%s | threads=%d | "
        "train=%d | val=%d",
        auto, num_threads, len(train_set), len(val_set),
    )

    if dry_run:
        logger.info("--dry-run: exiting before API calls.")
        _print_dataset_preview(train_set, val_set)
        return

    # ------------------------------------------------------------------
    # Instantiate the baseline program
    # ------------------------------------------------------------------
    baseline_program = NERDResearchAgent()

    # ------------------------------------------------------------------
    # Score the baseline so we have a comparison point
    # ------------------------------------------------------------------
    logger.info("Scoring baseline program on val set...")
    baseline_score = evaluate_program(baseline_program, val_set, label="baseline")

    # ------------------------------------------------------------------
    # Configure GEPA
    #
    # Key parameters for N.E.R.D.:
    #   auto="light"  → ~10 candidate prompts (fast, good for first run)
    #   auto="heavy"  → full exploration (use for production optimization)
    #   num_threads   → cap at 2–4 to respect Vertex grounding quota
    #   max_metric_calls → override default budget for faster iteration
    # ------------------------------------------------------------------
    max_metric_calls = 30 if auto == "light" else (100 if auto == "medium" else 300)
    
    optimizer = dspy.GEPA(
        metric=url_recall_with_feedback,
        reflection_lm=reflection_lm,
        max_metric_calls=max_metric_calls,
        num_threads=num_threads,
        reflection_minibatch_size=3,
        track_stats=True,
        use_merge=False,
    )

    # ------------------------------------------------------------------
    # Run optimization
    # ------------------------------------------------------------------
    logger.info("Starting GEPA compile (this may take several minutes)...")
    optimized_program = optimizer.compile(
        baseline_program,
        trainset=train_set,
        valset=val_set,
    )

    # ------------------------------------------------------------------
    # Score optimized program
    # ------------------------------------------------------------------
    logger.info("Scoring optimized program on val set...")
    optimized_score = evaluate_program(optimized_program, val_set, label="optimized")

    # ------------------------------------------------------------------
    # Regression gate: only save if improved or within noise margin
    # ------------------------------------------------------------------
    NOISE_MARGIN = 0.02   # ignore deltas smaller than 2% (LLM variance)
    delta = optimized_score - baseline_score

    if delta < -NOISE_MARGIN:
        logger.warning(
            "GEPA produced a REGRESSION: %.1f%% → %.1f%% (delta: %+.1f%%). "
            "NOT saving. Check the diff for over-fitted instructions.",
            baseline_score * 100, optimized_score * 100, delta * 100,
        )
        # Still write the diff so you can inspect what changed
        save_optimized_program(
            baseline_program, optimized_program,
            baseline_score, optimized_score, auto,
        )
        logger.info(
            "Diff written for inspection. To apply anyway: "
            "mv %s %s", OUTPUT_DIFF, OUTPUT_JSON
        )
        sys.exit(1)

    save_optimized_program(
        baseline_program, optimized_program,
        baseline_score, optimized_score, auto,
    )

    if delta < NOISE_MARGIN:
        logger.info(
            "Improvement delta %.1f%% is within noise margin — "
            "saved but consider running with auto='heavy' for more signal.",
            delta * 100,
        )
    else:
        logger.info(
            "✓ Optimization improved val score by %+.1f%% "
            "(%.1f%% → %.1f%%)",
            delta * 100, baseline_score * 100, optimized_score * 100,
        )


def _print_dataset_preview(
    train: list[dspy.Example],
    val: list[dspy.Example],
) -> None:
    print("\n── Train Set ────────────────────────────────────")
    for e in train:
        print(
            f"  [{e.difficulty:6s}] {e.product_name_display} "
            f"| golden: {len(e.golden_urls)} "
            f"| cached_predicted: {len(e.cached_predicted_urls)}"
        )
    print(f"\n── Val Set ──────────────────────────────────────")
    for e in val:
        print(
            f"  [{e.difficulty:6s}] {e.product_name_display} "
            f"| golden: {len(e.golden_urls)} "
            f"| cached_predicted: {len(e.cached_predicted_urls)}"
        )
    print()


# ===========================================================================
# 7.  CLI entry point
# ===========================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run the DSPy + GEPA optimization loop for N.E.R.D.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""
        Examples:
          python eval/optimize.py --auto light
          python eval/optimize.py --auto heavy --threads 3
          python eval/optimize.py --dry-run
          python eval/optimize.py --auto light --no-filter
        """),
    )
    parser.add_argument(
        "--auto",
        choices=["light", "medium", "heavy"],
        default="light",
        help=(
            "GEPA budget: 'light'=~6 candidates (fast), "
            "'medium'=~12, 'heavy'=full exploration (recommended for production). "
            "Default: light"
        ),
    )
    parser.add_argument(
        "--threads",
        type=int,
        default=2,
        metavar="N",
        help=(
            "Number of parallel evaluation threads. Keep at 2–4 to respect "
            "Vertex grounding rate limits. Free tier: 1–2. Tier 1: 3–4. "
            "Default: 2"
        ),
    )
    parser.add_argument(
        "--no-filter",
        action="store_true",
        help="Ignore difficulty metadata; use 80/20 split instead.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print dataset split preview and exit without calling any API.",
    )

    args = parser.parse_args()

    run_optimization(
        auto=args.auto,
        num_threads=args.threads,
        filter_by_difficulty=not args.no_filter,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
