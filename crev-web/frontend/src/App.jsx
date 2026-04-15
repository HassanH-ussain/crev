import { useState, useRef, useEffect, useCallback } from "react";
import { scanCode, analyzeCode, checkHealth } from "./api";
import "./index.css";

const SEVERITY = {
  critical: { color: "#ff4757", icon: "🔴", bg: "rgba(255,71,87,0.08)", border: "rgba(255,71,87,0.25)" },
  warning: { color: "#ffa502", icon: "🟡", bg: "rgba(255,165,2,0.08)", border: "rgba(255,165,2,0.25)" },
  suggestion: { color: "#3742fa", icon: "🔵", bg: "rgba(55,66,250,0.08)", border: "rgba(55,66,250,0.25)" },
  info: { color: "#a4b0be", icon: "⚪", bg: "rgba(164,176,190,0.06)", border: "rgba(164,176,190,0.2)" },
};

const LANGUAGES = ["auto", "python", "javascript", "typescript", "cpp", "c", "java", "rust", "go"];

const EXT_MAP = {
  py: "python", js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
  cpp: "cpp", cc: "cpp", h: "c", c: "c", java: "java", rs: "rust", go: "go",
};

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

let fileId = 1;
const mkFile = (name, code) => ({ id: fileId++, name, code, language: "auto", results: null });

export default function App() {
  const [files, setFiles] = useState([mkFile("buggy_example.py", SAMPLE_CODE)]);
  const [activeId, setActiveId] = useState(1);
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

  // Check if backend AI is available on mount
  useEffect(() => {
    checkHealth()
      .then((d) => setAiAvailable(d.ai_available))
      .catch(() => {});
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
        const f = mkFile(file.name, e.target.result);
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

  const msgs = ["Parsing source structure...", "Running static checkers...", "Consulting Claude AI...", "Categorizing findings...", "Building review report..."];

  async function runReview(file, mode) {
    const apiFn = mode === "scan" ? scanCode : analyzeCode;
    const result = await apiFn({
      code: file.code,
      filename: file.name,
      language: file.language === "auto" ? null : file.language,
      depth,
    });
    return result;
  }

  async function handleSingle(mode) {
    setLoading(true);
    let idx = 0;
    setLoadingMsg(msgs[0]);
    const iv = setInterval(() => { idx = (idx + 1) % msgs.length; setLoadingMsg(msgs[idx]); }, 1600);
    try {
      const result = await runReview(active, mode);
      updateFile(active.id, { results: result });
    } catch (e) {
      updateFile(active.id, { results: { filename: active.name, language: "python", score: null, summary: `Error: ${e.message}`, issues: [], mode: "scan", duration_ms: 0, issue_counts: { critical: 0, warning: 0, suggestion: 0, info: 0 } } });
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
        setFiles((prev) => prev.map((pf) => (pf.id === f.id ? { ...pf, results: { filename: f.name, language: "python", score: null, summary: `Error: ${e.message}`, issues: [], mode: "scan", duration_ms: 0, issue_counts: {} } } : pf)));
      }
    }
    setProgress(null);
    setLoading(false);
  }

  const res = active.results;
  const lines = active.code.split("\n");
  const issueLines = res ? new Set(res.issues.map((i) => i.line)) : new Set();
  const scanned = files.filter((f) => f.results).length;
  const totalIssues = files.reduce((s, f) => s + (f.results?.issues?.length || 0), 0);

  function syncScroll(e) {
    if (lineRef.current) lineRef.current.scrollTop = e.target.scrollTop;
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} style={{ minHeight: "100vh", position: "relative" }}>
      {/* Grid bg */}
      <div style={{ position: "fixed", inset: 0, backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.015) 1px, transparent 0)", backgroundSize: "40px 40px", pointerEvents: "none" }} />

      {/* Drag overlay */}
      {dragOver && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,10,15,0.92)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", border: "3px dashed #ffa502", borderRadius: 12 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📂</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#ffa502" }}>Drop files to review</div>
            <div style={{ fontSize: 12, color: "#636e72", marginTop: 6 }}>.py .js .ts .cpp .java .rs .go</div>
          </div>
        </div>
      )}

      <div style={{ position: "relative", maxWidth: 1280, margin: "0 auto", padding: 20 }}>
        {/* Header */}
        <header style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, background: "linear-gradient(135deg, #ff4757, #ffa502)", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 900, color: "#fff" }}>C</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, background: "linear-gradient(135deg, #fff 40%, #a4b0be)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>CREV</h1>
            <span style={{ fontSize: 10, color: "#636e72", border: "1px solid #2d3436", padding: "2px 6px", borderRadius: 4 }}>v1.0.0</span>
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: aiAvailable ? "rgba(46,213,115,0.1)" : "rgba(255,71,87,0.1)", color: aiAvailable ? "#2ed573" : "#ff4757", border: `1px solid ${aiAvailable ? "rgba(46,213,115,0.2)" : "rgba(255,71,87,0.2)"}` }}>
              AI {aiAvailable ? "Online" : "Offline"}
            </span>
            {scanned > 0 && <span style={{ fontSize: 10, color: "#a4b0be", background: "#14141f", padding: "2px 8px", borderRadius: 10, border: "1px solid #1e1e2e" }}>{scanned}/{files.length} scanned · {totalIssues} issues</span>}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select value={depth} onChange={(e) => setDepth(e.target.value)} style={{ background: "#14141f", border: "1px solid #2d3436", color: "#a4b0be", padding: "4px 8px", borderRadius: 5, fontSize: 10, cursor: "pointer", outline: "none", fontFamily: "inherit" }}>
              <option value="quick">Quick</option>
              <option value="standard">Standard</option>
              <option value="full">Full</option>
            </select>
            <button onClick={() => fileInputRef.current?.click()} style={{ background: "#14141f", border: "1px solid #2d3436", color: "#a4b0be", padding: "4px 10px", borderRadius: 5, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>📁 Upload</button>
            <input ref={fileInputRef} type="file" multiple accept=".py,.js,.jsx,.ts,.tsx,.cpp,.cc,.h,.c,.java,.rs,.go" onChange={(e) => handleUpload(e.target.files)} style={{ display: "none" }} />
          </div>
        </header>

        {/* Tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: 1, overflowX: "auto" }}>
          {files.map((f) => {
            const isActive = f.id === activeId;
            const crit = f.results?.issue_counts?.critical || 0;
            const total = f.results?.issues?.length || 0;
            return (
              <div key={f.id} onClick={() => setActiveId(f.id)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: isActive ? "#12121a" : "#0a0a0f", border: "1px solid", borderColor: isActive ? "#2d3436" : "transparent", borderBottom: isActive ? "1px solid #12121a" : "1px solid #1e1e2e", borderRadius: "7px 7px 0 0", cursor: "pointer", fontSize: 10, color: isActive ? "#e8e6e3" : "#636e72", whiteSpace: "nowrap", marginBottom: -1 }}>
                <span>{f.name}</span>
                {f.results && <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 6, background: crit > 0 ? "rgba(255,71,87,0.15)" : total > 0 ? "rgba(255,165,2,0.15)" : "rgba(46,213,115,0.15)", color: crit > 0 ? "#ff4757" : total > 0 ? "#ffa502" : "#2ed573" }}>{total}</span>}
                {f.results?.duration_ms != null && <span style={{ fontSize: 8, color: "#3d3d50" }}>{f.results.duration_ms}ms</span>}
                {files.length > 1 && <span onClick={(e) => { e.stopPropagation(); closeFile(f.id); }} style={{ color: "#3d3d50", fontSize: 12, cursor: "pointer" }} onMouseEnter={(e) => (e.target.style.color = "#ff4757")} onMouseLeave={(e) => (e.target.style.color = "#3d3d50")}>×</span>}
              </div>
            );
          })}
          <div onClick={addFile} style={{ padding: "6px 10px", cursor: "pointer", fontSize: 13, color: "#3d3d50" }} onMouseEnter={(e) => (e.target.style.color = "#a4b0be")} onMouseLeave={(e) => (e.target.style.color = "#3d3d50")}>+</div>
        </div>

        {/* Main grid */}
        <div style={{ display: "grid", gridTemplateColumns: res ? "1fr 1fr" : "1fr", border: "1px solid #1e1e2e", borderRadius: "0 8px 8px 8px", overflow: "hidden" }}>
          {/* Editor */}
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
              <div ref={lineRef} style={{ padding: "12px 0", width: 40, background: "#0e0e16", overflowY: "hidden", flexShrink: 0, userSelect: "none" }}>
                {lines.map((_, i) => (
                  <div key={i} style={{ height: 19, lineHeight: "19px", fontSize: 10, color: issueLines.has(i + 1) ? "#ff4757" : "#3d3d50", textAlign: "right", paddingRight: 8, background: issueLines.has(i + 1) ? "rgba(255,71,87,0.06)" : "transparent" }}>{i + 1}</div>
                ))}
              </div>
              <textarea ref={editorRef} value={active.code} onChange={(e) => updateFile(active.id, { code: e.target.value, results: null })} onScroll={syncScroll} spellCheck={false} style={{ flex: 1, background: "transparent", color: "#e8e6e3", border: "none", outline: "none", resize: "none", fontFamily: "inherit", fontSize: 12, lineHeight: "19px", padding: "12px 12px 12px 6px", minHeight: 360, tabSize: 4, caretColor: "#ffa502" }} />
            </div>
          </div>

          {/* Results */}
          {res && (
            <div style={{ background: "#12121a", display: "flex", flexDirection: "column", animation: "fadeIn 0.2s ease" }}>
              <div style={{ padding: "7px 12px", background: "#0e0e16", borderBottom: "1px solid #1e1e2e", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, fontWeight: 600 }}>Results — {active.name}</span>
                <span style={{ fontSize: 9, color: "#636e72" }}>{res.issues.length} issues · {res.mode === "analyze" ? "AI+Static" : "Static"} · {res.duration_ms}ms</span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 12, maxHeight: 500 }}>
                {/* Score */}
                {res.score != null && (
                  <div style={{ marginBottom: 12, padding: "9px 12px", background: "#0e0e16", borderRadius: 7, border: "1px solid #1e1e2e" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 10, color: "#a4b0be" }}>Quality Score</span>
                      <span style={{ fontSize: 17, fontWeight: 800, color: res.score >= 8 ? "#2ed573" : res.score >= 5 ? "#ffa502" : "#ff4757" }}>{res.score.toFixed(1)}/10</span>
                    </div>
                    <div style={{ height: 4, background: "#1e1e2e", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${res.score * 10}%`, height: "100%", borderRadius: 2, background: res.score >= 8 ? "#2ed573" : res.score >= 5 ? "linear-gradient(90deg, #ffa502, #ff6348)" : "linear-gradient(90deg, #ff4757, #ff6348)", transition: "width 0.8s ease" }} />
                    </div>
                  </div>
                )}

                {/* Summary */}
                {res.summary && <div style={{ marginBottom: 12, padding: "7px 10px", background: "rgba(164,176,190,0.04)", border: "1px solid #1e1e2e", borderRadius: 7, fontSize: 11, color: "#a4b0be", lineHeight: 1.5 }}>{res.summary}</div>}

                {/* Counts */}
                {res.issue_counts && (
                  <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                    {Object.entries(res.issue_counts).map(([sev, c]) => SEVERITY[sev] && (
                      <div key={sev} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: SEVERITY[sev].color, opacity: c > 0 ? 1 : 0.3 }}>
                        <span>{SEVERITY[sev].icon}</span><span style={{ fontWeight: 600 }}>{c}</span><span style={{ color: "#636e72" }}>{sev}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Issues */}
                {res.issues.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", color: "#2ed573", fontSize: 12 }}>✓ No issues found!</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {res.issues.map((issue, i) => {
                      const s = SEVERITY[issue.severity] || SEVERITY.info;
                      return (
                        <div key={i} style={{ padding: "8px 10px", background: s.bg, border: `1px solid ${s.border}`, borderRadius: 6, fontSize: 11, animation: `fadeIn 0.15s ease ${i * 0.03}s both` }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                            <span style={{ fontSize: 9 }}>{s.icon}</span>
                            <span style={{ fontWeight: 700, color: s.color, fontSize: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>{issue.severity}</span>
                            <span style={{ color: "#636e72", fontSize: 9 }}>Line {issue.line}</span>
                            <span style={{ color: "#3d3d50" }}>·</span>
                            <span style={{ color: "#636e72", fontSize: 9 }}>{issue.category}</span>
                          </div>
                          <div style={{ color: "#e8e6e3", lineHeight: 1.4, marginBottom: issue.suggestion ? 3 : 0 }}>{issue.message}</div>
                          {issue.suggestion && <div style={{ color: "#a4b0be", fontSize: 10, fontStyle: "italic", opacity: 0.8 }}>→ {issue.suggestion}</div>}
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
          <button onClick={() => handleSingle("scan")} disabled={loading} style={{ padding: "7px 18px", borderRadius: 6, border: "1px solid #2d3436", background: "#14141f", color: "#e8e6e3", fontSize: 11, fontWeight: 600, cursor: loading ? "wait" : "pointer", fontFamily: "inherit", opacity: loading ? 0.5 : 1 }}>⚡ Scan File</button>
          <button onClick={() => handleSingle("analyze")} disabled={loading || !aiAvailable} title={!aiAvailable ? "Server needs ANTHROPIC_API_KEY" : ""} style={{ padding: "7px 18px", borderRadius: 6, border: "none", background: aiAvailable ? "linear-gradient(135deg, #ff4757, #ff6348)" : "#2d3436", color: aiAvailable ? "#fff" : "#636e72", fontSize: 11, fontWeight: 700, cursor: loading || !aiAvailable ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: loading ? 0.5 : 1, boxShadow: aiAvailable ? "0 3px 14px rgba(255,71,87,0.2)" : "none" }}>🔍 AI Analyze</button>
          {files.length > 1 && <>
            <button onClick={() => handleAll("scan")} disabled={loading} style={{ padding: "7px 18px", borderRadius: 6, border: "1px solid #2d3436", background: "#14141f", color: "#ffa502", fontSize: 11, fontWeight: 600, cursor: loading ? "wait" : "pointer", fontFamily: "inherit", opacity: loading ? 0.5 : 1 }}>⚡ Scan All ({files.length})</button>
            {aiAvailable && <button onClick={() => handleAll("analyze")} disabled={loading} style={{ padding: "7px 18px", borderRadius: 6, border: "1px solid rgba(255,71,87,0.3)", background: "rgba(255,71,87,0.08)", color: "#ff4757", fontSize: 11, fontWeight: 600, cursor: loading ? "wait" : "pointer", fontFamily: "inherit", opacity: loading ? 0.5 : 1 }}>🔍 AI All ({files.length})</button>}
          </>}
          {res && <button onClick={() => updateFile(active.id, { results: null })} style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid #2d3436", background: "transparent", color: "#636e72", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Clear</button>}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ marginTop: 14, textAlign: "center" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 16px", background: "#14141f", border: "1px solid #1e1e2e", borderRadius: 7 }}>
              <div style={{ width: 11, height: 11, border: "2px solid #2d3436", borderTopColor: "#ffa502", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <span style={{ fontSize: 10, color: "#a4b0be" }}>{progress ? `(${progress.current}/${progress.total}) ` : ""}{loadingMsg}</span>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer style={{ marginTop: 20, paddingTop: 10, borderTop: "1px solid #1e1e2e", display: "flex", justifyContent: "space-between", fontSize: 9, color: "#3d3d50" }}>
          <span>Built by Hassan · FastAPI + React + Vite</span>
          <span>Static = Free · AI = Server-side Claude API</span>
        </footer>
      </div>
    </div>
  );
}
