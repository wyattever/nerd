import re
import logging
from google import genai
from google.genai import types
from google.genai.errors import APIError
from jinja2 import Environment, FileSystemLoader
from src.utils import URLMask
from src.telemetry import log_event

logger = logging.getLogger(__name__)

# --- Client (singleton) ---
_client = genai.Client(
    vertexai=True,
    project="edtech-agent-2026",
    location="us-central1",
)

MODEL = "gemini-2.5-flash"

_jinja = Environment(
    loader=FileSystemLoader("prompts/"),
    trim_blocks=True,
    lstrip_blocks=True,
)

_GROUNDING_CONFIG = types.GenerateContentConfig(
    tools=[types.Tool(google_search=types.GoogleSearch())],
    temperature=1.0,
)

class QuotaExhaustedError(Exception):
    """Raised on 429 so the UI layer can handle gracefully."""

# --- Grounding metadata extraction ---
def extract_grounding_urls(response) -> list[str]:
    """Pull the raw redirect URIs from grounding metadata."""
    urls = []
    try:
        # Navigate safely through the response structure
        candidate = response.candidates[0]
        if not hasattr(candidate, "grounding_metadata") or not candidate.grounding_metadata:
            return []
            
        metadata = candidate.grounding_metadata
        chunks = getattr(metadata, "grounding_chunks", []) or []
        
        for chunk in chunks:
            web = getattr(chunk, "web", None)
            if web:
                uri = getattr(web, "uri", None)
                if uri:
                    urls.append(uri)
    except (AttributeError, IndexError) as e:
        logger.warning("Error extracting grounding metadata: %s", e)
    return urls


# --- Phase 1: Initial broad research ---
def run_initial_research(product_url: str, timeout_min: int = 4) -> tuple[str, list[str]]:
    """Return (markdown_draft, raw_redirect_urls)."""
    template = _jinja.get_template("system_prompt.j2")
    prompt = template.render(product_url=product_url)
    
    try:
        response = _client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
                temperature=1.0,
                http_options=types.HttpOptions(timeout=timeout_min * 60 * 1000),
            ),
        )
    except APIError as e:
        if getattr(e, "code", None) == 429:
            raise QuotaExhaustedError("Gemini quota exhausted.") from e
        raise

    raw_urls = extract_grounding_urls(response)
    log_event("generate", product_url, "", response.text)
    return response.text, raw_urls


# --- Phase 2: Deep-dive continuation ---
_URL_RE = re.compile(r'https?://[^\s<>"\')\]]+')

def run_deep_dive(product_url: str, product_name: str, current_draft: str, timeout_min: int = 4) -> tuple[str, list[str]]:
    """Extract known URLs from draft, instruct agent to find NEW ones only."""
    already_known = list(set(_URL_RE.findall(current_draft)))

    template = _jinja.get_template("delta_system_prompt.j2")
    prompt = template.render(
        product_url=product_url,
        product_name=product_name,
        already_known_urls=already_known,
    )
    
    try:
        response = _client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
                temperature=1.0,
                http_options=types.HttpOptions(timeout=timeout_min * 60 * 1000),
            ),
        )
    except APIError as e:
        if getattr(e, "code", None) == 429:
            raise QuotaExhaustedError("Gemini quota exhausted.") from e
        raise

    raw_urls = extract_grounding_urls(response)
    log_event("deep_dive", product_url, current_draft, response.text)
    return response.text, raw_urls


# --- Phase 3: AI Insights synthesis (with URL masking) ---
def synthesize_insights(draft_markdown: str) -> str:
    """Synthesize the AI Generated Insights paragraph with URL masking."""
    masker = URLMask()
    masked = masker.mask(draft_markdown)

    template = _jinja.get_template("synthesis_prompt.j2")
    prompt = template.render(masked_draft=masked)
    
    response = _client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(temperature=0.2),
    )

    audit = masker.audit(response.text)
    if audit["leaked_raw_urls"]:
        logger.error("Model leaked raw URLs during synthesis: %s", audit["leaked_raw_urls"])

    return masker.unmask(response.text, strict=False)
