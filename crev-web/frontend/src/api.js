/**
 * CREV API Client
 *
 * Communicates with the FastAPI backend.
 * The API key stays server-side — the frontend never touches it.
 */

const API_BASE = "/api";

export async function checkHealth() {
  const res = await fetch(`${API_BASE}/health`);
  return res.json();
}

export async function scanCode({ code, filename, language, depth }) {
  const res = await fetch(`${API_BASE}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, filename, language, depth }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Scan failed");
  }

  return res.json();
}

export async function analyzeCode({ code, filename, language, depth }) {
  const res = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, filename, language, depth }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Analysis failed");
  }

  return res.json();
}
