import { useEffect, useMemo, useRef, useState } from "react";
import { tokenize } from "./highlight";

/**
 * Syntax-highlighted code editor built from a transparent <textarea> layered
 * over a highlighted <pre>. The textarea owns input, selection, and
 * scrolling; the <pre> (and the line-number gutter) mirror its scroll
 * position, so the colored text stays glued to the caret.
 */

const LINE_H = 19; // px — must match the CSS line-height on both layers

const TOKEN_CLASS = {
  keyword: "tok-kw",
  string: "tok-str",
  comment: "tok-cmt",
  number: "tok-num",
  func: "tok-fn",
  deco: "tok-deco",
};

const encoder = new TextEncoder();

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export default function CodeEditor({ code, language, issueLines, flash, onChange, onRun }) {
  const taRef = useRef(null);
  const preRef = useRef(null);
  const gutterRef = useRef(null);
  const [cursor, setCursor] = useState({ ln: 1, col: 1 });

  const lines = code.split("\n");
  const tokens = useMemo(() => tokenize(code, language), [code, language]);
  const byteSize = useMemo(() => encoder.encode(code).length, [code]);

  function syncScroll() {
    const ta = taRef.current;
    if (!ta) return;
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  }

  function updateCursor() {
    const ta = taRef.current;
    if (!ta) return;
    const upto = ta.value.slice(0, ta.selectionStart);
    const ln = upto.split("\n").length;
    const col = upto.length - upto.lastIndexOf("\n");
    setCursor({ ln, col });
  }

  function handleKeyDown(e) {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.target;
      ta.setRangeText("    ", ta.selectionStart, ta.selectionEnd, "end");
      onChange(ta.value);
      updateCursor();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      onRun?.();
    }
  }

  // Jump to a flashed line (issue click) if it's outside the viewport
  useEffect(() => {
    if (!flash) return;
    const ta = taRef.current;
    if (!ta) return;
    const target = (flash.line - 1) * LINE_H;
    const viewTop = ta.scrollTop;
    const viewBottom = viewTop + ta.clientHeight;
    if (target < viewTop + LINE_H || target > viewBottom - LINE_H * 2) {
      ta.scrollTop = Math.max(0, target - ta.clientHeight / 2);
    }
    syncScroll();
  }, [flash]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", flex: 1, minHeight: 380 }}>
        {/* Line numbers */}
        <div ref={gutterRef} className="gutter">
          {lines.map((_, i) => (
            <div key={i} className={issueLines.has(i + 1) ? "has-issue" : ""}>
              {i + 1}
            </div>
          ))}
        </div>

        {/* Highlight layer + input layer */}
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <pre ref={preRef} className="hl-layer" aria-hidden="true">
            {flash && (
              <div
                key={flash.nonce}
                className="line-flash"
                style={{ top: 12 + (flash.line - 1) * LINE_H }}
              />
            )}
            <code>
              {tokens
                ? tokens.map(([type, text], i) =>
                    type === "plain" ? (
                      text
                    ) : (
                      <span key={i} className={TOKEN_CLASS[type]}>{text}</span>
                    ),
                  )
                : code}
              {"\n"}
            </code>
          </pre>
          <textarea
            ref={taRef}
            className="code-input"
            value={code}
            onChange={(e) => onChange(e.target.value)}
            onScroll={syncScroll}
            onKeyDown={handleKeyDown}
            onKeyUp={updateCursor}
            onClick={updateCursor}
            spellCheck={false}
            wrap="off"
            placeholder={"// Paste code here, drop a file, or start typing…"}
          />
        </div>
      </div>

      {/* Status bar */}
      <div className="status-bar">
        <span className="sb-accent">{language === "unknown" ? "PLAIN TEXT" : language.toUpperCase()}</span>
        <span>UTF-8</span>
        <span>{lines.length} lines · {formatBytes(byteSize)}</span>
        <span style={{ flex: 1 }} />
        <span>Ln {cursor.ln}, Col {cursor.col}</span>
        <span className="sb-dim">Tab indents · Ctrl+⏎ scans</span>
      </div>
    </div>
  );
}
