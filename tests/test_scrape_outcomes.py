"""Tests for the mirror-promote groundwork in scripts/scrape_ncademi_live.py:
discover(), classify_product(), classify_vendor() and check_outcomes().

No network: every HTTP interaction goes through FakeSession below, which maps
a URL to a canned FakeResponse or raises a requests exception.
"""

from __future__ import annotations

import argparse
import hashlib
import json

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


@pytest.fixture(autouse=True)
def retry_delays(monkeypatch):
    """Records every retry wait instead of sleeping, and starts each test with
    a zero exhausted streak and zero retry statistics."""
    delays: list[float] = []
    monkeypatch.setattr(m, "_sleep", delays.append)
    m.reset_retry_state()
    return delays


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
        # The re-fetch is retried, so every one of its four attempts times out.
        {PAGE: [FakeResponse(200, text=PASSWORD_FORM_HTML)] + [requests.exceptions.ReadTimeout("slow") for _ in range(4)]},
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


# --- build_added_entry --------------------------------------------------------

BY_URL = {"u-pw": {"product_name": "With Password", "password": "fixture-value"}}
NAMES_BY_URL = {"u-pw": "With Password", "u-nopw": "No Password"}


def test_build_added_entry_tracked_with_password():
    assert m.build_added_entry("u-pw", BY_URL, NAMES_BY_URL) == {"product_name": "With Password", "password": "fixture-value"}


def test_build_added_entry_tracked_without_password():
    assert m.build_added_entry("u-nopw", BY_URL, NAMES_BY_URL) == {"product_name": "No Password", "password": None}


def test_build_added_entry_untracked():
    assert m.build_added_entry("u-other", BY_URL, NAMES_BY_URL) is None


# --- build_run_record ---------------------------------------------------------


def disc_full(urls, protected=(), complete=True, error=None):
    return {"urls": set(urls), "protected": set(protected), "titles": {}, "complete": complete,
            "expected_total": len(urls), "discovered": len(urls), "error": error}


def test_build_run_record_shape():
    outcomes = [
        {"url": "p1", "post_type": "product", "status": "public_ok", "name": "P", "detail": None, "html": "<html/>"},
        {"url": "v1", "post_type": "vendor", "status": "protected_vendor", "name": None, "detail": None, "html": None},
    ]
    run = m.build_run_record("rid", "t0", "t1", {"product": disc_full(["p1"]), "vendor": disc_full(["v1"], complete=False, error="x")}, outcomes)
    assert set(run) == {"run_id", "started_at", "finished_at", "target", "discovery", "outcomes"}
    assert run["target"] == "all" and run["run_id"] == "rid"
    assert set(run["discovery"]) == {"product", "vendor"}
    for d in run["discovery"].values():
        assert set(d) == {"complete", "expected_total", "discovered", "error"}
    assert run["discovery"]["vendor"] == {"complete": False, "expected_total": 1, "discovered": 1, "error": "x"}
    assert all(set(o) == {"url", "post_type", "status", "name", "detail"} for o in run["outcomes"])
    assert "html" not in json.dumps(run)


def test_build_live_document_fields_byte_and_etag_convention():
    run = m.build_run_record("rid", "t0", "t1", {"product": disc_full([]), "vendor": disc_full([])}, [])
    f = m.build_live_document_fields("products", [{"a": "é"}], "t1", run)
    assert f["bytes"].endswith("\n") and "é" in f["bytes"]
    assert f["etag"] == hashlib.sha256(f["bytes"].encode("utf-8")).hexdigest()
    assert f["size_bytes"] == len(f["bytes"].encode("utf-8"))
    body = json.loads(f["bytes"])
    assert list(body["$meta"]) == ["last_scraped", "total_records", "generated_by", "run"]
    assert body["$meta"]["total_records"] == 1 and "missing" not in body["$meta"]


# --- main(), fully offline ----------------------------------------------------

P_PUB = "https://ncademi.org/provide/directory/products/alpha/"
P_PROT = "https://ncademi.org/provide/directory/products/kates/"
V_PUB = "https://ncademi.org/provide/directory/vendors/acme/"
V_PROT = "https://ncademi.org/provide/directory/vendors/locked/"


class FakeRef:
    def __init__(self, path):
        self.path = path

    def set(self, *args, **kwargs):
        raise AssertionError(f"direct (non-batch) write to {self.path}")


class FakeCollection:
    def __init__(self, name):
        self.name = name

    def document(self, key):
        return FakeRef(f"{self.name}/{key}")


class FakeBatch:
    def __init__(self, client):
        self.client = client
        self.sets = []

    def set(self, ref, data):
        self.sets.append((ref.path, data))

    def commit(self):
        self.client.commits.append(list(self.sets))


class FakeClient:
    def __init__(self):
        self.commits = []

    def collection(self, name):
        return FakeCollection(name)

    def batch(self):
        return FakeBatch(self)


def run_main(monkeypatch, product_status_override=None):
    monkeypatch.setenv("FIRESTORE_EMULATOR_HOST", "fake-emulator:1")
    monkeypatch.setattr(m, "parse_args", lambda: argparse.Namespace(prod=False))
    client = FakeClient()
    monkeypatch.setattr(m, "firestore_client", lambda: client)
    monkeypatch.setattr(m, "load_added_passwords", lambda c: ({P_PROT: {"product_name": "Kate’s Math Lessons", "password": "fixture-value"}}, {P_PROT: "Kate’s Math Lessons"}))
    monkeypatch.setattr(m, "PAGE_FETCH_DELAY_SECONDS", 0)
    discs = {"product": disc_full([P_PUB, P_PROT], protected=[P_PROT]), "vendor": disc_full([V_PUB, V_PROT], protected=[V_PROT])}
    monkeypatch.setattr(m, "discover", lambda post_type, session=None: discs[post_type])

    def fake_classify_product(url, *, protected_by_rest, rest_title, added_entry, session=None):
        if product_status_override:
            return {"url": url, "post_type": "product", "status": product_status_override, "name": None, "detail": None, "html": None}
        if url == P_PUB:
            return {"url": url, "post_type": "product", "status": "public_ok", "name": "Alpha Math", "detail": None, "html": PUBLIC_PRODUCT_HTML}
        assert protected_by_rest and added_entry["password"] == "fixture-value"
        return {"url": url, "post_type": "product", "status": "protected_unlocked", "name": "Kate’s Math Lessons", "detail": None, "html": UNLOCKED_PRODUCT_HTML}

    def fake_classify_vendor(url, *, protected_by_rest, session=None):
        if protected_by_rest:
            return {"url": url, "post_type": "vendor", "status": "protected_vendor", "name": None, "detail": None, "html": None}
        return {"url": url, "post_type": "vendor", "status": "public_ok", "name": "Acme Learning", "detail": None, "html": PUBLIC_VENDOR_HTML}

    monkeypatch.setattr(m, "classify_product", fake_classify_product)
    monkeypatch.setattr(m, "classify_vendor", fake_classify_vendor)
    return client


def test_main_writes_one_batch_with_identical_run_records(monkeypatch):
    client = run_main(monkeypatch)
    m.main()
    assert len(client.commits) == 1
    sets = client.commits[0]
    assert [path for path, _ in sets] == ["nerd_documents/published-live", "nerd_documents/added-live", "nerd_documents/vendors-live"]
    bodies = {path: json.loads(data["bytes"]) for path, data in sets}
    runs = [json.dumps(b["$meta"]["run"], sort_keys=True) for b in bodies.values()]
    assert runs[0] == runs[1] == runs[2]
    for b in bodies.values():
        assert "missing" not in b["$meta"]
        assert set(b["$meta"]) == {"last_scraped", "total_records", "generated_by", "run"}
        assert b["$meta"]["last_scraped"] == b["$meta"]["run"]["finished_at"]
    pub = bodies["nerd_documents/published-live"]["products"]
    added = bodies["nerd_documents/added-live"]["products"]
    vendors = bodies["nerd_documents/vendors-live"]["vendors"]
    assert [r["product_name"] for r in pub] == ["Alpha Math"] and pub[0]["is_protected"] is False
    assert [r["product_name"] for r in added] == ["Kate’s Math Lessons"] and added[0]["is_protected"] is True
    # protected_vendor produces no vendors-live record (D22)
    assert [v["vendor_directory_url"] for v in vendors] == [V_PUB]
    run = bodies["nerd_documents/vendors-live"]["$meta"]["run"]
    assert len(run["outcomes"]) == 4
    assert {(o["url"], o["status"]) for o in run["outcomes"]} == {
        (P_PUB, "public_ok"), (P_PROT, "protected_unlocked"), (V_PUB, "public_ok"), (V_PROT, "protected_vendor")}
    for _, data in sets:
        assert set(data) == {"bytes", "etag", "size_bytes", "updated_at", "updated_by"}
        assert data["etag"] == hashlib.sha256(data["bytes"].encode("utf-8")).hexdigest()


def test_main_violation_writes_nothing_and_exits_nonzero(monkeypatch, capsys):
    client = run_main(monkeypatch, product_status_override="protected_vendor")
    with pytest.raises(SystemExit) as exc:
        m.main()
    assert exc.value.code == 1
    assert client.commits == []
    assert "NOTHING was written" in capsys.readouterr().err


# --- retries for transient fetch failures ---------------------------------------
# The autouse retry_delays fixture records each wait instead of sleeping.

REAL_CLASSIFY_PRODUCT = m.classify_product


def test_retry_timeout_then_200_public_ok(retry_delays):
    s = FakeSession({PAGE: [requests.exceptions.ReadTimeout("slow"), FakeResponse(200, text=PUBLIC_PRODUCT_HTML)]})
    o = classify(s)
    assert o["status"] == "public_ok" and o["name"] == "Alpha Math"
    assert len(s.get_calls) == 2
    assert retry_delays == [5]


def test_retry_503_503_then_200_public_ok(retry_delays):
    s = FakeSession({PAGE: [FakeResponse(503), FakeResponse(503), FakeResponse(200, text=PUBLIC_PRODUCT_HTML)]})
    o = classify(s)
    assert o["status"] == "public_ok"
    assert len(s.get_calls) == 3
    assert retry_delays == [5, 20]


@pytest.mark.parametrize(
    "status,retry_after,expected_delay",
    [
        (429, "7", 7),        # honored
        (429, "9999", 120),   # clamped to MAX_RETRY_AFTER_SECONDS
        (429, "abc", 5),      # not an integer: falls back to the schedule
        (503, "7", 7),        # 503 honors it too
        (500, "7", 5),        # ignored on any other status
    ],
)
def test_retry_after_header(retry_delays, status, retry_after, expected_delay):
    s = FakeSession({PAGE: [FakeResponse(status, headers={"Retry-After": retry_after}), FakeResponse(200, text=PUBLIC_PRODUCT_HTML)]})
    o = classify(s)
    assert o["status"] == "public_ok"
    assert retry_delays == [expected_delay]


@pytest.mark.parametrize(
    "exc,detail",
    [
        (requests.exceptions.ConnectionError("down"), "connection error"),
        (requests.exceptions.ReadTimeout("slow"), "timeout"),
    ],
)
def test_retry_exhausted_exception_same_detail_as_before(retry_delays, exc, detail):
    s = FakeSession({PAGE: exc})  # a bare exception is raised on every call
    o = classify(s)
    assert (o["status"], o["detail"]) == ("fetch_error", detail)
    assert len(s.get_calls) == 4
    assert retry_delays == [5, 20, 60]


def test_retry_exhausted_503_same_detail_as_before(retry_delays):
    s = FakeSession({PAGE: FakeResponse(503)})
    o = classify(s)
    assert (o["status"], o["detail"]) == ("fetch_error", "HTTP 503")
    assert len(s.get_calls) == 4
    assert retry_delays == [5, 20, 60]


@pytest.mark.parametrize("status", [404, 403])
def test_no_retry_on_404_or_403(retry_delays, status):
    s = FakeSession({PAGE: FakeResponse(status)})
    o = classify(s)
    assert (o["status"], o["detail"]) == ("fetch_error", f"HTTP {status}")
    assert len(s.get_calls) == 1
    assert retry_delays == []


def test_unlock_post_500_never_retried(retry_delays):
    s = FakeSession({PAGE: FakeResponse(200, text=PASSWORD_FORM_HTML)}, {m.POSTPASS_URL: FakeResponse(500)})
    o = classify(s, protected_by_rest=True, added_entry=ENTRY)
    assert (o["status"], o["detail"]) == ("fetch_error", "unlock request: HTTP 500")
    assert len(s.post_calls) == 1
    assert retry_delays == []


def test_unlock_post_timeout_never_retried(retry_delays):
    s = FakeSession({PAGE: FakeResponse(200, text=PASSWORD_FORM_HTML)}, {m.POSTPASS_URL: requests.exceptions.ReadTimeout("slow")})
    o = classify(s, protected_by_rest=True, added_entry=ENTRY)
    assert (o["status"], o["detail"]) == ("fetch_error", "unlock request: timeout")
    assert len(s.post_calls) == 1
    assert retry_delays == []


def test_unlock_refetch_retried_then_unlocked(retry_delays):
    s = FakeSession(
        {PAGE: [FakeResponse(200, text=PASSWORD_FORM_HTML), requests.exceptions.ConnectionError("blip"), FakeResponse(200, text=UNLOCKED_PRODUCT_HTML)]},
        {m.POSTPASS_URL: FakeResponse(302)},
    )
    o = classify(s, protected_by_rest=True, added_entry=ENTRY)
    assert (o["status"], o["name"]) == ("protected_unlocked", "Kate’s Math Lessons")
    assert len(s.post_calls) == 1
    assert retry_delays == [5]


def test_vendor_500_then_200_public_ok(retry_delays):
    s = FakeSession({VENDOR_PAGE: [FakeResponse(500), FakeResponse(200, text=PUBLIC_VENDOR_HTML)]})
    o = m.classify_vendor(VENDOR_PAGE, protected_by_rest=False, session=s)
    assert (o["status"], o["name"]) == ("public_ok", "Acme Learning")
    assert retry_delays == [5]


def test_discover_page2_503_once_then_complete(retry_delays):
    s = FakeSession({
        TYPES: types_ok(),
        page_url(1): FakeResponse(200, json_body=[item("u1")], headers={"X-WP-Total": "2", "X-WP-TotalPages": "2"}),
        page_url(2): [FakeResponse(503), FakeResponse(200, json_body=[item("u2")])],
    })
    r = m.discover("product", session=s)
    assert r["complete"] is True and r["urls"] == {"u1", "u2"} and r["error"] is None
    assert retry_delays == [5]


def test_discover_types_fails_once_then_complete(retry_delays):
    s = FakeSession({
        TYPES: [requests.exceptions.ConnectionError("blip"), types_ok()],
        page_url(1): FakeResponse(200, json_body=[item("u1")], headers={"X-WP-Total": "1", "X-WP-TotalPages": "1"}),
    })
    r = m.discover("product", session=s)
    assert r["complete"] is True and r["urls"] == {"u1"}
    assert retry_delays == [5]


def test_discover_page2_503_exhausted_incomplete_same_error(retry_delays):
    s = FakeSession({
        TYPES: types_ok(),
        page_url(1): FakeResponse(200, json_body=[item("u1")], headers={"X-WP-Total": "2", "X-WP-TotalPages": "2"}),
        page_url(2): [FakeResponse(503) for _ in range(4)],
    })
    r = m.discover("product", session=s)
    assert r["complete"] is False
    assert r["error"] == "page 2: HTTP 503"
    assert [u for u, _ in s.get_calls].count(page_url(2)) == 4
    assert r["urls"] == {"u1"}


# --- exhausted streak ---------------------------------------------------------


def test_streak_increments_on_exhaustion():
    s = FakeSession({PAGE: FakeResponse(503), VENDOR_PAGE: requests.exceptions.ConnectionError("down")})
    m._get_with_retries(s, PAGE)
    assert m._retry_state["exhausted_streak"] == 1
    with pytest.raises(requests.exceptions.ConnectionError):
        m._get_with_retries(s, VENDOR_PAGE)
    assert m._retry_state["exhausted_streak"] == 2
    assert (m._retry_state["retried"], m._retry_state["exhausted"]) == (2, 2)


def test_streak_reset_by_200():
    s = FakeSession({PAGE: [FakeResponse(503)] * 4 + [FakeResponse(200)]})
    m._get_with_retries(s, PAGE)
    assert m._retry_state["exhausted_streak"] == 1
    m._get_with_retries(s, PAGE)
    assert m._retry_state["exhausted_streak"] == 0


def test_streak_reset_by_404():
    s = FakeSession({PAGE: [FakeResponse(503)] * 4 + [FakeResponse(404)]})
    m._get_with_retries(s, PAGE)
    assert m._retry_state["exhausted_streak"] == 1
    resp = m._get_with_retries(s, PAGE)
    assert resp.status_code == 404 and m._retry_state["exhausted_streak"] == 0


# --- circuit breaker through main() -------------------------------------------

BREAKER_URLS = [f"https://ncademi.org/provide/directory/products/p{n}/" for n in range(1, 10)]


def run_breaker_main(monkeypatch, get_routes):
    """run_main's offline harness, with discovery returning BREAKER_URLS and the
    REAL classify_product fetching through _get_with_retries from a FakeSession."""
    client = run_main(monkeypatch)
    s = FakeSession(get_routes)
    discs = {"product": disc_full(BREAKER_URLS), "vendor": disc_full([])}
    monkeypatch.setattr(m, "discover", lambda post_type, session=None: discs[post_type])

    def real_classify(url, *, protected_by_rest, rest_title, added_entry, session=None):
        return REAL_CLASSIFY_PRODUCT(url, protected_by_rest=protected_by_rest, rest_title=rest_title, added_entry=added_entry, session=s)

    monkeypatch.setattr(m, "classify_product", real_classify)
    return client, s


def test_breaker_aborts_after_five_consecutive_exhausted(monkeypatch, capsys):
    client, s = run_breaker_main(monkeypatch, {u: FakeResponse(503) for u in BREAKER_URLS})
    with pytest.raises(SystemExit) as exc:
        m.main()
    assert exc.value.code == 1
    assert client.commits == []
    err = capsys.readouterr().err
    assert "Site appears unreachable: 5 consecutive requests failed after retries -- NOTHING was written" in err
    # p1..p5 fetched (4 attempts each); p6 onwards never requested.
    assert len(s.get_calls) == 20
    assert BREAKER_URLS[5] not in {u for u, _ in s.get_calls}


def test_breaker_does_not_abort_when_a_success_breaks_the_streak(monkeypatch, capsys):
    routes = {u: FakeResponse(503) for u in BREAKER_URLS}
    routes[BREAKER_URLS[4]] = FakeResponse(200, text=PUBLIC_PRODUCT_HTML)  # 4 fail, 1 ok, 4 fail
    client, s = run_breaker_main(monkeypatch, routes)
    m.main()
    assert len(client.commits) == 1
    out = capsys.readouterr().out
    assert "Retries: 8 request(s) needed a retry; 8 exhausted all attempts" in out


# --- no leakage in retry output -------------------------------------------------


def test_retry_line_shows_path_not_query(capsys):
    s = FakeSession({
        TYPES: types_ok(),
        page_url(1): FakeResponse(200, json_body=[item("u1")], headers={"X-WP-Total": "2", "X-WP-TotalPages": "2"}),
        page_url(2): [FakeResponse(503), FakeResponse(200, json_body=[item("u2")])],
    })
    m.discover("product", session=s)
    out = capsys.readouterr().out
    assert "  retry 1/3 in 5s: GET /wp-json/wp/v2/product (HTTP 503)" in out
    assert "per_page" not in out and "page=2" not in out and "?" not in out


def test_no_password_in_output_with_retries_and_unlock(monkeypatch, capsys):
    # run_main configures the fixture password "fixture-value" for P_PROT.
    client = run_main(monkeypatch)
    s = FakeSession(
        {
            P_PUB: [FakeResponse(503), FakeResponse(200, text=PUBLIC_PRODUCT_HTML)],
            P_PROT: [FakeResponse(200, text=PASSWORD_FORM_HTML), requests.exceptions.ConnectionError("blip"), FakeResponse(200, text=UNLOCKED_PRODUCT_HTML)],
        },
        {m.POSTPASS_URL: FakeResponse(302)},
    )

    def real_classify(url, *, protected_by_rest, rest_title, added_entry, session=None):
        return REAL_CLASSIFY_PRODUCT(url, protected_by_rest=protected_by_rest, rest_title=rest_title, added_entry=added_entry, session=s)

    monkeypatch.setattr(m, "classify_product", real_classify)
    m.main()
    assert len(client.commits) == 1
    assert s.post_calls[0][1]["data"]["post_password"] == "fixture-value"  # it was used...
    captured = capsys.readouterr()
    assert "fixture-value" not in captured.out and "fixture-value" not in captured.err  # ...never printed
    assert "retry 1/3 in 5s: GET /provide/directory/products/kates/ (connection error)" in captured.out
    assert "Retries: 2 request(s) needed a retry; 0 exhausted all attempts" in captured.out
