"""FeedMyAgent: a Python client for https://api.feedmyagent.com."""

from .client import FeedMyAgent, FeedMyAgentError, Item

__all__ = ["FeedMyAgent", "FeedMyAgentError", "Item"]
__version__ = "0.1.0"
