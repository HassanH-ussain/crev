"""
Cache module for CREV.

Uses SHA-256 file hashing to skip re-analysis of unchanged files.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import time
from pathlib import Path

from .config import CACHE_DIR
from .models import Issue, Language, ReviewResult, Severity

CACHE_TTL_SECONDS = 86400


def _hash_content(content: str, depth: str) -> str:
    payload = f"{depth}:{content}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _cache_path(cache_key: str) -> Path:
    return CACHE_DIR / f"{cache_key}.json"


def get_cached_result(
    content: str,
    depth: str,
    file_path: str,
) -> ReviewResult | None:
    """Look up a cached review result."""
    cache_key = _hash_content(content, depth)
    path = _cache_path(cache_key)

    if not path.exists():
        return None

    try:
        data = json.loads(path.read_text())

        cached_time = data.get("timestamp", 0)
        if time.time() - cached_time > CACHE_TTL_SECONDS:
            path.unlink(missing_ok=True)
            return None

        issues = []
        for item in data.get("issues", []):
            issues.append(Issue(
                line=item["line"],
                severity=Severity(item["severity"]),
                category=item["category"],
                message=item["message"],
                suggestion=item.get("suggestion"),
            ))

        return ReviewResult(
            file_path=file_path,
            language=Language(data.get("language", "unknown")),
            issues=issues,
            score=data.get("score", 0.0),
            summary=data.get("summary", ""),
            ai_model=data.get("ai_model", ""),
            cached=True,
            static_issues=[i for i in issues if i.category in ("style", "maintenance")],
            ai_issues=[i for i in issues if i.category not in ("style", "maintenance")],
        )

    except (json.JSONDecodeError, KeyError, TypeError, OSError):
        path.unlink(missing_ok=True)
        return None


def store_result(content: str, depth: str, result: ReviewResult) -> None:
    """Persist a review result to the cache."""
    cache_key = _hash_content(content, depth)
    path = _cache_path(cache_key)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    data = {
        "timestamp": time.time(),
        "language": result.language.value,
        "score": result.score,
        "summary": result.summary,
        "ai_model": result.ai_model,
        "issues": [
            {
                "line": i.line,
                "severity": i.severity.value,
                "category": i.category,
                "message": i.message,
                "suggestion": i.suggestion,
            }
            for i in result.all_issues
        ],
    }

    with contextlib.suppress(OSError):
        path.write_text(json.dumps(data, indent=2))


def clear_cache() -> int:
    """Remove all cached entries. Returns count cleared."""
    count = 0
    if CACHE_DIR.exists():
        for entry in CACHE_DIR.glob("*.json"):
            entry.unlink(missing_ok=True)
            count += 1
    return count
