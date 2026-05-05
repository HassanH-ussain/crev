/**
 * CREV API Client
 *
 * Communicates with the FastAPI backend.
 * The API key stays server-side — the frontend never touches it.
 */

const API_BASE = "/api";
const TIMEOUT_MS = 90_000;

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timerId)
  );
}

export async function checkHealth() {
  const res = await fetchWithTimeout(`${API_BASE}/health`);
  return res.json();
}

export async function scanCode({ code, filename, language, depth }) {
  let res;
  try {
    res = await fetchWithTimeout(`${API_BASE}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, filename, language, depth }),
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Request timed out after 90 seconds.");
    throw e;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Scan failed (HTTP ${res.status})`);
  }

  return res.json();
}

export async function analyzeCode({ code, filename, language, depth }) {
  let res;
  try {
    res = await fetchWithTimeout(`${API_BASE}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, filename, language, depth }),
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Request timed out after 90 seconds. Try a smaller file or use Quick depth.");
    throw e;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Analysis failed (HTTP ${res.status})`);
  }

  return res.json();
}
