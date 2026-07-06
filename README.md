# CREV — AI-Powered Code Review Platform

[![CI](https://github.com/HassanH-ussain/crev/actions/workflows/ci.yml/badge.svg)](https://github.com/HassanH-ussain/crev/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/Python-3.12+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Docker](https://img.shields.io/badge/Docker-compose-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

A full-stack web application that reviews code the way a senior engineer would: **instant rule-based static analysis** for the obvious problems, plus **Claude AI deep review** for the subtle ones — bugs, security holes, performance traps, and design smells, each pinned to an exact line with a concrete fix.

Paste code (or drag files in) → get a scored, categorized review in seconds.

## Try It Live

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/HassanH-ussain/crev)

The repo ships a [Render Blueprint](render.yaml) — click the button, connect GitHub, paste an `ANTHROPIC_API_KEY`, and Render stands up both services on its free tier with a public URL. (Free-tier services sleep when idle; the first request after a quiet period takes ~50 s to wake.)

## Highlights

- **IDE-grade editor** — custom zero-dependency syntax highlighter (One Dark tokens, all 8 languages), line-number gutter with issue markers, status bar with live cursor position, Tab indentation, and Ctrl+Enter to scan
- **Interactive reviews** — click any finding to jump to the offending line with a flash highlight; click a severity count to filter the list
- **Dual-layer analysis pipeline** — 8 rule-based static checkers (hardcoded secrets, mutable default args, bare `except`, oversized functions, and more) run instantly and for free; Claude AI performs the deep review with a 0–10 quality score
- **8 languages** — Python, JavaScript, TypeScript, C++, C, Java, Rust, Go, with automatic detection from filename *or* code content
- **Server-side API key** — the browser never sees credentials; the frontend talks only to the FastAPI backend
- **Smart caching** — AI results are cached for 24 h keyed by SHA-256 of the code + review depth, so repeat reviews are instant and cost nothing
- **Production-ready** — containerized with Docker, tested with a 56-test pytest suite, built and verified by GitHub Actions CI on every push
- **Multi-file workspace** — tabbed editor with drag-and-drop upload, batch "Scan All" / "AI All", and localStorage persistence across refreshes

## Quick Start (Docker — recommended)

The whole stack starts with one command:

```bash
cd crev-web
ANTHROPIC_API_KEY=sk-ant-... docker compose up --build
```

Open **http://localhost:8080** — done.

No API key? It still works: static analysis is free and instant; only the AI Analyze button is disabled. You can also put the key in `crev-web/backend/.env` (copy `.env.example`) instead of passing it inline.

## Architecture

```
┌───────────────────────────┐      ┌────────────────────────────────┐
│     React 19 Frontend     │      │        FastAPI Backend         │
│    (nginx, port 8080)     │─────▶│         (port 8000)            │
│                           │ /api │                                │
│  • Tabbed code editor     │      │  POST /api/scan     (static)   │
│  • Drag & drop upload     │      │  POST /api/analyze  (AI)       │
│  • Issue visualization    │      │  GET  /api/health              │
│  • Quality score display  │      │                                │
│  • Bug tracker/changelog  │      │  ┌──────────────────────────┐  │
└───────────────────────────┘      │  │       CREV Engine        │  │
                                   │  │  parser → static checks  │  │
        nginx proxies /api ───────▶│  │     ↘ cache (SHA-256)    │  │
        to the backend container   │  │     ↘ AI engine ─────────┼──┼──▶ Claude API
                                   │  └──────────────────────────┘  │
                                   └────────────────────────────────┘
```

**Key design decisions**

| Decision | Why |
|----------|-----|
| API key stays server-side | The frontend never touches secrets — it can be hosted anywhere safely |
| Sync endpoints in FastAPI's threadpool | An AI review can take 30+ seconds; running it off the event loop keeps the server responsive for concurrent users |
| In-memory parsing (`parse_source`) | No temp-file round trip per request — faster, and no filesystem cleanup edge cases |
| SHA-256 content caching with 24 h TTL | Identical code + depth → instant cached response, zero API cost |
| Code chunking at ~300 lines | Large files are split at function/class boundaries to stay within token limits |
| Static analysis feeds the AI prompt | Pre-identified issues give Claude context, reducing duplicate findings |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend API | FastAPI + Pydantic (request validation, auto-generated OpenAPI docs at `/docs`) |
| Analysis engine | CREV (custom Python package: parser, static analyzer, AI engine, cache, config) |
| AI | Claude API (`claude-opus-4-8` by default, configurable via `CREV_MODEL`) |
| Frontend | React 19 + Vite 6 |
| Serving | nginx (static assets + `/api` reverse proxy) |
| Packaging | Docker multi-stage builds + docker-compose |
| CI | GitHub Actions — pytest suite, frontend build, Docker image builds |

## Local Development (without Docker)

**Backend**

```bash
cd crev-web/backend
python -m venv venv
venv\Scripts\activate          # Windows  (source venv/bin/activate on Mac/Linux)
pip install -r requirements-dev.txt
cp .env.example .env           # add your ANTHROPIC_API_KEY
uvicorn server:app --reload --port 8000
```

Interactive API docs: http://localhost:8000/docs

**Frontend**

```bash
cd crev-web/frontend
npm install
npm run dev
```

Visit http://localhost:5173 — Vite proxies `/api` to the backend.

## Tests

```bash
cd crev-web/backend
pip install -r requirements-dev.txt
pytest -v
```

56 tests cover the parser, every static checker, AI response parsing (including malformed-JSON recovery), the cache (round-trip, expiry, corruption eviction), and the HTTP API end-to-end via FastAPI's `TestClient` — including a test proving cached AI results are served without touching the Claude API. The suite already caught one real bug: the secret detector missed hyphenated key formats like `sk-ant-...` (fixed in v1.1.0, guarded by a regression test).

## API Reference

### `POST /api/scan` — static analysis (free, instant, no key needed)

```json
{
  "code": "def foo(items=[]):\n    pass",
  "filename": "main.py",
  "language": "python",
  "depth": "standard"
}
```

### `POST /api/analyze` — full AI review (requires server-side key)

Same request body. Responses include a 0–10 `score`, a `summary`, per-issue `line`/`severity`/`category`/`message`/`suggestion`, and a `cached` flag.

### `GET /api/health`

```json
{ "status": "ok", "version": "1.1.0", "ai_available": true }
```

Limits: payloads over 500 KB → `413`; empty code → `422`; missing key on `/api/analyze` → `503`.

## Project Structure

```
crev/
├── .github/workflows/ci.yml   # CI: tests + builds on every push
├── render.yaml                 # one-click Render deployment blueprint
└── crev-web/
    ├── docker-compose.yml      # one-command startup
    ├── backend/
    │   ├── crev/               # CREV analysis engine
    │   │   ├── models.py       # typed data model (Issue, FileAnalysis, ReviewResult)
    │   │   ├── parser.py       # language detection + structural extraction
    │   │   ├── static_analyzer.py  # pluggable rule-based checkers
    │   │   ├── ai_engine.py    # Claude integration: prompts, chunking, parsing
    │   │   ├── cache.py        # SHA-256 keyed 24h result cache
    │   │   └── config.py       # layered config (env > file > defaults)
    │   ├── server.py           # FastAPI app
    │   ├── tests/              # 56-test pytest suite
    │   └── Dockerfile          # slim non-root image with healthcheck
    └── frontend/
        ├── src/
        │   ├── App.jsx         # workspace: tabs, results, bug tracker, changelog
        │   ├── CodeEditor.jsx  # overlay editor: highlight layer + transparent input
        │   ├── highlight.js    # zero-dependency syntax highlighter (8 languages)
        │   └── api.js          # backend client with timeouts
        ├── nginx.conf          # static serving + /api reverse proxy
        └── Dockerfile          # multi-stage: node build → nginx
```

## Deploying

**Render (recommended, free):** the [render.yaml](render.yaml) blueprint deploys everything — a Docker web service for the backend and a static site for the frontend, with `/api` rewritten to the backend so no CORS configuration is needed. Use the "Deploy to Render" button above, or in the Render dashboard choose *New → Blueprint* and point it at this repo. The only secret you enter is `ANTHROPIC_API_KEY`.

**Any Docker host** (a $5 VPS, AWS Lightsail, DigitalOcean): the compose file runs as-is. For other PaaS platforms (Railway, Fly.io), deploy the two Dockerfiles as separate services and set:

- `ANTHROPIC_API_KEY` on the backend
- `FRONTEND_URL=https://your-frontend-domain` on the backend (added to CORS allowlist)
- Point the frontend's `/api` proxy at the backend's URL (edit `nginx.conf`'s `proxy_pass`)

## License

MIT
