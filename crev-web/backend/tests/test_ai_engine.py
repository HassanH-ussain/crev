"""Tests for crev.ai_engine — response parsing and code chunking (no API calls)."""

import json

from crev.ai_engine import _chunk_code, _parse_ai_response, analyze_with_ai
from crev.config import CrevConfig
from crev.models import Language, Severity
from crev.parser import parse_source

VALID_RESPONSE = json.dumps({
    "score": 7.5,
    "summary": "Decent code with a few issues.",
    "issues": [
        {
            "line": 3,
            "severity": "critical",
            "category": "bug",
            "message": "Mutable default argument.",
            "suggestion": "Use None instead.",
        },
        {
            "line": 10,
            "severity": "info",
            "category": "style",
            "message": "Minor style nit.",
        },
    ],
})


class TestParseAiResponse:
    def test_valid_json(self):
        score, summary, issues = _parse_ai_response(VALID_RESPONSE)
        assert score == 7.5
        assert "Decent" in summary
        assert len(issues) == 2
        assert issues[0].severity == Severity.CRITICAL
        assert issues[1].suggestion is None

    def test_markdown_fenced_json(self):
        fenced = f"```json\n{VALID_RESPONSE}\n```"
        score, _, issues = _parse_ai_response(fenced)
        assert score == 7.5
        assert len(issues) == 2

    def test_trailing_comma_recovered(self):
        broken = '{"score": 6.0, "summary": "ok", "issues": [],}'
        score, summary, issues = _parse_ai_response(broken)
        assert score == 6.0
        assert issues == []

    def test_garbage_falls_back_gracefully(self):
        score, summary, issues = _parse_ai_response("I'm sorry, I can't do that.")
        assert score == 5.0
        assert "could not be parsed" in summary
        assert issues == []

    def test_unknown_severity_maps_to_info(self):
        raw = json.dumps({
            "score": 8.0,
            "summary": "fine",
            "issues": [{"line": 1, "severity": "catastrophic", "category": "bug", "message": "x"}],
        })
        _, _, issues = _parse_ai_response(raw)
        assert issues[0].severity == Severity.INFO


class TestChunkCode:
    def test_short_content_single_chunk(self):
        content = "\n".join(f"x{i} = {i}" for i in range(50))
        assert _chunk_code(content) == [content]

    def test_long_content_multiple_chunks(self):
        content = "\n".join(f"x{i} = {i}" for i in range(650))
        chunks = _chunk_code(content, max_lines=300)
        assert len(chunks) >= 2

    def test_no_lines_lost(self):
        content = "\n".join(f"x{i} = {i}" for i in range(650))
        chunks = _chunk_code(content, max_lines=300)
        total = sum(len(c.splitlines()) for c in chunks)
        assert total == 650


class TestAnalyzeWithAi:
    def test_unconfigured_returns_warning_without_api_call(self):
        analysis = parse_source("x = 1", filename="x.py", language=Language.PYTHON)
        config = CrevConfig(api_key="")
        result = analyze_with_ai(analysis, config)
        assert "No API key" in result.summary
        assert result.ai_issues == []
