"""
api/conversions.py — Bridge between API Pydantic models and nerd_core dataclasses.

The single source of truth for HTML is nerd_core.generators.render_listing_html,
which takes a nerd_core.generators.ListingData *dataclass*. The API speaks
Pydantic. This module is the only place that translation happens, so drift has
exactly one place to be caught.
"""

from __future__ import annotations

from datetime import datetime

from nerd_core import generators as gen
from . import schemas


def pydantic_to_dataclass(payload: schemas.ListingData) -> gen.ListingData:
    """Convert an API ListingData (Pydantic) into a nerd_core ListingData (dataclass).

    last_updated handling:
      - explicit value from client  -> used verbatim
      - None / omitted              -> server fills datetime.now() at render time,
                                       matching the legacy parser (parse_markdown_to_listing
                                       sets datetime.now().strftime('%B %d, %Y'))
    """
    last_updated = payload.last_updated
    if last_updated is None:
        last_updated = datetime.now().strftime("%B %d, %Y")

    return gen.ListingData(
        product_name=payload.product_name,
        vendor_name=payload.vendor_name,
        vendor_directory_url=payload.vendor_directory_url,
        product_description=payload.product_description,
        product_website_url=payload.product_website_url,
        vendor_resources=[gen.ResourceLink(url=r.url, text=r.text) for r in payload.vendor_resources],
        other_resources=[gen.ResourceLink(url=r.url, text=r.text) for r in payload.other_resources],
        ai_insights=payload.ai_insights,
        support_contacts=[
            gen.SupportContact(type=c.type, value=c.value, label=c.label)
            for c in payload.support_contacts
        ],
        acr_reports=[
            gen.ACRReport(
                title=a.title, url=a.url, version=a.version, date=a.date,
                auditor_name=a.auditor_name, auditor_url=a.auditor_url,
            )
            for a in payload.acr_reports
        ],
        last_updated=last_updated,
        html_override=payload.html_override or "",
        last_updated_at=payload.last_updated_at or "",
    )


def dataclass_to_pydantic(listing: gen.ListingData) -> schemas.ListingData:
    """Convert a nerd_core ListingData (dataclass) into an API ListingData (Pydantic).

    Used to package parse_markdown_to_listing() output for the SSE result payload
    so Next.js can hydrate the React Hook Form.
    """
    return schemas.ListingData(
        product_name=listing.product_name,
        vendor_name=listing.vendor_name,
        vendor_directory_url=listing.vendor_directory_url,
        product_description=listing.product_description,
        product_website_url=listing.product_website_url,
        vendor_resources=[schemas.ResourceLink(url=r.url, text=r.text) for r in listing.vendor_resources],
        other_resources=[schemas.ResourceLink(url=r.url, text=r.text) for r in listing.other_resources],
        ai_insights=listing.ai_insights,
        support_contacts=[
            schemas.SupportContact(type=c.type, value=c.value, label=c.label)
            for c in listing.support_contacts
        ],
        acr_reports=[
            schemas.ACRReport(
                title=a.title, url=a.url, version=a.version, date=a.date,
                auditor_name=a.auditor_name, auditor_url=a.auditor_url,
            )
            for a in listing.acr_reports
        ],
        last_updated=listing.last_updated or None,
        html_override=listing.html_override or None,
        last_updated_at=listing.last_updated_at or None,
    )
