"""
CREV Web API — FastAPI backend for AI-powered code review.

This server wraps the CREV analysis engine behind REST endpoints.
The API key stays server-side — users never see it.

Endpoints:
    POST /api/scan     — Static analysis only (free, instant)
    POST /api/analyze  — AI-powered review (uses Claude API)
    GET  /api/health   — Health check
"""

from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from crev.config import load_config
from crev.models import Language
from crev.parser import parse_file, detect_language
from crev.static_analyzer import run_static_analysis
from crev.ai_engine import analyze_with_ai

load_dotenv()

app = FastAPI(
    title="CREV API",
    description="AI-Powered Code Review — paste code, find bugs",
    version="1.0.0",
)

# CORS — allow frontend dev server and production
origins = [
    "http://localhost:5173",    # Vite dev server
    "http://localhost:3000",    # Alternative dev port
    "http://127.0.0.1:5173",
]

# Add production URL if set
prod_url = os.getenv("FRONTEND_URL")
if prod_url:
    origins.append(prod_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request/Response Models ───────────────────────────────────────────

class ReviewRequest(BaseModel):
    """What the frontend sends to us."""
    code: str
    filename: str = "untitled.py"
    language: str | None = None       # auto-detect if not provided
    depth: str = "standard"           # quick | standard | full


class IssueResponse(BaseModel):
    """A single code review finding."""
    line: int
    severity: str
    category: str
    message: str
    suggestion: str | None = None


class ReviewResponse(BaseModel):
    """What we send back to the frontend."""
    filename: str
    language: str
    score: float | None = None
    summary: str
    issues: list[IssueResponse]
    mode: str                          # "scan" or "analyze"
    duration_ms: int
    issue_counts: dict[str, int]


# ── Helper ────────────────────────────────────────────────────────────

def _resolve_language(code: str, filename: str, lang_override: str | None) -> str:
    """Determine language from override, filename, or code content."""
    if lang_override and lang_override != "auto":
        return lang_override
    return detect_language(filename).value


def _run_review(req: ReviewRequest, use_ai: bool) -> ReviewResponse:
    """Core review logic shared by /scan and /analyze."""
    start = time.time()

    language_str = _resolve_language(req.code, req.filename, req.language)

    # Write code to a temp file so the parser can read it
    suffix_map = {
        "python": ".py", "javascript": ".js", "typescript": ".ts",
        "cpp": ".cpp", "c": ".c", "java": ".java", "rust": ".rs", "go": ".go",
    }
    suffix = suffix_map.get(language_str, ".py")

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=suffix, delete=False, encoding="utf-8"
    ) as f:
        f.write(req.code)
        temp_path = f.name

    try:
        analysis = parse_file(temp_path)
        static_issues = run_static_analysis(analysis)

        if use_ai:
            config = load_config(depth=req.depth)
            if not config.is_configured:
                raise HTTPException(
                    status_code=503,
                    detail="No API key configured on the server. Set ANTHROPIC_API_KEY in .env",
                )
            result = analyze_with_ai(analysis, config, static_issues)
            score = result.score
            summary = result.summary
            all_issues = result.all_issues
            mode = "analyze"
        else:
            score = None
            summary = "Static analysis only. Use AI Analyze for a deeper review."
            all_issues = static_issues
            mode = "scan"

    finally:
        Path(temp_path).unlink(missing_ok=True)

    duration_ms = int((time.time() - start) * 1000)

    issues_out = [
        IssueResponse(
            line=i.line,
            severity=i.severity.value,
            category=i.category,
            message=i.message,
            suggestion=i.suggestion,
        )
        for i in all_issues
    ]

    counts = {
        "critical": sum(1 for i in issues_out if i.severity == "critical"),
        "warning": sum(1 for i in issues_out if i.severity == "warning"),
        "suggestion": sum(1 for i in issues_out if i.severity == "suggestion"),
        "info": sum(1 for i in issues_out if i.severity == "info"),
    }

    return ReviewResponse(
        filename=req.filename,
        language=language_str,
        score=score,
        summary=summary,
        issues=issues_out,
        mode=mode,
        duration_ms=duration_ms,
        issue_counts=counts,
    )


# ── Endpoints ─────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    """Health check — also reports if AI is available."""
    config = load_config()
    return {
        "status": "ok",
        "version": "1.0.0",
        "ai_available": config.is_configured,
    }


@app.post("/api/scan", response_model=ReviewResponse)
async def scan_code(req: ReviewRequest):
    """Run static analysis only — free, instant, no API key needed."""
    return _run_review(req, use_ai=False)


@app.post("/api/analyze", response_model=ReviewResponse)
async def analyze_code(req: ReviewRequest):
    """Run full AI-powered review — requires server-side API key."""
    return _run_review(req, use_ai=True)
