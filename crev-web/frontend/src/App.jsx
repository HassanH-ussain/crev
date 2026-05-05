import { useState, useRef, useEffect, useCallback } from "react";
import { scanCode, analyzeCode, checkHealth } from "./api";
import "./index.css";

// ── Issue severity display config ───────────────────────────────────────

const SEVERITY = {
  critical:   { color: "#ff4757", icon: "●", bg: "rgba(255,71,87,0.08)",   border: "rgba(255,71,87,0.25)" },
  warning:    { color: "#ffa502", icon: "●", bg: "rgba(255,165,2,0.08)",   border: "rgba(255,165,2,0.25)" },
  suggestion: { color: "#3742fa", icon: "●", bg: "rgba(55,66,250,0.08)",   border: "rgba(55,66,250,0.25)" },
  info:       { color: "#a4b0be", icon: "●", bg: "rgba(164,176,190,0.06)", border: "rgba(164,176,190,0.2)" },
};

const SEV_COLOR = {
  critical: { color: "#ff4757", bg: "rgba(255,71,87,0.12)" },
  high:     { color: "#ff6348", bg: "rgba(255,99,72,0.12)" },
  medium:   { color: "#ffa502", bg: "rgba(255,165,2,0.12)" },
  low:      { color: "#a4b0be", bg: "rgba(164,176,190,0.1)" },
};

const STATUS_STYLE = {
  open:          { color: "#ff4757", bg: "rgba(255,71,87,0.12)",   label: "Open" },
  fixed:         { color: "#2ed573", bg: "rgba(46,213,115,0.12)",  label: "Fixed" },
  "in-progress": { color: "#ffa502", bg: "rgba(255,165,2,0.12)",   label: "In Progress" },
  wontfix:       { color: "#636e72", bg: "rgba(99,110,114,0.12)",  label: "Won't Fix" },
};

const LANGUAGES = ["auto", "python", "javascript", "typescript", "cpp", "c", "java", "rust", "go"];

const EXT_MAP = {
  py: "python", js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
  cpp: "cpp", cc: "cpp", h: "c", c: "c", java: "java", rs: "rust", go: "go",
};

// ── Demo code ───────────────────────────────────────────────────────────

const SAMPLE_CODE = `"""Sample file with intentional issues for CREV demo."""

import os
import sys
import json
import time  # unused import

api_key = "sk-ant-1234567890abcdef"  # hardcoded secret!


def process_data(items=[], verbose=True):
    """Process a list of items."""
    results = []
    for i in range(len(items)):
        item = items[i]
        if item == None:
            continue
        print(f"Processing: {item}")
        try:
            processed = transform(item)
            results.append(processed)
        except:
            print("something went wrong")
            pass
    return results


# TODO: refactor this entire function
def transform(data):
    if type(data) == str:
        return data.upper()
    elif type(data) == int:
        return data * 2


def fetch_user(id):
    # FIXME: SQL injection vulnerability
    query = f"SELECT * FROM users WHERE id = {id}"
    password = "admin123"
    return {"query": query, "auth": password}`;

// ── Known bugs data ─────────────────────────────────────────────────────

const KNOWN_BUGS = [
  {
    id: "CREV-007",
    title: "Backend accepts arbitrarily large request bodies",
    status: "fixed",
    severity: "high",
    category: "Security",
    reported: "2025-05-03",
    affectedVersion: "1.0.0",
    description:
      "The /api/scan and /api/analyze endpoints accepted arbitrarily large request bodies. A malicious user could submit multi-megabyte payloads, exhausting server memory and degrading response times for all concurrent users.",
    steps: [
      "Send a POST request to /api/scan with a code string exceeding 500 KB",
      "Observe the server processes the entire payload without rejecting it",
      "Note elevated memory usage and slow response time during processing",
    ],
    resolution:
      "Added a 500 KB hard limit in both /api/scan and /api/analyze. Oversized payloads now receive an HTTP 413 response with a descriptive error before any processing begins.",
    fixedIn: "1.0.1",
  },
  {
    id: "CREV-004",
    title: "AI Analyze requests have no client-side timeout",
    status: "fixed",
    severity: "high",
    category: "Network",
    reported: "2025-05-01",
    affectedVersion: "1.0.0",
    description:
      "The AI Analyze flow did not set an AbortController timeout. If the FastAPI backend stalled or the Claude API was slow to respond, the UI hung in a loading state indefinitely with no way for the user to cancel or recover.",
    steps: [
      "Enable AI Analyze (requires ANTHROPIC_API_KEY configured on the server)",
      "Submit a 300+ line file for analysis",
      "Simulate a network stall or disconnect mid-request",
      "Observe: the loading spinner never stopped and no error message appeared",
    ],
    resolution:
      "Added a 90-second AbortController timeout in api.js wrapping all fetch calls. AbortError is caught and surfaced as a human-readable message: 'Request timed out after 90 seconds. Try a smaller file or use Quick depth.'",
    fixedIn: "1.0.1",
  },
  {
    id: "CREV-003",
    title: "Uploaded files retain AUTO language label after detection",
    status: "fixed",
    severity: "low",
    category: "UX",
    reported: "2025-05-02",
    affectedVersion: "1.0.0",
    description:
      "When a file was uploaded via drag-and-drop or the file picker, the language selector in the editor toolbar continued to display 'AUTO'. The backend correctly identified the language from the file extension, but the detected value was never written back to the file's language field in frontend state.",
    steps: [
      "Drag a .rs (Rust) file into the editor drop zone",
      "Observe the language selector still shows AUTO after the file loads",
      "Click 'Scan File' — results correctly identify Rust as the detected language",
      "The mismatch is confusing: the UI says AUTO but results say Rust",
    ],
    resolution:
      "In handleUpload(), the detected language is now looked up from EXT_MAP using the file extension and written directly onto the new file object before it is added to state. The language selector now correctly reflects the auto-detected language.",
    fixedIn: "1.0.1",
  },
  {
    id: "CREV-001",
    title: "Results panel height was hardcoded to 500px",
    status: "open",
    severity: "medium",
    category: "UI/UX",
    reported: "2025-05-01",
    affectedVersion: "1.0.0",
    description:
      "The results panel used a fixed maxHeight of 500px via inline style. Files with many issues (20+) required scrolling inside a constrained sub-panel rather than using the natural page scroll, making dense results feel cramped.",
    steps: [
      "Load a file that generates 20 or more issues (e.g. a large Python file with many bare excepts and TODO comments)",
      "Click 'Scan File'",
      "Observe the results panel cuts off at approximately 500px",
      "Note that the user must scroll inside a small panel window",
    ],
    resolution: null,
    fixedIn: null,
  },
  {
    id: "CREV-005",
    title: "AI response parsing failed on non-JSON prefixed responses",
    status: "fixed",
    severity: "high",
    category: "Backend",
    reported: "2025-04-28",
    affectedVersion: "1.0.0",
    description:
      "Claude AI occasionally prefixes its JSON response with explanatory prose (e.g. 'Here is the review:'). The original parser used a direct json.loads() call that failed on such responses, silently returning an empty issues list to the frontend.",
    steps: [
      "Submit code that triggers a verbose Claude response (complex files tend to elicit this)",
      "Observe the results panel shows 0 issues despite the AI responding successfully",
      "Check server logs — the raw AI output begins with prose text before the JSON block",
    ],
    resolution:
      "Added regex-based JSON object extraction in ai_engine.py that strips leading and trailing prose before parsing. If JSON extraction still fails, the function falls back gracefully to static-only results and logs the raw response at WARNING level for debugging.",
    fixedIn: "1.0.0",
  },
  {
    id: "CREV-006",
    title: "CORS only allowed hardcoded localhost origins",
    status: "fixed",
    severity: "medium",
    category: "Backend",
    reported: "2025-04-29",
    affectedVersion: "1.0.0",
    description:
      "The FastAPI CORS middleware was configured with only http://localhost:5173 and http://localhost:3000. Deploying the frontend to any remote domain caused all API requests to be blocked with CORS errors.",
    steps: [
      "Deploy the backend to a remote server",
      "Access the frontend from a non-localhost origin (e.g. https://crev.example.com)",
      "Open the browser DevTools Network panel — all /api/* requests are blocked by CORS",
    ],
    resolution:
      "Added FRONTEND_URL environment variable support in server.py. If the variable is set at startup, its value is appended to the allowed origins list, enabling production deployments without modifying source code.",
    fixedIn: "1.0.0",
  },
];

// ── Changelog data ──────────────────────────────────────────────────────

const CHANGELOG = [
  {
    version: "1.0.1",
    date: "2025-05-05",
    label: "Bug Fix Release",
    changes: [
      { type: "fix",  text: "Backend now rejects payloads over 500 KB with HTTP 413 (CREV-007)" },
      { type: "fix",  text: "All fetch calls have a 90-second AbortController timeout; clean error on stall (CREV-004)" },
      { type: "fix",  text: "Uploaded files now show the auto-detected language in the editor toolbar (CREV-003)" },
      { type: "feat", text: "Bug Tracker view with status/severity filtering and expand-to-detail cards" },
      { type: "feat", text: "Changelog view with categorised release history" },
      { type: "feat", text: "Editor files are persisted to localStorage — work survives page refreshes" },
      { type: "feat", text: "Workspace reset link in footer to clear saved state" },
      { type: "feat", text: "Button hover lift animation and consistent CSS class system" },
    ],
  },
  {
    version: "1.0.0",
    date: "2025-05-01",
    label: "Initial Release",
    changes: [
      { type: "feat", text: "Multi-file tabbed editor with drag-and-drop upload support" },
      { type: "feat", text: "Dual-layer analysis: instant static checks + Claude AI deep review" },
      { type: "feat", text: "8 built-in static checkers (secrets, bare except, mutable defaults, TODO/FIXME, and more)" },
      { type: "feat", text: "Analysis depth selector: Quick / Standard / Full prompt modes" },
      { type: "feat", text: "Quality score (0–10) with colour-coded progress bar for AI reviews" },
      { type: "feat", text: "Batch processing: Scan All and AI All for multi-file sessions" },
      { type: "feat", text: "Language support: Python, JavaScript, TypeScript, C++, C, Java, Rust, Go" },
      { type: "feat", text: "Server-side API key — credentials never exposed to the browser" },
      { type: "feat", text: "Code chunking for large files (300+ lines) to stay within token limits" },
      { type: "feat", text: "24-hour result caching with SHA-256 content hashing" },
      { type: "fix",  text: "AI JSON parsing hardened against prose-prefixed responses (CREV-005)" },
      { type: "fix",  text: "CORS allows production URL via FRONTEND_URL env var (CREV-006)" },
    ],
  },
];

// ── File state helpers ──────────────────────────────────────────────────

let fileId = 1;
const mkFile = (name, code, language = "auto") => ({ id: fileId++, name, code, language, results: null });

function loadSavedState() {
  try {
    const raw = localStorage.getItem("crev-files-v1");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        fileId = Math.max(...parsed.map((f) => f.id)) + 1;
        return parsed;
      }
    }
  } catch {}
  return null;
}

// ── Badge component ─────────────────────────────────────────────────────

function Badge({ text, color, bg }) {
  return (
    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 10, background: bg, color, border: `1px solid ${color}22` }}>
      {text}
    </span>
  );
}

// ── BugCard component ───────────────────────────────────────────────────

function BugCard({ bug }) {
  const [expanded, setExpanded] = useState(false);
  const st = STATUS_STYLE[bug.status] || STATUS_STYLE.open;
  const sv = SEV_COLOR[bug.severity] || SEV_COLOR.medium;

  return (
    <div className="bug-card">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: "#ffa502", fontWeight: 700, letterSpacing: "0.06em" }}>{bug.id}</span>
            <Badge text={st.label} color={st.color} bg={st.bg} />
            <Badge text={bug.severity} color={sv.color} bg={sv.bg} />
            <span style={{ fontSize: 9, color: "#3d3d50", padding: "2px 6px", background: "#14141f", borderRadius: 4, border: "1px solid #1e1e2e" }}>{bug.category}</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e8e6e3", marginBottom: 4, lineHeight: 1.35 }}>{bug.title}</div>
          <div style={{ fontSize: 10, color: "#636e72" }}>Reported {bug.reported} · v{bug.affectedVersion}</div>
        </div>
        <button onClick={() => setExpanded((x) => !x)} className="expand-btn">{expanded ? "▲" : "▼"}</button>
      </div>

      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #1e1e2e", animation: "slideDown 0.15s ease" }}>
          <p style={{ fontSize: 11, color: "#a4b0be", lineHeight: 1.65, marginBottom: 14 }}>{bug.description}</p>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#636e72", marginBottom: 6 }}>Steps to Reproduce</div>
            <ol style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
              {bug.steps.map((step, i) => (
                <li key={i} style={{ fontSize: 11, color: "#a4b0be", lineHeight: 1.55 }}>{step}</li>
              ))}
            </ol>
          </div>

          {bug.resolution ? (
            <div style={{ padding: "10px 12px", background: "rgba(46,213,115,0.06)", border: "1px solid rgba(46,213,115,0.2)", borderRadius: 7 }}>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#2ed573", marginBottom: 5 }}>
                Resolution · Fixed in v{bug.fixedIn}
              </div>
              <p style={{ fontSize: 11, color: "#a4b0be", lineHeight: 1.65 }}>{bug.resolution}</p>
            </div>
          ) : (
            <div style={{ padding: "8px 12px", background: "rgba(255,71,87,0.05)", border: "1px solid rgba(255,71,87,0.15)", borderRadius: 7, fontSize: 10, color: "#636e72" }}>
              No fix available yet. Contributions welcome.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── BugTracker view ─────────────────────────────────────────────────────

function BugTracker() {
  const [statusFilter, setSF] = useState("all");
  const [severityFilter, setSeF] = useState("all");

  const filtered = KNOWN_BUGS.filter((b) => {
    if (statusFilter !== "all" && b.status !== statusFilter) return false;
    if (severityFilter !== "all" && b.severity !== severityFilter) return false;
    return true;
  });

  const openCount   = KNOWN_BUGS.filter((b) => b.status === "open").length;
  const fixedCount  = KNOWN_BUGS.filter((b) => b.status === "fixed").length;

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      <div style={{ marginBottom: 18, display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#e8e6e3", marginBottom: 3 }}>Bug Tracker</div>
          <div style={{ fontSize: 10, color: "#636e72" }}>
            <span style={{ color: "#ff4757" }}>{openCount} open</span>
            {" · "}
            <span style={{ color: "#2ed573" }}>{fixedCount} fixed</span>
            {" · "}
            {KNOWN_BUGS.length} total
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 2 }}>
            {["all", "open", "fixed", "in-progress", "wontfix"].map((s) => (
              <button key={s} onClick={() => setSF(s)} className={`filter-btn ${statusFilter === s ? "active" : ""}`}>
                {s === "all" ? "All" : STATUS_STYLE[s]?.label || s}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 2 }}>
            {["all", "critical", "high", "medium", "low"].map((s) => (
              <button key={s} onClick={() => setSeF(s)} className={`filter-btn ${severityFilter === s ? "active" : ""}`}>
                {s === "all" ? "All Severity" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#636e72", fontSize: 12, border: "1px dashed #1e1e2e", borderRadius: 8 }}>
          No bugs match the selected filters.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((bug) => <BugCard key={bug.id} bug={bug} />)}
        </div>
      )}
    </div>
  );
}

// ── Changelog view ──────────────────────────────────────────────────────

function ChangelogView() {
  const typeStyle = {
    feat:  { color: "#2ed573", bg: "rgba(46,213,115,0.1)",  label: "feat" },
    fix:   { color: "#ffa502", bg: "rgba(255,165,2,0.1)",   label: "fix" },
    chore: { color: "#636e72", bg: "rgba(99,110,114,0.1)",  label: "chore" },
  };

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#e8e6e3", marginBottom: 3 }}>Changelog</div>
        <div style={{ fontSize: 10, color: "#636e72" }}>Version history and release notes</div>
      </div>

      {CHANGELOG.map((release) => (
        <div key={release.version} style={{ marginBottom: 16, padding: 16, background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#e8e6e3" }}>v{release.version}</span>
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: "rgba(55,66,250,0.15)", color: "#3742fa", fontWeight: 700 }}>
              {release.label}
            </span>
            <span style={{ fontSize: 10, color: "#636e72", marginLeft: "auto" }}>{release.date}</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {release.changes.map((c, i) => {
              const ts = typeStyle[c.type] || typeStyle.chore;
              return (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.05em", padding: "2px 5px", borderRadius: 4, background: ts.bg, color: ts.color, flexShrink: 0, marginTop: 2 }}>
                    {ts.label}
                  </span>
                  <span style={{ fontSize: 11, color: "#a4b0be", lineHeight: 1.55 }}>{c.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main App ────────────────────────────────────────────────────────────

export default function App() {
  const savedFiles = loadSavedState();
  const [files, setFiles] = useState(savedFiles || [mkFile("buggy_example.py", SAMPLE_CODE)]);
  const [activeId, setActiveId] = useState((savedFiles || [])[0]?.id ?? 1);
  const [view, setView] = useState("editor");
  const [depth, setDepth] = useState("standard");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [aiAvailable, setAiAvailable] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(null);
  const lineRef = useRef(null);
  const editorRef = useRef(null);
  const fileInputRef = useRef(null);

  const active = files.find((f) => f.id === activeId) || files[0];

  // Persist to localStorage whenever files change
  useEffect(() => {
    try { localStorage.setItem("crev-files-v1", JSON.stringify(files)); } catch {}
  }, [files]);

  // Poll backend health on mount
  useEffect(() => {
    checkHealth().then((d) => setAiAvailable(d.ai_available)).catch(() => {});
  }, []);

  function updateFile(id, updates) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  }

  function addFile() {
    const f = mkFile(`untitled_${fileId}.py`, "# Write your code here\n");
    setFiles((prev) => [...prev, f]);
    setActiveId(f.id);
  }

  function closeFile(id) {
    if (files.length <= 1) return;
    const rest = files.filter((f) => f.id !== id);
    setFiles(rest);
    if (activeId === id) setActiveId(rest[0].id);
  }

  function handleUpload(fileList) {
    const supported = new Set(Object.keys(EXT_MAP));
    Array.from(fileList).forEach((file) => {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!ext || !supported.has(ext)) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const f = mkFile(file.name, e.target.result, EXT_MAP[ext] || "auto");
        setFiles((prev) => [...prev, f]);
        setActiveId(f.id);
      };
      reader.readAsText(file);
    });
  }

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
  }, []);

  const msgs = [
    "Parsing source structure...",
    "Running static checkers...",
    "Consulting Claude AI...",
    "Categorising findings...",
    "Building review report...",
  ];

  function makeErrorResult(filename, message) {
    return {
      filename,
      language: "unknown",
      score: null,
      summary: `Error: ${message}`,
      issues: [],
      mode: "scan",
      duration_ms: 0,
      issue_counts: { critical: 0, warning: 0, suggestion: 0, info: 0 },
    };
  }

  async function runReview(file, mode) {
    const apiFn = mode === "scan" ? scanCode : analyzeCode;
    return apiFn({
      code: file.code,
      filename: file.name,
      language: file.language === "auto" ? null : file.language,
      depth,
    });
  }

  async function handleSingle(mode) {
    if (active.code.length > 500_000) {
      updateFile(active.id, { results: makeErrorResult(active.name, "File exceeds the 500 KB limit. Please split it into smaller files.") });
      return;
    }
    setLoading(true);
    let idx = 0;
    setLoadingMsg(msgs[0]);
    const iv = setInterval(() => { idx = (idx + 1) % msgs.length; setLoadingMsg(msgs[idx]); }, 1600);
    try {
      const result = await runReview(active, mode);
      updateFile(active.id, { results: result });
    } catch (e) {
      updateFile(active.id, { results: makeErrorResult(active.name, e.message) });
    }
    clearInterval(iv);
    setLoading(false);
  }

  async function handleAll(mode) {
    setLoading(true);
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setProgress({ current: i + 1, total: files.length });
      setLoadingMsg(`Scanning ${f.name}...`);
      try {
        const result = await runReview(f, mode);
        setFiles((prev) => prev.map((pf) => (pf.id === f.id ? { ...pf, results: result } : pf)));
      } catch (e) {
        setFiles((prev) => prev.map((pf) => (pf.id === f.id ? { ...pf, results: makeErrorResult(f.name, e.message) } : pf)));
      }
    }
    setProgress(null);
    setLoading(false);
  }

  const res = active?.results;
  const lines = active?.code.split("\n") || [];
  const issueLines = res ? new Set(res.issues.map((i) => i.line)) : new Set();
  const scanned = files.filter((f) => f.results).length;
  const totalIssues = files.reduce((s, f) => s + (f.results?.issues?.length || 0), 0);
  const openBugs = KNOWN_BUGS.filter((b) => b.status === "open").length;

  function syncScroll(e) {
    if (lineRef.current) lineRef.current.scrollTop = e.target.scrollTop;
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div
      onDrop={onDrop}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      style={{ minHeight: "100vh", position: "relative" }}
    >
      {/* Dot-grid background */}
      <div style={{ position: "fixed", inset: 0, backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.015) 1px, transparent 0)", backgroundSize: "40px 40px", pointerEvents: "none" }} />

      {/* Drag-drop overlay */}
      {dragOver && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,10,15,0.92)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", border: "3px dashed #ffa502", borderRadius: 12 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📂</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#ffa502" }}>Drop files to review</div>
            <div style={{ fontSize: 12, color: "#636e72", marginTop: 6 }}>.py .js .ts .cpp .java .rs .go</div>
          </div>
        </div>
      )}

      <div style={{ position: "relative", maxWidth: 1280, margin: "0 auto", padding: "20px 20px 48px" }}>

        {/* ── Header ───────────────────────────────────────────────── */}
        <header style={{ marginBottom: 22, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>

          {/* Logo + status */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, background: "linear-gradient(135deg, #ff4757, #ffa502)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 900, color: "#fff", boxShadow: "0 4px 16px rgba(255,71,87,0.3)", animation: "pulse-glow 3s ease infinite" }}>C</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, background: "linear-gradient(135deg, #fff 40%, #a4b0be)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>CREV</h1>
            <span style={{ fontSize: 10, color: "#636e72", border: "1px solid #2d3436", padding: "2px 6px", borderRadius: 4 }}>v1.0.1</span>
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: aiAvailable ? "rgba(46,213,115,0.1)" : "rgba(255,71,87,0.1)", color: aiAvailable ? "#2ed573" : "#ff4757", border: `1px solid ${aiAvailable ? "rgba(46,213,115,0.2)" : "rgba(255,71,87,0.2)"}` }}>
              AI {aiAvailable ? "Online" : "Offline"}
            </span>
          </div>

          {/* Navigation */}
          <nav style={{ display: "flex", gap: 2, padding: 3, background: "#0e0e16", border: "1px solid #1e1e2e", borderRadius: 8 }}>
            {[
              { key: "editor",    label: "Editor",      badge: scanned > 0 ? `${scanned}/${files.length}` : null, danger: false },
              { key: "bugs",      label: "Bug Tracker", badge: openBugs > 0 ? openBugs : null, danger: true },
              { key: "changelog", label: "Changelog",   badge: null, danger: false },
            ].map(({ key, label, badge, danger }) => (
              <button key={key} onClick={() => setView(key)} className={`nav-btn ${view === key ? "active" : ""}`}>
                {label}
                {badge != null && <span className={`nav-badge ${danger ? "danger" : ""}`}>{badge}</span>}
              </button>
            ))}
          </nav>

          {/* Right-side controls */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
            {scanned > 0 && (
              <span style={{ fontSize: 10, color: "#a4b0be", background: "#14141f", padding: "3px 8px", borderRadius: 10, border: "1px solid #1e1e2e" }}>
                {totalIssues} issue{totalIssues !== 1 ? "s" : ""}
              </span>
            )}
            {view === "editor" && (
              <>
                <select value={depth} onChange={(e) => setDepth(e.target.value)} className="ctrl-select">
                  <option value="quick">Quick</option>
                  <option value="standard">Standard</option>
                  <option value="full">Full</option>
                </select>
                <button onClick={() => fileInputRef.current?.click()} className="ctrl-btn">📁 Upload</button>
                <input ref={fileInputRef} type="file" multiple accept=".py,.js,.jsx,.ts,.tsx,.cpp,.cc,.h,.c,.java,.rs,.go" onChange={(e) => handleUpload(e.target.files)} style={{ display: "none" }} />
              </>
            )}
          </div>
        </header>

        {/* ── Editor view ───────────────────────────────────────────── */}
        {view === "editor" && (
          <div style={{ animation: "fadeIn 0.15s ease" }}>
            {/* File tabs */}
            <div style={{ display: "flex", alignItems: "center", gap: 1, overflowX: "auto" }}>
              {files.map((f) => {
                const isActive = f.id === activeId;
                const crit  = f.results?.issue_counts?.critical || 0;
                const total = f.results?.issues?.length || 0;
                return (
                  <div
                    key={f.id}
                    onClick={() => setActiveId(f.id)}
                    style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: isActive ? "#12121a" : "#0a0a0f", border: "1px solid", borderColor: isActive ? "#2d3436" : "transparent", borderBottom: isActive ? "1px solid #12121a" : "1px solid #1e1e2e", borderRadius: "7px 7px 0 0", cursor: "pointer", fontSize: 10, color: isActive ? "#e8e6e3" : "#636e72", whiteSpace: "nowrap", marginBottom: -1, transition: "color 0.15s ease" }}
                  >
                    <span>{f.name}</span>
                    {f.results && (
                      <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 6, background: crit > 0 ? "rgba(255,71,87,0.15)" : total > 0 ? "rgba(255,165,2,0.15)" : "rgba(46,213,115,0.15)", color: crit > 0 ? "#ff4757" : total > 0 ? "#ffa502" : "#2ed573" }}>
                        {total}
                      </span>
                    )}
                    {f.results?.duration_ms != null && (
                      <span style={{ fontSize: 8, color: "#3d3d50" }}>{f.results.duration_ms}ms</span>
                    )}
                    {files.length > 1 && (
                      <span
                        onClick={(e) => { e.stopPropagation(); closeFile(f.id); }}
                        style={{ color: "#3d3d50", fontSize: 12, cursor: "pointer", transition: "color 0.15s" }}
                        onMouseEnter={(e) => (e.target.style.color = "#ff4757")}
                        onMouseLeave={(e) => (e.target.style.color = "#3d3d50")}
                      >×</span>
                    )}
                  </div>
                );
              })}
              <div
                onClick={addFile}
                style={{ padding: "6px 10px", cursor: "pointer", fontSize: 13, color: "#3d3d50", transition: "color 0.15s" }}
                onMouseEnter={(e) => (e.target.style.color = "#a4b0be")}
                onMouseLeave={(e) => (e.target.style.color = "#3d3d50")}
              >+</div>
            </div>

            {/* Editor + Results grid */}
            <div style={{ display: "grid", gridTemplateColumns: res ? "1fr 1fr" : "1fr", border: "1px solid #1e1e2e", borderRadius: "0 8px 8px 8px", overflow: "hidden", minHeight: 420 }}>

              {/* Code editor */}
              <div style={{ background: "#12121a", display: "flex", flexDirection: "column", borderRight: res ? "1px solid #1e1e2e" : "none" }}>
                <div style={{ padding: "7px 12px", background: "#0e0e16", borderBottom: "1px solid #1e1e2e", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", gap: 5 }}>
                    <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#ff5f57" }} />
                    <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#febc2e" }} />
                    <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#28c840" }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <select value={active.language} onChange={(e) => updateFile(active.id, { language: e.target.value })} style={{ background: "transparent", border: "none", color: "#636e72", fontSize: 10, cursor: "pointer", outline: "none", fontFamily: "inherit" }}>
                      {LANGUAGES.map((l) => <option key={l} value={l} style={{ background: "#0e0e16" }}>{l === "auto" ? "AUTO" : l.toUpperCase()}</option>)}
                    </select>
                    <span style={{ fontSize: 9, color: "#3d3d50" }}>{lines.length} lines</span>
                  </div>
                </div>

                <div style={{ display: "flex", flex: 1 }}>
                  {/* Line numbers */}
                  <div ref={lineRef} style={{ padding: "12px 0", width: 44, background: "#0e0e16", overflowY: "hidden", flexShrink: 0, userSelect: "none" }}>
                    {lines.map((_, i) => (
                      <div key={i} style={{ height: 19, lineHeight: "19px", fontSize: 10, color: issueLines.has(i + 1) ? "#ff4757" : "#3d3d50", textAlign: "right", paddingRight: 8, background: issueLines.has(i + 1) ? "rgba(255,71,87,0.06)" : "transparent" }}>
                        {i + 1}
                      </div>
                    ))}
                  </div>
                  {/* Textarea */}
                  <textarea
                    ref={editorRef}
                    value={active.code}
                    onChange={(e) => updateFile(active.id, { code: e.target.value, results: null })}
                    onScroll={syncScroll}
                    spellCheck={false}
                    style={{ flex: 1, background: "transparent", color: "#e8e6e3", border: "none", outline: "none", resize: "none", fontFamily: "inherit", fontSize: 12, lineHeight: "19px", padding: "12px 12px 12px 6px", minHeight: 380, tabSize: 4, caretColor: "#ffa502" }}
                  />
                </div>
              </div>

              {/* Results panel */}
              {res && (
                <div style={{ background: "#12121a", display: "flex", flexDirection: "column", animation: "fadeIn 0.2s ease" }}>
                  <div style={{ padding: "7px 12px", background: "#0e0e16", borderBottom: "1px solid #1e1e2e", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, fontWeight: 600 }}>Results — {active.name}</span>
                    <span style={{ fontSize: 9, color: "#636e72" }}>
                      {res.issues.length} issues · {res.mode === "analyze" ? "AI+Static" : "Static"} · {res.duration_ms}ms
                    </span>
                  </div>

                  <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>

                    {/* Quality score */}
                    {res.score != null && (
                      <div style={{ padding: "9px 12px", background: "#0e0e16", borderRadius: 7, border: "1px solid #1e1e2e" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ fontSize: 10, color: "#a4b0be" }}>Quality Score</span>
                          <span style={{ fontSize: 17, fontWeight: 800, color: res.score >= 8 ? "#2ed573" : res.score >= 5 ? "#ffa502" : "#ff4757" }}>
                            {res.score.toFixed(1)}/10
                          </span>
                        </div>
                        <div style={{ height: 4, background: "#1e1e2e", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ width: `${res.score * 10}%`, height: "100%", borderRadius: 2, background: res.score >= 8 ? "#2ed573" : res.score >= 5 ? "linear-gradient(90deg,#ffa502,#ff6348)" : "linear-gradient(90deg,#ff4757,#ff6348)", transition: "width 0.8s ease" }} />
                        </div>
                      </div>
                    )}

                    {/* Summary */}
                    {res.summary && (
                      <div style={{ padding: "8px 10px", background: "rgba(164,176,190,0.04)", border: "1px solid #1e1e2e", borderRadius: 7, fontSize: 11, color: "#a4b0be", lineHeight: 1.55 }}>
                        {res.summary}
                      </div>
                    )}

                    {/* Severity count row */}
                    {res.issue_counts && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {Object.entries(res.issue_counts).map(([sev, c]) => SEVERITY[sev] && (
                          <div key={sev} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: SEVERITY[sev].color, opacity: c > 0 ? 1 : 0.3 }}>
                            <span style={{ fontSize: 7 }}>{SEVERITY[sev].icon}</span>
                            <span style={{ fontWeight: 600 }}>{c}</span>
                            <span style={{ color: "#636e72" }}>{sev}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Issue list */}
                    {res.issues.length === 0 ? (
                      <div style={{ padding: 24, textAlign: "center", color: "#2ed573", fontSize: 12 }}>✓ No issues found!</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {res.issues.map((issue, i) => {
                          const s = SEVERITY[issue.severity] || SEVERITY.info;
                          return (
                            <div key={i} style={{ padding: "8px 10px", background: s.bg, border: `1px solid ${s.border}`, borderRadius: 6, fontSize: 11, animation: `fadeIn 0.15s ease ${i * 0.03}s both` }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                                <span style={{ fontSize: 7, color: s.color }}>{s.icon}</span>
                                <span style={{ fontWeight: 700, color: s.color, fontSize: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>{issue.severity}</span>
                                <span style={{ color: "#636e72", fontSize: 9 }}>Line {issue.line}</span>
                                <span style={{ color: "#3d3d50" }}>·</span>
                                <span style={{ color: "#636e72", fontSize: 9 }}>{issue.category}</span>
                              </div>
                              <div style={{ color: "#e8e6e3", lineHeight: 1.45, marginBottom: issue.suggestion ? 4 : 0 }}>{issue.message}</div>
                              {issue.suggestion && (
                                <div style={{ color: "#a4b0be", fontSize: 10, fontStyle: "italic", opacity: 0.8 }}>→ {issue.suggestion}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div style={{ marginTop: 12, display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={() => handleSingle("scan")} disabled={loading} className="action-btn secondary">⚡ Scan File</button>
              <button
                onClick={() => handleSingle("analyze")}
                disabled={loading || !aiAvailable}
                title={!aiAvailable ? "Server needs ANTHROPIC_API_KEY configured" : ""}
                className={`action-btn primary${!aiAvailable ? " disabled" : ""}`}
              >🔍 AI Analyze</button>
              {files.length > 1 && (
                <>
                  <button onClick={() => handleAll("scan")} disabled={loading} className="action-btn amber">⚡ Scan All ({files.length})</button>
                  {aiAvailable && <button onClick={() => handleAll("analyze")} disabled={loading} className="action-btn danger-outline">🔍 AI All ({files.length})</button>}
                </>
              )}
              {res && <button onClick={() => updateFile(active.id, { results: null })} className="action-btn ghost">Clear</button>}
            </div>

            {/* Loading indicator */}
            {loading && (
              <div style={{ marginTop: 14, textAlign: "center" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 16px", background: "#14141f", border: "1px solid #1e1e2e", borderRadius: 7 }}>
                  <div style={{ width: 11, height: 11, border: "2px solid #2d3436", borderTopColor: "#ffa502", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  <span style={{ fontSize: 10, color: "#a4b0be" }}>
                    {progress ? `(${progress.current}/${progress.total}) ` : ""}{loadingMsg}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Bug Tracker view ─────────────────────────────────────── */}
        {view === "bugs" && <BugTracker />}

        {/* ── Changelog view ───────────────────────────────────────── */}
        {view === "changelog" && <ChangelogView />}

        {/* ── Footer ───────────────────────────────────────────────── */}
        <footer style={{ marginTop: 36, paddingTop: 12, borderTop: "1px solid #1e1e2e", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, fontSize: 9, color: "#3d3d50" }}>
          <span>Built by Hassan · FastAPI + React + Vite · Claude AI</span>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <span>Static = free · AI = server-side API key</span>
            <button
              onClick={() => { try { localStorage.removeItem("crev-files-v1"); window.location.reload(); } catch {} }}
              style={{ background: "none", border: "none", color: "#3d3d50", fontSize: 9, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline", textDecorationStyle: "dotted" }}
            >Reset workspace</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
