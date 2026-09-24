from __future__ import annotations

import json

import httpx
import pytest

from feedmyagent import FeedMyAgent, FeedMyAgentError, Item
from feedmyagent.client import _score_query_match, _tokenize_query


def _json_response(status_code: int, payload: dict) -> httpx.Response:
    return httpx.Response(status_code, json=payload)


def _client_with_transport(handler, **kwargs) -> FeedMyAgent:
    client = FeedMyAgent(base_url="https://api.feedmyagent.com", **kwargs)
    transport = httpx.MockTransport(handler)
    original_request_json = client._request_json

    def patched(method, path, *, params=None, json_body=None, headers=None):
        request_headers = {"User-Agent": "feedmyagent-python/0.1", "Accept": "application/json"}
        if headers:
            request_headers.update(headers)
        with httpx.Client(
            base_url=client.base_url,
            timeout=client.timeout,
            headers=request_headers,
            transport=transport,
        ) as http_client:
            from feedmyagent.client import _send

            return _send(http_client, method, path, params=params, json_body=json_body)

    client._request_json = patched  # type: ignore[method-assign]
    return client


# ---------------------------------------------------------------------------
# tokenizer / scorer unit tests (ported logic, checked against known inputs)
# ---------------------------------------------------------------------------


def test_tokenize_query_lowercases_splits_and_drops_short_tokens():
    assert _tokenize_query("MCP Server Auth-Bypass in v2!") == [
        "mcp",
        "server",
        "auth",
        "bypass",
        "in",
        "v2",
    ]
    # single-char tokens (length <= 1) are dropped
    assert _tokenize_query("a b cd") == ["cd"]


def test_score_query_match_counts_distinct_term_hits():
    item = {
        "title": "CVE in popular MCP server",
        "summary": "Remote auth bypass affects agents",
        "tags": ["mcp", "cve"],
    }
    terms = _tokenize_query("mcp auth bypass nonexistentterm")
    # mcp, auth, bypass all present; nonexistentterm is not => score 3
    assert _score_query_match(item, terms) == 3


def test_score_query_match_zero_when_no_terms():
    assert _score_query_match({"title": "x"}, []) == 0


# ---------------------------------------------------------------------------
# latest()
# ---------------------------------------------------------------------------


def test_latest_requests_date_sort_and_maps_items():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return _json_response(
            200,
            {
                "data": [
                    {
                        "id": "1",
                        "title": "Item one",
                        "summary": "s1",
                        "url": "https://example.com/1",
                        "tags": ["security"],
                        "score": 4.2,
                    }
                ],
                "meta": {},
            },
        )

    client = _client_with_transport(handler)
    items = client.latest(tags=["security"], use_case="security", limit=1)

    assert "/items" in captured["url"]
    assert "sort=date" in captured["url"]
    assert "limit=1" in captured["url"]
    assert "tags=security" in captured["url"]
    assert "use_case=security" in captured["url"]

    assert items == [
        Item(id="1", title="Item one", summary="s1", url="https://example.com/1", tags=["security"], score=4.2)
    ]


# ---------------------------------------------------------------------------
# query() ranking parity with src/mcp-tools.ts's query_security_feed
# ---------------------------------------------------------------------------


def _candidate(id_, title, summary, tags, score, ingested_at):
    return {
        "id": id_,
        "title": title,
        "summary": summary,
        "url": f"https://example.com/{id_}",
        "tags": tags,
        "score": score,
        "ingested_at": ingested_at,
    }


def test_query_ranks_by_relevance_then_score_then_ingested_at_then_id():
    candidates = [
        # low relevance (0 matches), high score -> should sort behind matches
        _candidate("z", "irrelevant", "nothing matches", [], 99.0, "2026-09-20T00:00:00Z"),
        # 2 term matches ("mcp", "auth"), lower score
        _candidate("a", "MCP auth flaw", "affects agents", ["mcp"], 1.0, "2026-09-01T00:00:00Z"),
        # 2 term matches, higher score -> should rank above "a"
        _candidate("b", "MCP auth bug", "critical", ["mcp"], 5.0, "2026-09-02T00:00:00Z"),
        # 1 term match only
        _candidate("c", "just mcp mention", "unrelated", [], 10.0, "2026-09-03T00:00:00Z"),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return _json_response(200, {"data": candidates, "meta": {}})

    client = _client_with_transport(handler)
    results = client.query("mcp auth", limit=5)

    # b (2 matches, score 5) > a (2 matches, score 1) > c (1 match) ; z excluded (0 matches, and matches exist)
    assert [item.id for item in results] == ["b", "a", "c"]


def test_query_falls_back_to_top_scored_when_nothing_matches():
    candidates = [
        _candidate("x", "roasted pumpkin soup", "recipe blog post", [], 3.0, "2026-09-01T00:00:00Z"),
        _candidate("y", "gardening tips for spring", "flower bed prep", [], 7.0, "2026-09-02T00:00:00Z"),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return _json_response(200, {"data": candidates, "meta": {}})

    client = _client_with_transport(handler)
    results = client.query("wxyzwxyz quorbnex", limit=5)

    # No term hits anywhere -> falls back to unfiltered candidates, sorted by score desc
    assert [item.id for item in results] == ["y", "x"]


def test_query_candidate_limit_scales_with_requested_limit():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return _json_response(200, {"data": [], "meta": {}})

    client = _client_with_transport(handler)
    client.query("mcp", limit=30)

    # max(20, min(100, 30*5)) == 100
    assert "limit=100" in captured["url"]
    assert "sort=score" in captured["url"]


def test_query_candidate_limit_has_floor_of_twenty():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return _json_response(200, {"data": [], "meta": {}})

    client = _client_with_transport(handler)
    client.query("mcp", limit=1)

    # max(20, min(100, 1*5)) == 20
    assert "limit=20" in captured["url"]


# ---------------------------------------------------------------------------
# report()
# ---------------------------------------------------------------------------


def test_report_requires_api_key():
    client = FeedMyAgent()  # no api_key, no env var expected in test env
    client.api_key = None
    with pytest.raises(FeedMyAgentError) as exc_info:
        client.report("title", "description")
    assert exc_info.value.code == "unauthorized"


def test_report_posts_bearer_and_body():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["auth"] = request.headers.get("authorization")
        captured["body"] = json.loads(request.content)
        return _json_response(
            201,
            {
                "data": {
                    "id": "pending-1",
                    "title": "title",
                    "summary": None,
                    "url": "https://example.com/incidents/xyz",
                    "tags": [],
                    "score": 0,
                }
            },
        )

    client = _client_with_transport(handler, api_key="ask_test123")
    item = client.report("title", "description", url="https://example.com/incidents/xyz")

    assert captured["auth"] == "Bearer ask_test123"
    assert captured["body"] == {
        "url": "https://example.com/incidents/xyz",
        "title": "title",
        "raw_content": "description",
    }
    assert item.id == "pending-1"


def test_report_generates_incident_url_when_omitted():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return _json_response(
            201,
            {"data": {"id": "1", "title": "t", "summary": None, "url": "u", "tags": [], "score": 0}},
        )

    client = _client_with_transport(handler, api_key="ask_test123")
    client.report("title", "description")

    assert captured["body"]["url"].startswith("https://api.feedmyagent.com/incidents/")


# ---------------------------------------------------------------------------
# error handling
# ---------------------------------------------------------------------------


def test_raises_feedmyagent_error_on_api_error_envelope():
    def handler(request: httpx.Request) -> httpx.Response:
        return _json_response(400, {"error": {"code": "invalid_request", "message": "bad tag"}})

    client = _client_with_transport(handler)
    with pytest.raises(FeedMyAgentError) as exc_info:
        client.latest()
    assert exc_info.value.code == "invalid_request"
    assert exc_info.value.status == 400


# ---------------------------------------------------------------------------
# provision_key()
# ---------------------------------------------------------------------------


def test_provision_key_posts_owner_and_ref_and_returns_key(monkeypatch):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return _json_response(201, {"data": {"key": "ask_abc123"}})

    transport = httpx.MockTransport(handler)
    real_client_cls = httpx.Client

    def fake_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_client_cls(*args, **kwargs)

    monkeypatch.setattr(httpx, "Client", fake_client)

    key = FeedMyAgent.provision_key("my-agent", ref="my-ref/0.1")

    assert key == "ask_abc123"
    assert captured["body"] == {"owner": "my-agent", "ref": "my-ref/0.1"}
