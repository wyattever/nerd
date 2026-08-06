from api import schemas
from api.conversions import pydantic_to_dataclass, dataclass_to_pydantic

def test_section_overrides_round_trip():
    payload = schemas.ListingData(
        product_name="Test Product",
        section_overrides=schemas.SectionOverrides(
            support="<p>Custom support HTML</p>",
            acr="<div>Custom ACR block</div>",
        ),
    )
    dc = pydantic_to_dataclass(payload)
    assert dc.section_overrides == {
        "support": "<p>Custom support HTML</p>",
        "acr": "<div>Custom ACR block</div>",
    }
    back = dataclass_to_pydantic(dc)
    assert back.section_overrides is not None
    assert back.section_overrides.support == "<p>Custom support HTML</p>"
    assert back.section_overrides.acr == "<div>Custom ACR block</div>"
    assert back.section_overrides.header is None
    assert back.section_overrides.vendor_resources is None
    assert back.section_overrides.other_resources is None

def test_section_overrides_absent_round_trip():
    payload = schemas.ListingData(product_name="Test Product")
    dc = pydantic_to_dataclass(payload)
    assert dc.section_overrides == {}
    back = dataclass_to_pydantic(dc)
    assert back.section_overrides is None

def test_confidence_and_justification_round_trip():
    """F8 regression guard: both converter directions must preserve
    confidence and justification, not just url/text. See
    nerd-import-data-architecture-v4.md §4.3."""
    payload = schemas.ListingData(
        product_name="Test Product",
        vendor_resources=[
            schemas.ResourceLink(url="https://v.com/a", text="A", confidence=0.99, justification="Found on footer"),
        ],
        other_resources=[
            schemas.ResourceLink(url="https://o.com/b", text="B", confidence=0.95, justification="Third-party review"),
        ],
    )
    dc = pydantic_to_dataclass(payload)
    assert dc.vendor_resources[0].confidence == 0.99
    assert dc.vendor_resources[0].justification == "Found on footer"
    assert dc.other_resources[0].confidence == 0.95
    assert dc.other_resources[0].justification == "Third-party review"

    back = dataclass_to_pydantic(dc)
    assert back.vendor_resources[0].confidence == 0.99
    assert back.vendor_resources[0].justification == "Found on footer"
    assert back.other_resources[0].confidence == 0.95
    assert back.other_resources[0].justification == "Third-party review"


def test_confidence_defaults_when_absent():
    """Resources with no confidence annotation must round-trip at the
    documented defaults (0.0 / ""), not error or silently coerce."""
    payload = schemas.ListingData(
        product_name="Test Product",
        vendor_resources=[schemas.ResourceLink(url="https://v.com/a", text="A")],
    )
    dc = pydantic_to_dataclass(payload)
    assert dc.vendor_resources[0].confidence == 0.0
    assert dc.vendor_resources[0].justification == ""
    back = dataclass_to_pydantic(dc)
    assert back.vendor_resources[0].confidence == 0.0
    assert back.vendor_resources[0].justification == ""
