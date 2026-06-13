"""
eval/assertions.py — Custom URL Recall Assertion for Promptfoo
==============================================================
Computes URL Recall against the Golden Dataset.
"""

from __future__ import annotations

import sys
import os
import re
from typing import Any

# ---------------------------------------------------------------------------
# Path bootstrap
# ---------------------------------------------------------------------------
_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from src.utils import normalize_url  # noqa: E402


def _build_golden_set(vars_: dict) -> set[str]:
    """Merge ground_truth_vendor and ground_truth_other into one normalized set."""
    vendor = vars_.get("ground_truth_vendor", []) or []
    other  = vars_.get("ground_truth_other",  []) or []

    if isinstance(vendor, str):
        vendor = [u.strip() for u in vendor.split(",") if u.strip()]
    if isinstance(other, str):
        other = [u.strip() for u in other.split(",") if u.strip()]

    golden: set[str] = set()
    for url in vendor + other:
        normalized = normalize_url(url)
        if normalized:
            golden.add(normalized)
    return golden


def _build_predicted_set(output: str) -> set[str]:
    """Parse the newline-separated URL list from provider.py output."""
    predicted: set[str] = set()
    for line in output.splitlines():
        url = line.strip()
        if not url:
            continue
        normalized = normalize_url(url)
        if normalized:
            predicted.add(normalized)
    return predicted


def get_assert(output: str, context: dict[str, Any]) -> dict[str, Any]:
    """
    Compute URL Recall and return a Promptfoo GradingResult.
    """
    vars_: dict = context.get("vars", {})
    product_name: str = vars_.get("product_name", vars_.get("product_url", "Unknown"))
    threshold: float = float(vars_.get("recall_threshold", 0.70))

    if not output or not output.strip():
        return {
            "pass":   False,
            "score":  0.0,
            "reason": (
                f"[{product_name}] Provider returned empty output. "
                "Check for QUOTA_EXHAUSTED or PROVIDER_ERROR in the run log."
            ),
        }

    golden    = _build_golden_set(vars_)
    predicted = _build_predicted_set(output)

    if not golden:
        return {
            "pass":   True,
            "score":  1.0,
            "reason": (
                f"[{product_name}] No golden URLs defined. "
                "Add ground_truth_vendor / ground_truth_other to the test case."
            ),
        }

    hits:   set[str] = golden & predicted
    misses: set[str] = golden - predicted
    extras: set[str] = predicted - golden

    recall: float = len(hits) / len(golden)
    passed: bool  = recall >= threshold

    lines: list[str] = [
        f"[{product_name}] Recall: {recall:.0%} "
        f"({len(hits)}/{len(golden)} golden URLs found) | "
        f"Threshold: {threshold:.0%} | "
        f"{'PASS ✓' if passed else 'FAIL ✗'}",
    ]

    if hits:
        lines.append(f"\n  ✓ FOUND ({len(hits)}):")
        for u in sorted(hits):
            lines.append(f"      {u}")

    if misses:
        lines.append(f"\n  ✗ MISSED ({len(misses)}) — these drove the recall penalty:")
        for u in sorted(misses):
            lines.append(f"      {u}")

    if extras:
        lines.append(
            f"\n  ~ EXTRA ({len(extras)}) — retrieved but not in golden set "
            "(not penalised; review for possible golden set additions):"
        )
        for u in sorted(extras):
            lines.append(f"      {u}")

    return {
        "pass":   passed,
        "score":  round(recall, 4),
        "reason": "\n".join(lines),
    }
