import logging
import os
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from google.cloud import bigquery

# --- Local File Logging ---
LOG_FILE = Path(__file__).parent.parent / "nerd_debug.log"

logger = logging.getLogger("nerd")
logger.setLevel(logging.DEBUG)

try:
    file_handler = logging.FileHandler(LOG_FILE)
    file_handler.setFormatter(logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    ))
    logger.addHandler(file_handler)
except OSError:
    logging.getLogger(__name__).warning(
        "File logging disabled (read-only filesystem): %s", LOG_FILE
    )

PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "edtech-agent-2026")
_TABLE = f"{PROJECT_ID}.telemetry.feedback_logs"

try:
    _BQ = bigquery.Client()
except Exception:
    _BQ = None
    logger.warning("BigQuery client unavailable — telemetry disabled.")


def log_event(
    event_type: str,
    product_url: str,
    original_markdown: str,
    refined_markdown: str,
    user_feedback: str = "",
    error_code: Optional[str] = None,
) -> None:
    """Fire-and-forget telemetry. Never raises — cannot crash the app."""
    if _BQ is None:
        return
    row = {
        "timestamp":         datetime.now(timezone.utc).isoformat(),
        "event_type":        event_type,
        "product_url":       product_url,
        "original_markdown": original_markdown[:50_000],
        "user_feedback":     user_feedback,
        "refined_markdown":  refined_markdown[:50_000],
        "error_code":        error_code,
    }
    try:
        errors = _BQ.insert_rows_json(_TABLE, [row])
        if errors:
            logger.warning("BigQuery insert error: %s", errors)
    except Exception as e:
        logger.warning("BigQuery insert failed silently: %s", e)