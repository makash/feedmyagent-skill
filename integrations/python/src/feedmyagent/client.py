"""FeedMyAgent Python client.

A minimal, typed client for https://api.feedmyagent.com — the technology
intelligence feed for AI agents (security, compliance, and engineering news).

The ranking used by :meth:`FeedMyAgent.query` is a byte-for-byte port of the
``tokenizeToolQuery`` / ``scoreQueryMatch`` helpers and the
``query_security_feed`` candidate/sort logic in the hosted MCP tool
(``src/mcp-tools.ts`` in the main repo), so results match what the MCP tool
returns for the same query.
"""

from __future__ import annotations

import os
import re
import time
import random
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Optional
from urllib.parse import urljoin

import httpx

__all__ = ["FeedMyAgent", "Item", "FeedMyAgentError"]

DEFAULT_BASE_URL = "https://api.feedmyagent.com"
USER_AGENT = "feedmyagent-python/0.1"

# Matches tokenizeToolQuery's /[^a-z0-9]+/ split (applied after lowercasing).
_TOKEN_SPLIT_RE = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class Item:
    """A single feed item, as returned by the FeedMyAgent API."""

    id: str
    title: str
    summary: Optional[str]
    url: str
    tags: list = field(default_factory=list)
    score: float = 0.0


class FeedMyAgentError(RuntimeError):
    """Raised when the FeedMyAgent API returns an error or an invalid response."""

    def __init__(self, code: str, message: str, status: Optional[int] = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


class FeedMyAgent:
    """Client for the FeedMyAgent REST API.

    Reads (:meth:`latest`, :meth:`query`) are anonymous — no API key needed.
    Writing (:meth:`report`) requires a key, either passed as ``api_key`` or
    read from the ``FEEDMYAGENT_API_KEY`` environment variable. Get a free
    key with :meth:`provision_key`.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        *,
        timeout: float = 10.0,
        user_agent: str = USER_AGENT,
    ) -> None:
        self.api_key = api_key or os.environ.get("FEEDMYAGENT_API_KEY")
        self.base_url = _require_https(base_url).rstrip("/")
        self.timeout = timeout
        self.user_agent = user_agent

    # -- public API ---------------------------------------------------

    def latest(
        self,
        tags: Optional[Iterable[str]] = None,
        use_case: Optional[str] = None,
        limit: int = 10,
    ) -> list:
        """Return the most recent feed items, newest first.

        Mirrors the hosted ``get_latest`` MCP tool: ``GET /items`` sorted by
        date, with optional tag and use-case filters.
        """
        params = _build_params(sort="date", limit=limit, tags=tags, use_case=use_case)
        raw_items = self._request_items(params)
        return [_to_item(raw) for raw in raw_items[:limit]]

    def query(
        self,
        text: str,
        tags: Optional[Iterable[str]] = None,
        limit: int = 5,
    ) -> list:
        """Return feed items relevant to a natural-language query.

        This is a client-side port of ``query_security_feed`` in
        ``src/mcp-tools.ts``: it fetches up to ``max(20, min(100, limit*5))``
        top-scored candidates from the API, tokenizes ``text`` the same way
        the hosted tool does, and ranks candidates by
        (term-match count, item score, ingested_at, id) — all descending —
        falling back to the unfiltered top-scored candidates if nothing
        matches any query term.
        """
        candidate_limit = max(20, min(100, limit * 5))
        params = _build_params(sort="score", limit=candidate_limit, tags=tags)
        raw_items = self._request_items(params)

        terms = _tokenize_query(text)
        scored = [
            (
                raw,
                _score_query_match(raw, terms),
                _numeric(raw.get("score")),
                str(raw.get("ingested_at") or ""),
                str(raw.get("id") or ""),
            )
            for raw in raw_items
        ]
        # All four sort keys are descending, matching the TS comparator's
        # right-vs-left comparisons exactly.
        scored.sort(key=lambda entry: (entry[1], entry[2], entry[3], entry[4]), reverse=True)

        with_matches = [entry for entry in scored if entry[1] > 0]
        selected = with_matches[:limit] if with_matches else scored[:limit]
        return [_to_item(entry[0]) for entry in selected]

    def report(self, title: str, description: str, url: Optional[str] = None) -> Item:
        """Submit a pending item (an incident/signal) to the feed.

        Requires an API key. Mirrors the hosted ``report_incident`` MCP
        tool: ``POST /items`` with ``Authorization: Bearer <key>`` and body
        ``{url, title, raw_content}``. When ``url`` is omitted, a
        ``<base_url>/incidents/<generated-id>`` reference URL is generated,
        the same way the hosted tool does.
        """
        api_key = self._require_api_key()
        incident_url = url if url is not None else _generate_incident_url(self.base_url)
        body = {"url": incident_url, "title": title, "raw_content": description}
        data = self._request_json(
            "POST",
            "/items",
            json_body=body,
            headers={"Authorization": f"Bearer {api_key}"},
        )
        if not isinstance(data, Mapping):
            raise FeedMyAgentError("internal", "POST /items returned an invalid response")
        return _to_item(data)

    @classmethod
    def provision_key(
        cls,
        owner: str,
        ref: Optional[str] = None,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 10.0,
    ) -> str:
        """Provision a free API key via ``POST /keys`` and return it.

        ``ref`` identifies the integration requesting the key (e.g.
        ``"feedmyagent-langchain/0.1"``) so adoption is attributable; it
        defaults to this package's own User-Agent when omitted.
        """
        body: dict = {"owner": owner}
        body["ref"] = ref if ref is not None else USER_AGENT

        with httpx.Client(
            base_url=_require_https(base_url).rstrip("/"),
            timeout=timeout,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        ) as client:
            data = _send(client, "POST", "/keys", json_body=body)

        if not isinstance(data, Mapping) or not isinstance(data.get("key"), str):
            raise FeedMyAgentError("internal", "POST /keys returned an invalid response")
        return data["key"]

    # -- internals ------------------------------------------------------

    def _require_api_key(self) -> str:
        if not self.api_key:
            raise FeedMyAgentError(
                "unauthorized",
                "An API key is required for this operation. Set FEEDMYAGENT_API_KEY, "
                "pass api_key=... to FeedMyAgent(), or call FeedMyAgent.provision_key() "
                "to get one.",
                401,
            )
        return self.api_key

    def _request_items(self, params: list) -> list:
        data = self._request_json("GET", "/items", params=params)
        if not isinstance(data, list):
            raise FeedMyAgentError("internal", "GET /items returned an invalid items payload")
        return data

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        params: Optional[list] = None,
        json_body: Optional[dict] = None,
        headers: Optional[dict] = None,
    ) -> Any:
        request_headers = {"User-Agent": self.user_agent, "Accept": "application/json"}
        if headers:
            request_headers.update(headers)

        with httpx.Client(
            base_url=self.base_url, timeout=self.timeout, headers=request_headers
        ) as client:
            return _send(client, method, path, params=params, json_body=json_body)


def _send(
    client: httpx.Client,
    method: str,
    path: str,
    *,
    params: Optional[list] = None,
    json_body: Optional[dict] = None,
) -> Any:
    try:
        response = client.request(method, path, params=params, json=json_body)
    except httpx.HTTPError as exc:
        raise FeedMyAgentError("internal", f"REST API request failed: {exc}") from exc

    try:
        payload = response.json()
    except ValueError:
        payload = None

    if response.is_error:
        if (
            isinstance(payload, Mapping)
            and isinstance(payload.get("error"), Mapping)
            and isinstance(payload["error"].get("code"), str)
            and isinstance(payload["error"].get("message"), str)
        ):
            raise FeedMyAgentError(
                payload["error"]["code"], payload["error"]["message"], response.status_code
            )
        raise FeedMyAgentError(
            "internal",
            f"REST API request failed with status {response.status_code}",
            response.status_code,
        )

    if not isinstance(payload, Mapping) or "data" not in payload:
        raise FeedMyAgentError("internal", "REST API returned an invalid success envelope")

    return payload["data"]


def _to_item(raw: Mapping) -> Item:
    tags_field = raw.get("tags")
    return Item(
        id=str(raw.get("id", "")),
        title=str(raw.get("title", "")),
        summary=raw.get("summary") if isinstance(raw.get("summary"), str) else None,
        url=str(raw.get("url", "")),
        tags=[str(tag) for tag in tags_field] if isinstance(tags_field, list) else [],
        score=_numeric(raw.get("score")),
    )


def _build_params(
    *,
    sort: str,
    limit: int,
    tags: Optional[Iterable[str]] = None,
    use_case: Optional[str] = None,
) -> list:
    params: list = [("sort", sort), ("limit", str(limit))]
    if tags:
        for tag in tags:
            params.append(("tags", tag))
    if use_case:
        params.append(("use_case", use_case))
    return params


def _tokenize_query(value: str) -> list:
    """Port of tokenizeToolQuery: lowercase, split on non-alphanumerics, drop len<=1 tokens."""
    return [term for term in _TOKEN_SPLIT_RE.split(value.lower()) if len(term) > 1]


def _score_query_match(raw: Mapping, terms: list) -> int:
    """Port of scoreQueryMatch: count of query terms found as substrings in title+summary+tags."""
    if not terms:
        return 0

    title = raw.get("title") if isinstance(raw.get("title"), str) else ""
    summary = raw.get("summary") if isinstance(raw.get("summary"), str) else ""
    tags_field = raw.get("tags")
    tags = " ".join(str(tag) for tag in tags_field) if isinstance(tags_field, list) else ""
    haystack = f"{title} {summary} {tags}".lower()

    return sum(1 for term in terms if term in haystack)


def _numeric(value: Any) -> float:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.0


def _generate_incident_url(base_url: str) -> str:
    generated_id = f"{_base36(int(time.time() * 1000))}{_random_base36(8)}"
    return urljoin(base_url, f"/incidents/{generated_id}")


def _base36(number: int) -> str:
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    if number == 0:
        return "0"
    chars = []
    while number:
        number, remainder = divmod(number, 36)
        chars.append(digits[remainder])
    return "".join(reversed(chars))


def _random_base36(length: int) -> str:
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    return "".join(random.choice(digits) for _ in range(length))


_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _require_https(base_url: str) -> str:
    """Reject non-HTTPS base URLs so API keys are never sent in cleartext.

    Plain ``http`` is allowed only for local development hosts.
    """
    from urllib.parse import urlparse

    parsed = urlparse(base_url)
    if parsed.scheme == "https" or (
        parsed.scheme == "http" and parsed.hostname in _LOCAL_HOSTS
    ):
        return base_url
    raise ValueError(
        f"base_url must use https (http only for localhost), got {base_url!r}"
    )
