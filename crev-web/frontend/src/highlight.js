/**
 * Zero-dependency syntax highlighter.
 *
 * One combined regex per language (comment | string | keyword | decorator |
 * number | function-call) is scanned left-to-right; everything between
 * matches is plain text. Left-to-right scanning means a "//" inside a string
 * can never be mistaken for a comment — the string alternative already
 * consumed it.
 */

const JS_KEYWORDS =
  "async await break case catch class const continue debugger default delete do else export " +
  "extends finally for from function if import in instanceof let new of return static super " +
  "switch this throw try typeof var void while with yield null undefined true false";

const C_KEYWORDS =
  "auto break case char const continue default do double else enum extern float for goto if " +
  "inline int long register restrict return short signed sizeof static struct switch typedef " +
  "union unsigned void volatile while NULL";

const KEYWORDS = {
  python:
    "and as assert async await break class continue def del elif else except finally for from " +
    "global if import in is lambda nonlocal not or pass raise return try while with yield " +
    "None True False self",
  javascript: JS_KEYWORDS,
  typescript:
    JS_KEYWORDS +
    " abstract any as boolean declare enum implements interface is keyof namespace never " +
    "number private protected public readonly satisfies string symbol type unknown",
  java:
    "abstract assert boolean break byte case catch char class const continue default do double " +
    "else enum extends final finally float for if implements import instanceof int interface " +
    "long native new package private protected public record return short static strictfp super " +
    "switch synchronized this throw throws transient try var void volatile while null true false",
  c: C_KEYWORDS,
  cpp:
    C_KEYWORDS +
    " alignas alignof bool catch class constexpr const_cast decltype delete dynamic_cast " +
    "explicit export false friend mutable namespace new noexcept nullptr operator private " +
    "protected public reinterpret_cast static_assert static_cast template this throw true try " +
    "typeid typename using virtual",
  rust:
    "as async await break const continue crate dyn else enum extern false fn for if impl in let " +
    "loop match mod move mut pub ref return self Self static struct super trait true type " +
    "unsafe use where while",
  go:
    "break case chan const continue default defer else fallthrough for func go goto if import " +
    "interface map package range return select struct switch type var nil true false",
};

// Above this size, highlighting is skipped (callers render plain text) so
// typing in very large files stays smooth.
export const MAX_HIGHLIGHT_CHARS = 60_000;

const NEVER_MATCH = "(?!x)x";
const BACKTICK_STRING = "`(?:\\\\.|[^`\\\\])*`";

const _specCache = new Map();

function buildRegex(language) {
  if (_specCache.has(language)) return _specCache.get(language);

  const kwList = (KEYWORDS[language] || "").trim().split(/\s+/).filter(Boolean);
  const keyword = kwList.length ? `\\b(?:${kwList.join("|")})\\b` : NEVER_MATCH;

  const comment =
    language === "python"
      ? String.raw`#[^\n]*`
      : String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`;

  const string =
    language === "python"
      ? String.raw`[rbfuRBFU]{0,2}(?:'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")`
      : BACKTICK_STRING + String.raw`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"`;

  const number = String.raw`\b(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b`;

  const regex = new RegExp(
    `(?<comment>${comment})` +
      `|(?<string>${string})` +
      `|(?<keyword>${keyword})` +
      `|(?<deco>@[\\w.]+)` +
      `|(?<number>${number})` +
      `|(?<func>[A-Za-z_]\\w*(?=\\s*\\())`,
    "g",
  );
  _specCache.set(language, regex);
  return regex;
}

/**
 * Tokenize source into [type, text] pairs.
 * Types: comment | string | keyword | deco | number | func | plain.
 * Returns null when the source is too large to highlight comfortably.
 */
export function tokenize(code, language) {
  if (code.length > MAX_HIGHLIGHT_CHARS) return null;

  const regex = buildRegex(language);
  regex.lastIndex = 0;

  const tokens = [];
  let last = 0;
  let match;

  while ((match = regex.exec(code)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    if (match.index > last) tokens.push(["plain", code.slice(last, match.index)]);
    const groups = match.groups;
    const type =
      groups.comment !== undefined ? "comment"
      : groups.string !== undefined ? "string"
      : groups.keyword !== undefined ? "keyword"
      : groups.deco !== undefined ? "deco"
      : groups.number !== undefined ? "number"
      : "func";
    tokens.push([type, match[0]]);
    last = match.index + match[0].length;
  }
  if (last < code.length) tokens.push(["plain", code.slice(last)]);

  return tokens;
}
