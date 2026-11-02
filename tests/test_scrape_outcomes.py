"""Tests for the mirror-promote groundwork in scripts/scrape_ncademi_live.py:
discover(), classify_product(), classify_vendor() and check_outcomes().

No network: every HTTP interaction goes through FakeSession below, which maps
a URL to a canned FakeResponse or raises a requests exception.
"""

from __future__ import annotations

import pytest
import requests

import scripts.scrape_ncademi_live as m

ITEMS = "https://example.test/wp-json/wp/v2/product"
TYPES = f"{m.API_BASE}/types/product"
PAGE = "https://ncademi.org/provide/directory/products/alpha/"
VENDOR_PAGE = "https://ncademi.org/provide/directory/vendors/acme/"

PUBLIC_PRODUCT_HTML = (
    "<html><body><article class='nc-single-product'><h1>Alpha Math</h1>"
    "<div class='entry-content'><p class='mb-2'>Vendor: Acme</p><p>Desc</p></div>"
    "</article></body></html>"
)
PASSWORD_FORM_HTML = (
    "<html><body><h1>Protected: Alpha Math</h1>"
    "<form class='pw_form' method='post'><input name='post_password'></form></body></html>"
)
UNLOCKED_PRODUCT_HTML = (
    "<html><body><article class='nc-single-product'><h1>Protected: Kate’s Math Lessons</h1>"
    "<div class='entry-content'><p>Desc</p></div></article></body></html>"
)
UNPARSEABLE_HTML = "<html><body><p>no product article here</p></body></html>"
PUBLIC_VENDOR_HTML = "<html><body><h1>Acme Learning</h1></body></html>"


class FakeResponse:
    def __init__(self, status_code=200, text="", json_body=None, headers=None):
        self.status_code = status_code
        self.text = text
        self._json = json_body
        self.headers = headers or {}

    def json(self):
        if self._json is None:
            raise ValueError("no json")
        return self._json


class FakeCookies:
    def __init__(self):
        self.cleared = 0

    def clear(self):
        self.cleared += 1


class FakeSession:
    """routes: {url: FakeResponse | Exception | [sequence of those]}; a list is
    consumed one item per call (for a URL fetched twice, e.g. before/after unlock)."""

    def __init__(self, get_routes=None, post_routes=None):
        self.get_routes = dict(get_routes or {})
        self.post_routes = dict(post_routes or {})
        self.cookies = FakeCookies()
        self.get_calls: list[tuple[str, object]] = []
        self.post_calls: list[tuple[str, dict]] = []

    @staticmethod
    def _resolve(routes, url):
        if url not in routes:
            raise AssertionError(f"unexpected request: {url}")
        r = routes[url]
        if isinstance(r, list):
            r = r.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    def get(self, url, timeout=None, **kwargs):
        self.get_calls.append((url, timeout))
        return self._resolve(self.get_routes, url)

    def post(self, url, timeout=None, **kwargs):
        self.post_calls.append((url, {"timeout": timeout, **kwargs}))
        return self._resolve(self.post_routes, url)


def types_ok():
    return FakeResponse(200, json_body={"_links": {"wp:items": [{"href": ITEMS}]}})


def page_url(n):
    return f"{ITEMS}?per_page=100&page={n}"


def item(link, protected=False, title=None):
    d = {"link": link, "class_list": ["post-password-required"] if protected else []}
    if title is not None:
        d["title"] = {"rendered": title}
    return d


# --- discover ---------------------------------------------------------------


def test_discover_one_page_complete():
    s = FakeSession({
        TYPES: types_ok(),
        page_url(1): FakeResponse(200, json_body=[item("u1"), item("u2")], headers={"X-WP-Total": "2", "X-WP-TotalPages": "1"}),
    })
    r = m.discover("product", session=s)
    assert r["complete"] is True
    assert r["urls"] == {"u1", "u2"}
    assert r["expected_total"] == 2 and r["discovered"] == 2 and r["error"] is None
    assert all(t == m.REQUEST_TIMEOUT_CONNECT_READ for _, t in s.get_calls)


def test_discover_two_pages_complete():
    s = FakeSession({
        TYPES: types_ok(),
        page_url(1): FakeResponse(200, json_body=[item("u1")], headers={"X-WP-Total": "2", "X-WP-TotalPages": "2"}),
        page_url(2): FakeResponse(200, json_body=[item("u2")]),
    })
    r = m.discover("product", session=s)
    assert r["complete"] is True and r["urls"] == {"u1", "u2"}


def test_discover_page2_503_incomplete_keeps_page1():
    s = FakeSession({
        TYPES: types_ok(),
        page_url(1): FakeResponse(200, json_body=[item("u1")], headers={"X-WP-Total": "2", "X-WP-TotalPages": "2"}),
        page_url(2): FakeResponse(503),
    })
    r = m.discover("product", session=s)
    assert r["complete"] is False
    assert "page 2: HTTP 503" in r["error"]
    assert r["urls"] == {"u1"}


def test_discover_timeout_page1_incomplete():
    s = FakeSession({TYPES: types_ok(), page_url(1): requests.exceptions.ReadTimeout("slow")})
    r = m.discover("product", session=s)
    assert r["complete"] is False
    assert r["error"] == "timeout on page 1"
    assert r["urls"] == set() and r["expected_total"] is None


def test_discover_missing_total_header_incomplete():
    s = FakeSession({
        TYPES: types_ok(),
        page_url(1): FakeResponse(200, json_body=[item("u1")], headers={"X-WP-TotalPages": "1"}),
    })
    r = m.discover("product", session=s)
    assert r["complete"] is False and "missing X-WP-Total" in r["error"]


def test_discover_count_mismatch_incomplete():
    s = FakeSession({
        TYPES: types_ok(),
        page_url(1): FakeResponse(200, json_body=[item("u1"), item("u2")], headers={"X-WP-Total": "3", "X-WP-TotalPages": "1"}),
    })
    r = m.discover("product", session=s)
    assert r["complete"] is False and r["error"] == "count mismatch: 2 of 3"


def test_discover_protected_and_entity_title():
    s = FakeSession({
        TYPES: types_ok(),
        page_url(1): FakeResponse(
            200,
            json_body=[item("p1", protected=True, title="Kate&#8217;s Math Lessons"), item("u2", title="Public")],
            headers={"X-WP-Total": "2", "X-WP-TotalPages": "1"},
        ),
    })
    r = m.discover("product", session=s)
    assert r["protected"] == {"p1"}
    assert r["titles"] == {"p1": "Kate’s Math Lessons"}
    assert r["complete"] is True


def test_discover_endpoint_fallback_when_no_links():
    s = FakeSession({
        TYPES: FakeResponse(200, json_body={}),
        f"{m.API_BASE}/products?per_page=100&page=1": FakeResponse(200, json_body=[], headers={"X-WP-Total": "0", "X-WP-TotalPages": "0"}),
    })
    r = m.discover("product", session=s)
    assert r["complete"] is True and r["discovered"] == 0


# --- classify_product ---------------------------------------------------------


def classify(session, *, protected_by_rest=False, rest_title=None, added_entry=None):
    return m.classify_product(PAGE, protected_by_rest=protected_by_rest, rest_title=rest_title, added_entry=added_entry, session=session)


def test_product_fetch_error_timeout():
    o = classify(FakeSession({PAGE: requests.exceptions.ConnectTimeout("x")}))
    assert (o["status"], o["detail"]) == ("fetch_error", "timeout")


def test_product_fetch_error_500():
    o = classify(FakeSession({PAGE: FakeResponse(500)}))
    assert (o["status"], o["detail"]) == ("fetch_error", "HTTP 500")


def test_product_public_ok():
    s = FakeSession({PAGE: FakeResponse(200, text=PUBLIC_PRODUCT_HTML)})
    o = classify(s)
    assert o["status"] == "public_ok" and o["name"] == "Alpha Math"
    assert o["html"] == PUBLIC_PRODUCT_HTML and o["post_type"] == "product" and o["url"] == PAGE
    assert s.cookies.cleared == 1


def test_product_public_parse_error():
    o = classify(FakeSession({PAGE: FakeResponse(200, text=UNPARSEABLE_HTML)}))
    assert o["status"] == "parse_error" and "article" in o["detail"] and o["html"] is None


def test_product_not_tracked_with_title():
    o = classify(FakeSession({PAGE: FakeResponse(200, text=PASSWORD_FORM_HTML)}), protected_by_rest=True, rest_title="Kate’s Math Lessons")
    assert (o["status"], o["name"]) == ("not_tracked", "Kate’s Math Lessons")


def test_product_not_tracked_without_title():
    o = classify(FakeSession({PAGE: FakeResponse(200, text=PASSWORD_FORM_HTML)}), protected_by_rest=True)
    assert (o["status"], o["name"]) == ("not_tracked", None)


@pytest.mark.parametrize("password", [None, ""])
def test_product_no_password(password):
    s = FakeSession({PAGE: FakeResponse(200, text=PASSWORD_FORM_HTML)})
    o = classify(s, protected_by_rest=True, added_entry={"product_name": "Alpha Math", "password": password})
    assert (o["status"], o["name"]) == ("no_password", "Alpha Math")
    assert s.post_calls == []


def test_product_no_password_key_absent():
    o = classify(FakeSession({PAGE: FakeResponse(200, text=PASSWORD_FORM_HTML)}), protected_by_rest=True, added_entry={"product_name": "Alpha Math"})
    assert o["status"] == "no_password"


ENTRY = {"product_name": "Alpha Math", "password": "fixture-value"}


def test_product_fetch_error_during_unlock_post():
    s = FakeSession({PAGE: FakeResponse(200, text=PASSWORD_FORM_HTML)}, {m.POSTPASS_URL: requests.exceptions.ConnectionError("down")})
    o = classify(s, protected_by_rest=True, added_entry=ENTRY)
    assert (o["status"], o["detail"]) == ("fetch_error", "unlock request: connection error")


def test_product_fetch_error_unlock_post_http_500():
    s = FakeSession({PAGE: FakeResponse(200, text=PASSWORD_FORM_HTML)}, {m.POSTPASS_URL: FakeResponse(500)})
    o = classify(s, protected_by_rest=True, added_entry=ENTRY)
    assert (o["status"], o["detail"]) == ("fetch_error", "unlock request: HTTP 500")


def test_product_fetch_error_on_unlock_refetch():
    s = FakeSession(
        {PAGE: [FakeResponse(200, text=PASSWORD_FORM_HTML), requests.exceptions.ReadTimeout("slow")]},
        {m.POSTPASS_URL: FakeResponse(302)},
    )
    o = classify(s, protected_by_rest=True, added_entry=ENTRY)
    assert (o["status"], o["detail"]) == ("fetch_error", "unlock re-fetch: timeout")


def test_product_password_rejected():
    s = FakeSession(
        {PAGE: [FakeResponse(200, text=PASSWORD_FORM_HTML), FakeResponse(200, text=PASSWORD_FORM_HTML)]},
        {m.POSTPASS_URL: FakeResponse(302)},
    )
    o = classify(s, protected_by_rest=True, added_entry=ENTRY)
    assert (o["status"], o["name"]) == ("password_rejected", "Alpha Math")
    url, kwargs = s.post_calls[0]
    assert url == m.POSTPASS_URL and kwargs["data"]["post_password"] == "fixture-value"
    assert kwargs["allow_redirects"] is False and kwargs["timeout"] == m.REQUEST_TIMEOUT_CONNECT_READ


def test_product_protected_unlocked():
    s = FakeSession(
        {PAGE: [FakeResponse(200, text=PASSWORD_FORM_HTML), FakeResponse(200, text=UNLOCKED_PRODUCT_HTML)]},
        {m.POSTPASS_URL: FakeResponse(302)},
    )
    o = classify(s, protected_by_rest=True, added_entry=ENTRY)
    assert (o["status"], o["name"]) == ("protected_unlocked", "Kate’s Math Lessons")
    assert o["html"] == UNLOCKED_PRODUCT_HTML and o["detail"] is None


def test_product_parse_error_after_unlock():
    s = FakeSession(
        {PAGE: [FakeResponse(200, text=PASSWORD_FORM_HTML), FakeResponse(200, text=UNPARSEABLE_HTML)]},
        {m.POSTPASS_URL: FakeResponse(302)},
    )
    o = classify(s, protected_by_rest=True, added_entry=ENTRY)
    assert o["status"] == "parse_error" and o["name"] == "Alpha Math"


def test_product_rest_flag_disagreement_noted():
    o = classify(FakeSession({PAGE: FakeResponse(200, text=PUBLIC_PRODUCT_HTML)}), protected_by_rest=True)
    assert o["status"] == "public_ok" and "disagrees" in o["detail"]


# --- classify_vendor ----------------------------------------------------------


def test_vendor_fetch_error():
    o = m.classify_vendor(VENDOR_PAGE, protected_by_rest=False, session=FakeSession({VENDOR_PAGE: FakeResponse(404)}))
    assert (o["status"], o["detail"]) == ("fetch_error", "HTTP 404")


@pytest.mark.parametrize("by_rest,page", [(True, PUBLIC_VENDOR_HTML), (False, PASSWORD_FORM_HTML)])
def test_vendor_protected_name_is_none(by_rest, page):
    o = m.classify_vendor(VENDOR_PAGE, protected_by_rest=by_rest, session=FakeSession({VENDOR_PAGE: FakeResponse(200, text=page)}))
    assert o["status"] == "protected_vendor" and o["name"] is None and o["html"] is None


def test_vendor_public_ok():
    o = m.classify_vendor(VENDOR_PAGE, protected_by_rest=False, session=FakeSession({VENDOR_PAGE: FakeResponse(200, text=PUBLIC_VENDOR_HTML)}))
    assert (o["status"], o["name"], o["post_type"]) == ("public_ok", "Acme Learning", "vendor")


def test_vendor_parse_error(monkeypatch):
    # parse_public_vendor guards every lookup and does not raise on arbitrary
    # HTML, so a parser failure is simulated.
    def boom(html, url):
        raise ValueError("vendor markup changed")

    monkeypatch.setattr(m, "parse_public_vendor", boom)
    o = m.classify_vendor(VENDOR_PAGE, protected_by_rest=False, session=FakeSession({VENDOR_PAGE: FakeResponse(200, text=PUBLIC_VENDOR_HTML)}))
    assert (o["status"], o["detail"]) == ("parse_error", "vendor markup changed")


# --- check_outcomes -----------------------------------------------------------

DISC = {"product": {"urls": {"p1", "p2"}}, "vendor": {"urls": {"v1"}}}


def oc(url, post_type, status):
    return {"url": url, "post_type": post_type, "status": status, "name": None, "detail": None}


def test_check_outcomes_valid():
    assert m.check_outcomes(DISC, [oc("p1", "product", "public_ok"), oc("p2", "product", "not_tracked"), oc("v1", "vendor", "protected_vendor")]) == []


def test_check_outcomes_duplicate_url():
    v = m.check_outcomes(DISC, [oc("p1", "product", "public_ok"), oc("p1", "product", "public_ok"), oc("p2", "product", "public_ok"), oc("v1", "vendor", "public_ok")])
    assert any("duplicate outcome" in x and "p1" in x for x in v)


def test_check_outcomes_missing_url():
    v = m.check_outcomes(DISC, [oc("p1", "product", "public_ok"), oc("v1", "vendor", "public_ok")])
    assert v == ["missing outcome: p2"]


def test_check_outcomes_vendor_status_on_product():
    v = m.check_outcomes(DISC, [oc("p1", "product", "protected_vendor"), oc("p2", "product", "public_ok"), oc("v1", "vendor", "public_ok")])
    assert v == ["status 'protected_vendor' not valid for product: p1"]


def test_check_outcomes_product_status_on_vendor():
    v = m.check_outcomes(DISC, [oc("p1", "product", "public_ok"), oc("p2", "product", "public_ok"), oc("v1", "vendor", "password_rejected")])
    assert v == ["status 'password_rejected' not valid for vendor: v1"]
