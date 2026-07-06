"""Integration tests for the FastAPI endpoints (no real AI calls)."""

import pytest
from fastapi.testclient import TestClient

import crev.cache as cache_mod
import server
from crev.cache import store_result
from crev.config import CrevConfig
from crev.models import Issue, Language, ReviewResult, Severity

client = TestClient(server.app)

BUGGY_PYTHON = '''\
import os

password = "hunter2secret"

def process(items=[]):
    try:
        return [x * 2 for x in items]
    except:
        print("oops")
'''

RUST_SNIPPET = '''\
use std::collections::HashMap;

fn main() {
    let mut scores = HashMap::new();
    scores.insert("a", 1);
}
'''


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(cache_mod, "CACHE_DIR", tmp_path)
    yield tmp_path


def fake_config(api_key=""):
    def _load(api_key_arg=None, depth=None, model=None):
        cfg = CrevConfig(api_key=api_key)
        if depth:
            cfg.depth = depth
        return cfg
    return _load


class TestHealth:
    def test_health_shape(self):
        res = client.get("/api/health")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "ok"
        assert body["version"] == server.VERSION
        assert isinstance(body["ai_available"], bool)


class TestScan:
    def test_scan_finds_known_issues(self):
        res = client.post("/api/scan", json={"code": BUGGY_PYTHON, "filename": "app.py"})
        assert res.status_code == 200
        body = res.json()
        assert body["mode"] == "scan"
        assert body["language"] == "python"
        assert body["score"] is None
        assert body["issue_counts"]["critical"] >= 2  # secret + mutable default
        messages = " | ".join(i["message"] for i in body["issues"])
        assert "Mutable default" in messages
        assert "except" in messages

    def test_language_detected_from_filename(self):
        res = client.post("/api/scan", json={"code": "let x = 1;", "filename": "index.js"})
        assert res.json()["language"] == "javascript"

    def test_language_sniffed_from_content(self):
        res = client.post("/api/scan", json={"code": RUST_SNIPPET, "filename": "untitled"})
        assert res.json()["language"] == "rust"

    def test_explicit_language_wins(self):
        res = client.post("/api/scan", json={
            "code": "x = 1", "filename": "weird.py", "language": "javascript",
        })
        assert res.json()["language"] == "javascript"

    def test_oversized_payload_rejected(self):
        res = client.post("/api/scan", json={"code": "x" * 600_000, "filename": "big.py"})
        assert res.status_code == 413

    def test_empty_code_rejected(self):
        res = client.post("/api/scan", json={"code": "   ", "filename": "empty.py"})
        assert res.status_code == 422

    def test_missing_code_field_rejected(self):
        res = client.post("/api/scan", json={"filename": "x.py"})
        assert res.status_code == 422


class TestAnalyze:
    def test_analyze_without_key_returns_503(self, monkeypatch):
        monkeypatch.setattr(server, "load_config", fake_config(api_key=""))
        res = client.post("/api/analyze", json={"code": "x = 1", "filename": "x.py"})
        assert res.status_code == 503
        assert "API key" in res.json()["detail"]

    def test_analyze_serves_cached_result_without_api_call(self, monkeypatch):
        monkeypatch.setattr(server, "load_config", fake_config(api_key="test-key"))

        code = "def cached_example():\n    return 42\n"
        issue = Issue(
            line=1,
            severity=Severity.SUGGESTION,
            category="style",
            message="Cached finding.",
            suggestion=None,
        )
        store_result(code, "standard", ReviewResult(
            file_path="c.py",
            language=Language.PYTHON,
            score=9.1,
            summary="From the cache.",
            ai_model="claude-opus-4-8",
            ai_issues=[issue],
        ))

        res = client.post("/api/analyze", json={
            "code": code, "filename": "c.py", "depth": "standard",
        })
        assert res.status_code == 200
        body = res.json()
        assert body["cached"] is True
        assert body["mode"] == "analyze"
        assert body["score"] == 9.1
        assert body["summary"] == "From the cache."
