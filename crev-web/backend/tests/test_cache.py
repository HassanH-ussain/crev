"""Tests for crev.cache — SHA-256 keyed result caching."""

import json
import time

import pytest

import crev.cache as cache_mod
from crev.cache import clear_cache, get_cached_result, store_result
from crev.models import Issue, Language, ReviewResult, Severity


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    """Point the cache at a temp directory so tests never touch ~/.crev."""
    monkeypatch.setattr(cache_mod, "CACHE_DIR", tmp_path)
    yield tmp_path


def make_result() -> ReviewResult:
    issue = Issue(
        line=2,
        severity=Severity.WARNING,
        category="bug",
        message="Something looks off.",
        suggestion="Fix it.",
    )
    return ReviewResult(
        file_path="sample.py",
        language=Language.PYTHON,
        score=8.2,
        summary="Mostly fine.",
        ai_model="claude-opus-4-8",
        ai_issues=[issue],
    )


class TestCacheRoundtrip:
    def test_store_then_get(self):
        store_result("x = 1", "standard", make_result())
        hit = get_cached_result("x = 1", "standard", "sample.py")
        assert hit is not None
        assert hit.cached is True
        assert hit.score == 8.2
        assert len(hit.all_issues) == 1

    def test_miss_for_unknown_content(self):
        assert get_cached_result("never stored", "standard", "x.py") is None

    def test_depth_is_part_of_the_key(self):
        store_result("x = 1", "standard", make_result())
        assert get_cached_result("x = 1", "full", "sample.py") is None

    def test_content_change_misses(self):
        store_result("x = 1", "standard", make_result())
        assert get_cached_result("x = 2", "standard", "sample.py") is None


class TestExpiry:
    def test_expired_entry_evicted(self, isolated_cache):
        store_result("x = 1", "standard", make_result())
        entry = next(isolated_cache.glob("*.json"))
        data = json.loads(entry.read_text())
        data["timestamp"] = time.time() - (cache_mod.CACHE_TTL_SECONDS + 10)
        entry.write_text(json.dumps(data))

        assert get_cached_result("x = 1", "standard", "sample.py") is None
        assert not entry.exists()


class TestClearCache:
    def test_clears_and_counts(self):
        store_result("a = 1", "standard", make_result())
        store_result("b = 2", "standard", make_result())
        assert clear_cache() == 2
        assert get_cached_result("a = 1", "standard", "x.py") is None

    def test_corrupt_entry_evicted(self, isolated_cache):
        store_result("x = 1", "standard", make_result())
        entry = next(isolated_cache.glob("*.json"))
        entry.write_text("{not valid json")
        assert get_cached_result("x = 1", "standard", "sample.py") is None
        assert not entry.exists()
