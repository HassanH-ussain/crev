# CREV Web

Full documentation lives in the [repository root README](../README.md).

## Fastest start (Docker)

```bash
ANTHROPIC_API_KEY=sk-ant-... docker compose up --build
# → http://localhost:8080
```

## Dev mode

```bash
# Terminal 1 — backend (http://localhost:8000, docs at /docs)
cd backend
python -m venv venv && venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env   # add your ANTHROPIC_API_KEY
uvicorn server:app --reload --port 8000

# Terminal 2 — frontend (http://localhost:5173, proxies /api)
cd frontend
npm install
npm run dev
```

## Tests

```bash
cd backend
pytest -v
```
