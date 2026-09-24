"""Shared formatting for tool outputs: a compact JSON array of items."""

from __future__ import annotations

import json
from typing import Iterable

from feedmyagent import Item


def format_items(items: Iterable[Item]) -> str:
    """Render feed items as a compact JSON array (title, url, tags, score, summary).

    Compact JSON keeps tool output small (tool results consume the calling
    model's context window) while remaining trivial for the model to parse
    or quote back to the user.
    """
    payload = [
        {
            "id": item.id,
            "title": item.title,
            "summary": item.summary,
            "url": item.url,
            "tags": item.tags,
            "score": item.score,
        }
        for item in items
    ]
    if not payload:
        return "[]"
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
