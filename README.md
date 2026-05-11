# CREV Web — Full-Stack AI Code Review Platform

A full-stack web application that performs AI-powered code reviews. Built with **FastAPI** (backend) and **React + Vite** (frontend).

Users paste code → the backend runs static analysis + Claude AI review → results appear instantly in the browser.

## Architecture

```
┌──────────────────────────┐     ┌──────────────────────────┐
│       React Frontend      │     │     FastAPI Backend       │
│     (Vite dev server)     │────▶│                          │
│                          │     │  POST /api/scan           │
│  • Code editor with tabs │     │  POST /api/analyze        │
│  • File upload & drag/drop│     │  GET  /api/health         │
│  • Issue visualization   │     │                          │
│  • Score display         │     │  ┌────────────────────┐  │
│                          │     │  │   CREV Engine       │  │
│  Port 5173               │     │  │  • Parser           │  │
│                          │     │  │  • Static Analyzer  │  │
└──────────────────────────┘     │  │  • AI Engine ──────┼──┼──▶ Claude API
                                 │  │  • Cache            │  │
                                 │  └────────────────────┘  │
                                 │                          │
                                 │  Port 8000               │
                                 └──────────────────────────┘
```

**Key design decision:** The API key stays on the server. Users never see it.
The frontend talks to YOUR backend, which talks to Claude's API.

## Quick Start

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Mac/Linux
venv\Scripts\activate           # Windows

pip install -r requirements.txt

# Set your API key
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Start the server
uvicorn server:app --reload --port 8000
```

Visit http://localhost:8000/docs to see the auto-generated API docs.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Visit http://localhost:5173 — the frontend proxies API requests to the backend.

## API Endpoints

### `POST /api/scan`
Static analysis only. Free, instant, no API key needed.

```json
{
  "code": "def foo(items=[]):\n    pass",
  "filename": "main.py",
  "language": "python",
  "depth": "standard"
}
```

### `POST /api/analyze`
Full AI-powered review. Requires `ANTHROPIC_API_KEY` on the server.

Same request body as `/api/scan`.

### `GET /api/health`
Returns server status and whether AI is available.

```json
{
  "status": "ok",
  "version": "1.0.0",
  "ai_available": true
}
```

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend API | FastAPI | Async, auto-docs, type-safe, modern Python |
| Analysis Engine | CREV (custom) | Static + AI dual-layer pipeline |
| AI | Claude API (Anthropic) | Structured prompt → JSON response |
| Frontend | React 19 + Vite 6 | Fast dev server, hot reload, modern tooling |
| Styling | Inline CSS-in-JS | Zero dependencies, full control |

## Project Structure

```
crev-web/
├── backend/
│   ├── crev/                  # CREV analysis engine (reused from CLI)
│   │   ├── models.py          # Data classes (Issue, FileAnalysis, etc.)
│   │   ├── parser.py          # File reading, language detection
│   │   ├── static_analyzer.py # Rule-based checkers
│   │   ├── ai_engine.py       # Claude API integration
│   │   ├── cache.py           # SHA-256 content caching
│   │   └── config.py          # Layered configuration
│   ├── server.py              # FastAPI app with endpoints
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── main.jsx           # React entry point
│   │   ├── App.jsx            # Main application component
│   │   ├── api.js             # Backend API client
│   │   └── index.css          # Global styles
│   ├── index.html
│   ├── package.json
│   └── vite.config.js         # Proxy /api → FastAPI
└── README.md
```

## Interview Talking Points

- "I built both a CLI and web interface sharing the same analysis engine"
- "The backend uses FastAPI with Pydantic models for request validation"
- "API keys stay server-side — the frontend never touches secrets"
- "Vite proxies /api requests to FastAPI during development"
- "The dual-layer pipeline (static + AI) provides immediate feedback while AI processes"
- "I reused the CREV Python modules across CLI and web — same engine, different interfaces"

## License

MIT
