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
