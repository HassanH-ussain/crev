"""
AI engine module for CREV.

Orchestrates communication with Claude's API:
    - Builds structured prompts from FileAnalysis + static results
    - Handles token limits via intelligent code chunking
    - Parses structured AI responses into Issue objects
    - Implements retry logic and graceful degradation
"""

from __future__ import annotations

import json
import re

from anthropic import Anthropic, APIError, APITimeoutError, RateLimitError

from .config import CrevConfig
from .models import FileAnalysis, Issue, ReviewResult, Severity

SYSTEM_PROMPT = (
    "You are CREV, an expert code reviewer. You analyze source code and produce "
    "structured, actionable feedback. You are thorough but practical — you prioritize "
    "issues that matter in production.\n\n"
    "RESPONSE FORMAT — You MUST respond with ONLY valid JSON matching this schema:\n"
    "{\n"
    '  "score": <float 0.0-10.0>,\n'
    '  "summary": "<1-2 sentence overall assessment>",\n'
    '  "issues": [\n'
    "    {\n"
    '      "line": <int>,\n'
    '      "severity": "critical" | "warning" | "suggestion" | "info",\n'
    '      "category": "bug" | "security" | "performance" | "style" '
    '| "error-handling" | "naming" | "documentation" | "architecture",\n'
    '      "message": "<clear description of the problem>",\n'
    '      "suggestion": "<specific actionable fix>"\n'
    "    }\n"
    "  ]\n"
    "}\n\n"
    "RULES:\n"
    "- Return ONLY JSON. No markdown, no backticks, no preamble.\n"
    "- Every issue MUST have a specific line number.\n"
    "- Suggestions must be concrete and actionable.\n"
    "- Score: 9-10 excellent, 7-8 good, 5-6 needs work, 3-4 significant issues, 0-2 critical.\n"
    "- Focus on issues that would matter in a real code review at a top tech company.\n"
)


def _build_review_prompt(
    analysis: FileAnalysis,
    config: CrevConfig,
    static_issues: list[Issue],
) -> str:
    numbered_lines = []
    for i, line in enumerate(analysis.content.splitlines(), 1):
        numbered_lines.append(f"{i:>4} | {line}")
    numbered_code = "\n".join(numbered_lines)

    static_context = ""
    if static_issues:
        items = []
        for issue in static_issues[:10]:
            items.append(
                f"  - Line {issue.line}: [{issue.severity.value}] {issue.message}"
            )
        static_context = (
            "\n\nPRE-IDENTIFIED ISSUES (from static analysis):\n"
            + "\n".join(items)
        )

    structure = []
    if analysis.functions:
        structure.append(f"Functions: {', '.join(analysis.functions[:20])}")
    if analysis.classes:
        structure.append(f"Classes: {', '.join(analysis.classes[:20])}")
    structure_text = "\n".join(structure) if structure else "No major structures detected."

    return (
        f"Review the following {analysis.language.value} code.\n\n"
        f"FILE: {analysis.path}\n"
        f"LINES: {analysis.line_count}\n"
        f"COMPLEXITY: {analysis.complexity_estimate}\n"
        f"STRUCTURE:\n{structure_text}"
        f"{static_context}\n\n"
        f"ANALYSIS DEPTH: {config.depth}\n"
        f"{config.depth_prompt_modifier()}\n\n"
        f"SOURCE CODE:\n```{analysis.language.value}\n{numbered_code}\n```"
    )


def _chunk_code(content: str, max_lines: int = 300) -> list[str]:
    lines = content.splitlines()
    if len(lines) <= max_lines:
        return [content]

    chunks: list[str] = []
    current_chunk: list[str] = []

    for _i, line in enumerate(lines):
        current_chunk.append(line)

        if len(current_chunk) >= max_lines:
            break_point = len(current_chunk)
            for j in range(len(current_chunk) - 1, max(len(current_chunk) - 30, 0), -1):
                candidate = current_chunk[j].strip()
                if (
                    not candidate
                    or candidate.startswith(("class ", "def ", "function ", "fn "))
                    or candidate.startswith(("} //", "};"))
                ):
                    break_point = j
                    break

            chunks.append("\n".join(current_chunk[:break_point]))
            current_chunk = current_chunk[break_point:]

    if current_chunk:
        chunks.append("\n".join(current_chunk))

    return chunks


_SEVERITY_MAP = {
    "critical": Severity.CRITICAL,
    "warning": Severity.WARNING,
    "suggestion": Severity.SUGGESTION,
    "info": Severity.INFO,
}


def _parse_ai_response(raw: str) -> tuple[float, str, list[Issue]]:
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    cleaned = cleaned.strip()

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        fixed = re.sub(r",\s*([}\]])", r"\1", cleaned)
        try:
            data = json.loads(fixed)
        except json.JSONDecodeError:
            return 5.0, "AI response could not be parsed.", []

    score = float(data.get("score", 5.0))
    summary = data.get("summary", "")
    issues: list[Issue] = []

    for item in data.get("issues", []):
        try:
            issues.append(Issue(
                line=int(item.get("line", 0)),
                severity=_SEVERITY_MAP.get(
                    item.get("severity", "info"), Severity.INFO
                ),
                category=item.get("category", "general"),
                message=item.get("message", ""),
                suggestion=item.get("suggestion"),
            ))
        except (TypeError, ValueError):
            continue

    return score, summary, issues


def analyze_with_ai(
    analysis: FileAnalysis,
    config: CrevConfig,
    static_issues: list[Issue] | None = None,
) -> ReviewResult:
    """Send code to Claude for AI-powered review."""
    if not config.is_configured:
        return ReviewResult(
            file_path=analysis.path,
            language=analysis.language,
            summary="⚠ No API key configured. Run: crev config --set api_key YOUR_KEY",
            static_issues=static_issues or [],
        )

    client = Anthropic(api_key=config.api_key)
    static_issues = static_issues or []

    chunks = _chunk_code(analysis.content)
    all_ai_issues: list[Issue] = []
    final_score = 0.0
    final_summary = ""

    for _i, chunk in enumerate(chunks):
        chunk_analysis = FileAnalysis(
            path=analysis.path,
            language=analysis.language,
            content=chunk,
            line_count=len(chunk.splitlines()),
            functions=analysis.functions,
            classes=analysis.classes,
            imports=analysis.imports,
            complexity_estimate=analysis.complexity_estimate,
        )

        prompt = _build_review_prompt(chunk_analysis, config, static_issues)

        try:
            response = client.messages.create(
                model=config.model,
                max_tokens=config.max_tokens,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )

            raw_content = response.content[0].text
            score, summary, issues = _parse_ai_response(raw_content)

            all_ai_issues.extend(issues)
            final_score = score
            final_summary = summary

        except RateLimitError:
            return ReviewResult(
                file_path=analysis.path,
                language=analysis.language,
                summary="⚠ Rate limited by API. Please wait and try again.",
                static_issues=static_issues,
                ai_model=config.model,
            )
        except APITimeoutError:
            return ReviewResult(
                file_path=analysis.path,
                language=analysis.language,
                summary="⚠ API request timed out. Try again later.",
                static_issues=static_issues,
                ai_model=config.model,
            )
        except APIError as e:
            return ReviewResult(
                file_path=analysis.path,
                language=analysis.language,
                summary=f"⚠ API error: {e.message}",
                static_issues=static_issues,
                ai_model=config.model,
            )

    return ReviewResult(
        file_path=analysis.path,
        language=analysis.language,
        issues=all_ai_issues,
        score=final_score,
        summary=final_summary,
        ai_model=config.model,
        static_issues=static_issues,
        ai_issues=all_ai_issues,
    )
