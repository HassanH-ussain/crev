"""
Static analyzer module for CREV.

Performs rule-based checks BEFORE sending code to the AI.
Each checker is a pure function: FileAnalysis → list[Issue]
"""

from __future__ import annotations

import re
from collections.abc import Callable

from .models import FileAnalysis, Issue, Language, Severity

Checker = Callable[[FileAnalysis], list[Issue]]
_CHECKERS: list[Checker] = []


def checker(fn: Checker) -> Checker:
    """Decorator to register a static check function."""
    _CHECKERS.append(fn)
    return fn


@checker
def check_line_length(analysis: FileAnalysis) -> list[Issue]:
    issues = []
    for i, line in enumerate(analysis.content.splitlines(), 1):
        if len(line) > 120:
            issues.append(Issue(
                line=i,
                severity=Severity.SUGGESTION,
                category="style",
                message=f"Line is {len(line)} characters (max recommended: 120).",
                suggestion="Break this line into multiple lines for readability.",
            ))
    return issues[:5]


@checker
def check_todo_fixme(analysis: FileAnalysis) -> list[Issue]:
    issues = []
    pattern = re.compile(r"#.*\b(TODO|FIXME|HACK|XXX|BUG)\b:?\s*(.*)", re.IGNORECASE)
    for i, line in enumerate(analysis.content.splitlines(), 1):
        match = pattern.search(line)
        if match:
            tag, msg = match.group(1).upper(), match.group(2).strip()
            severity = Severity.WARNING if tag in ("FIXME", "BUG") else Severity.INFO
            issues.append(Issue(
                line=i,
                severity=severity,
                category="maintenance",
                message=f"{tag} found: {msg or '(no description)'}",
            ))
    return issues


@checker
def check_large_functions(analysis: FileAnalysis) -> list[Issue]:
    issues = []
    if analysis.language not in (Language.PYTHON, Language.JAVASCRIPT, Language.TYPESCRIPT):
        return issues

    lines = analysis.content.splitlines()
    func_pattern = (
        r"^\s*(?:async\s+)?def\s+(\w+)"
        if analysis.language == Language.PYTHON
        else r"(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=)"
    )

    func_starts: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        match = re.match(func_pattern, line)
        if match:
            name = next((g for g in match.groups() if g), "unknown")
            func_starts.append((i, name))

    for idx, (start, name) in enumerate(func_starts):
        end = func_starts[idx + 1][0] if idx + 1 < len(func_starts) else len(lines)
        length = end - start
        if length > 50:
            issues.append(Issue(
                line=start + 1,
                severity=Severity.WARNING,
                category="complexity",
                message=f"Function '{name}' is ~{length} lines long.",
                suggestion="Consider breaking this into smaller, focused functions.",
            ))

    return issues


@checker
def check_python_bare_except(analysis: FileAnalysis) -> list[Issue]:
    if analysis.language != Language.PYTHON:
        return []

    issues = []
    for i, line in enumerate(analysis.content.splitlines(), 1):
        if re.match(r"^\s*except\s*:", line):
            issues.append(Issue(
                line=i,
                severity=Severity.WARNING,
                category="bug",
                message=(
                    "Bare 'except:' catches all exceptions "
                    "including KeyboardInterrupt and SystemExit."
                ),
                suggestion="Use 'except Exception:' or catch specific exception types.",
            ))
    return issues


@checker
def check_python_mutable_defaults(analysis: FileAnalysis) -> list[Issue]:
    if analysis.language != Language.PYTHON:
        return []

    issues = []
    pattern = re.compile(
        r"def\s+\w+\s*\([^)]*?(\w+)\s*=\s*(\[\]|\{\}|\bset\(\))",
        re.MULTILINE,
    )
    for match in pattern.finditer(analysis.content):
        line_num = analysis.content[:match.start()].count("\n") + 1
        param = match.group(1)
        issues.append(Issue(
            line=line_num,
            severity=Severity.CRITICAL,
            category="bug",
            message=f"Mutable default argument '{param}' — shared across all calls.",
            suggestion=f"Use '{param}=None' and initialize inside the function body.",
        ))
    return issues


@checker
def check_python_print_statements(analysis: FileAnalysis) -> list[Issue]:
    if analysis.language != Language.PYTHON:
        return []

    issues = []
    for i, line in enumerate(analysis.content.splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith("print(") and not stripped.startswith("#"):
            issues.append(Issue(
                line=i,
                severity=Severity.INFO,
                category="style",
                message="print() call found — may be a debug leftover.",
                suggestion="Consider using the logging module for production code.",
            ))
    return issues[:5]


@checker
def check_hardcoded_secrets(analysis: FileAnalysis) -> list[Issue]:
    issues = []
    patterns = [
        (
            r"""(?:password|passwd|pwd|secret|api_key|apikey|token|auth)\s*=\s*['"][^'"]{8,}['"]""",
            "Possible hardcoded secret",
        ),
        (
            r"""['"](?:sk-|pk_|ghp_|gho_|github_pat_)\w+['"]""",
            "Possible API key/token",
        ),
    ]

    for pattern, message in patterns:
        for match in re.finditer(pattern, analysis.content, re.IGNORECASE):
            line_num = analysis.content[:match.start()].count("\n") + 1
            issues.append(Issue(
                line=line_num,
                severity=Severity.CRITICAL,
                category="security",
                message=f"{message} detected.",
                suggestion="Move secrets to environment variables or a .env file.",
            ))
    return issues


def run_static_analysis(analysis: FileAnalysis) -> list[Issue]:
    """Run all registered static checks and return sorted issues."""
    all_issues: list[Issue] = []
    for check_fn in _CHECKERS:
        try:
            all_issues.extend(check_fn(analysis))
        except Exception:
            continue
    return sorted(all_issues)
