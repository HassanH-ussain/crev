"""Tests for crev.parser — language detection and structural extraction."""

import pytest

from crev.models import Language
from crev.parser import detect_language, parse_file, parse_source

PYTHON_SAMPLE = '''\
import os
from pathlib import Path


class Greeter:
    def greet(self, name):
        return f"Hello {name}"


async def fetch_data(url):
    pass
'''


class TestDetectLanguage:
    def test_python(self):
        assert detect_language("main.py") == Language.PYTHON

    def test_typescript_tsx(self):
        assert detect_language("App.tsx") == Language.TYPESCRIPT

    def test_rust(self):
        assert detect_language("lib.rs") == Language.RUST

    def test_case_insensitive(self):
        assert detect_language("MAIN.PY") == Language.PYTHON

    def test_unknown_extension(self):
        assert detect_language("notes.txt") == Language.UNKNOWN

    def test_no_extension(self):
        assert detect_language("Makefile") == Language.UNKNOWN


class TestParseSource:
    def test_extracts_python_structure(self):
        analysis = parse_source(PYTHON_SAMPLE, filename="sample.py")
        assert analysis.language == Language.PYTHON
        assert "greet" in analysis.functions
        assert "fetch_data" in analysis.functions
        assert "Greeter" in analysis.classes
        assert "os" in analysis.imports

    def test_line_count(self):
        analysis = parse_source("a = 1\nb = 2\n", filename="x.py")
        assert analysis.line_count == 2

    def test_explicit_language_overrides_filename(self):
        analysis = parse_source("fn main() {}", filename="pasted", language=Language.RUST)
        assert analysis.language == Language.RUST
        assert "main" in analysis.functions

    def test_empty_source_raises(self):
        with pytest.raises(ValueError):
            parse_source("   \n  ", filename="empty.py")

    def test_complexity_low_for_trivial_code(self):
        analysis = parse_source("x = 1", filename="x.py")
        assert analysis.complexity_estimate == "low"

    def test_complexity_rises_with_branches_and_length(self):
        lines = []
        for i in range(250):
            lines.append(f"if x == {i}:")
            lines.append(f"    y = {i}")
        analysis = parse_source("\n".join(lines), filename="big.py")
        assert analysis.complexity_estimate == "high"


class TestParseFile:
    def test_reads_from_disk(self, tmp_path):
        f = tmp_path / "hello.py"
        f.write_text(PYTHON_SAMPLE, encoding="utf-8")
        analysis = parse_file(str(f))
        assert analysis.language == Language.PYTHON
        assert "Greeter" in analysis.classes

    def test_missing_file_raises(self):
        with pytest.raises(FileNotFoundError):
            parse_file("does/not/exist.py")
