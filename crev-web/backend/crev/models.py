"""
Data models for the CREV pipeline.

Defines structured types used across all modules, ensuring
consistent data flow from parsing through AI analysis to output.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Severity(Enum):
    """Issue severity levels, ordered by impact."""

    CRITICAL = "critical"
    WARNING = "warning"
    SUGGESTION = "suggestion"
    INFO = "info"

    @property
    def rank(self) -> int:
        return {
            Severity.CRITICAL: 0,
            Severity.WARNING: 1,
            Severity.SUGGESTION: 2,
            Severity.INFO: 3,
        }[self]


class Language(Enum):
    """Supported programming languages."""

    PYTHON = "python"
    JAVASCRIPT = "javascript"
    TYPESCRIPT = "typescript"
    CPP = "cpp"
    C = "c"
    JAVA = "java"
    RUST = "rust"
    GO = "go"
    UNKNOWN = "unknown"


EXTENSION_MAP: dict[str, Language] = {
    ".py": Language.PYTHON,
    ".js": Language.JAVASCRIPT,
    ".jsx": Language.JAVASCRIPT,
    ".ts": Language.TYPESCRIPT,
    ".tsx": Language.TYPESCRIPT,
    ".cpp": Language.CPP,
    ".cc": Language.CPP,
    ".cxx": Language.CPP,
    ".hpp": Language.CPP,
    ".h": Language.C,
    ".c": Language.C,
    ".java": Language.JAVA,
    ".rs": Language.RUST,
    ".go": Language.GO,
}


@dataclass(frozen=True)
class Issue:
    """A single code review finding."""

    line: int
    severity: Severity
    category: str
    message: str
    suggestion: str | None = None

    def __lt__(self, other: Issue) -> bool:
        if self.severity.rank != other.severity.rank:
            return self.severity.rank < other.severity.rank
        return self.line < other.line


@dataclass
class FileAnalysis:
    """Parsed metadata about a source file before AI analysis."""

    path: str
    language: Language
    content: str
    line_count: int
    functions: list[str] = field(default_factory=list)
    classes: list[str] = field(default_factory=list)
    imports: list[str] = field(default_factory=list)
    complexity_estimate: str = "low"


@dataclass
class ReviewResult:
    """Complete review output for a single file."""

    file_path: str
    language: Language
    issues: list[Issue] = field(default_factory=list)
    score: float = 0.0
    summary: str = ""
    ai_model: str = ""
    cached: bool = False
    static_issues: list[Issue] = field(default_factory=list)
    ai_issues: list[Issue] = field(default_factory=list)

    @property
    def all_issues(self) -> list[Issue]:
        return sorted(self.static_issues + self.ai_issues)

    @property
    def critical_count(self) -> int:
        return sum(1 for i in self.all_issues if i.severity == Severity.CRITICAL)

    @property
    def warning_count(self) -> int:
        return sum(1 for i in self.all_issues if i.severity == Severity.WARNING)

    @property
    def suggestion_count(self) -> int:
        return sum(1 for i in self.all_issues if i.severity == Severity.SUGGESTION)
