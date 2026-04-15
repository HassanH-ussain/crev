"""
File parser module for CREV.

Reads source files and extracts structural metadata (functions,
classes, imports) using regex-based heuristics per language.
"""

from __future__ import annotations

import re
from pathlib import Path

from .models import EXTENSION_MAP, FileAnalysis, Language

_PATTERNS: dict[Language, dict[str, str]] = {
    Language.PYTHON: {
        "functions": r"^\s*(?:async\s+)?def\s+(\w+)\s*\(",
        "classes": r"^\s*class\s+(\w+)\s*[:\(]",
        "imports": r"^\s*(?:import|from)\s+(\S+)",
    },
    Language.JAVASCRIPT: {
        "functions": (
            r"(?:function\s+(\w+)"
            r"|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[\w]+)\s*=>)"
        ),
        "classes": r"\bclass\s+(\w+)",
        "imports": (
            r"(?:import\s+.*?from\s+['\"](\S+?)['\"]"
            r"|require\s*\(\s*['\"](\S+?)['\"]\s*\))"
        ),
    },
    Language.TYPESCRIPT: {
        "functions": (
            r"(?:function\s+(\w+)"
            r"|(?:const|let|var)\s+(\w+)\s*(?::\s*\w+(?:<[^>]*>)?\s*)?=\s*"
            r"(?:async\s+)?(?:\([^)]*\)|[\w]+)\s*=>)"
        ),
        "classes": r"\bclass\s+(\w+)",
        "imports": r"import\s+.*?from\s+['\"](\S+?)['\"]",
    },
    Language.CPP: {
        "functions": (
            r"(?:[\w:*&<>]+\s+)+(\w+)\s*\([^)]*\)\s*"
            r"(?:const\s*)?(?:override\s*)?(?:noexcept\s*)?\{"
        ),
        "classes": r"\b(?:class|struct)\s+(\w+)",
        "imports": r"#\s*include\s+[<\"](\S+?)[>\"]",
    },
    Language.C: {
        "functions": r"(?:[\w*]+\s+)+(\w+)\s*\([^)]*\)\s*\{",
        "classes": r"\btypedef\s+struct\s+(\w+)",
        "imports": r"#\s*include\s+[<\"](\S+?)[>\"]",
    },
    Language.JAVA: {
        "functions": (
            r"(?:public|private|protected|static|\s)+[\w<>\[\]]+\s+(\w+)"
            r"\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{"
        ),
        "classes": r"\b(?:class|interface|enum)\s+(\w+)",
        "imports": r"import\s+([\w.]+);",
    },
    Language.RUST: {
        "functions": r"\bfn\s+(\w+)",
        "classes": r"\b(?:struct|enum|trait)\s+(\w+)",
        "imports": r"\buse\s+([\w:]+)",
    },
    Language.GO: {
        "functions": r"\bfunc\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(",
        "classes": r"\btype\s+(\w+)\s+struct\b",
        "imports": r"\"(\S+?)\"",
    },
}


def detect_language(file_path: str) -> Language:
    """Detect programming language from file extension."""
    ext = Path(file_path).suffix.lower()
    return EXTENSION_MAP.get(ext, Language.UNKNOWN)


def _extract_matches(pattern: str, content: str) -> list[str]:
    results = []
    for match in re.finditer(pattern, content, re.MULTILINE):
        groups = match.groups()
        name = next((g for g in groups if g is not None), None)
        if name:
            results.append(name)
    return results


def _estimate_complexity(content: str, language: Language) -> str:
    lines = content.split("\n")
    line_count = len(lines)

    max_indent = 0
    for line in lines:
        stripped = line.lstrip()
        if stripped:
            indent = len(line) - len(stripped)
            max_indent = max(max_indent, indent)

    branch_keywords = r"\b(if|else|elif|switch|case|for|while|try|catch|except)\b"
    branch_count = len(re.findall(branch_keywords, content))

    score = 0
    if line_count > 200:
        score += 2
    elif line_count > 50:
        score += 1
    if max_indent > 16:
        score += 2
    elif max_indent > 8:
        score += 1
    if branch_count > 20:
        score += 2
    elif branch_count > 8:
        score += 1

    if score >= 4:
        return "high"
    elif score >= 2:
        return "medium"
    return "low"


def parse_file(file_path: str) -> FileAnalysis:
    """Parse a source file and extract structural metadata."""
    path = Path(file_path)

    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    content = path.read_text(encoding="utf-8")

    if not content.strip():
        raise ValueError(f"File is empty: {file_path}")

    language = detect_language(file_path)
    patterns = _PATTERNS.get(language, {})

    functions = _extract_matches(patterns.get("functions", ""), content)
    classes = _extract_matches(patterns.get("classes", ""), content)
    imports = _extract_matches(patterns.get("imports", ""), content)
    complexity = _estimate_complexity(content, language)

    return FileAnalysis(
        path=str(path.resolve()),
        language=language,
        content=content,
        line_count=len(content.splitlines()),
        functions=functions,
        classes=classes,
        imports=imports,
        complexity_estimate=complexity,
    )


def discover_files(target: str, recursive: bool = True) -> list[str]:
    """Discover all supported source files in a path."""
    path = Path(target)

    if path.is_file():
        if path.suffix.lower() in EXTENSION_MAP:
            return [str(path)]
        return []

    if not path.is_dir():
        return []

    supported = set(EXTENSION_MAP.keys())
    files = []
    glob_fn = path.rglob if recursive else path.glob
    skip_dirs = {"node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build"}

    for child in sorted(glob_fn("*")):
        if child.is_file() and child.suffix.lower() in supported:
            parts = child.parts
            if not any(d in parts for d in skip_dirs):
                files.append(str(child))

    return files
