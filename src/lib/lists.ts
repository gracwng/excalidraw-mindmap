/**
 * Google Docs-style lists for plain canvas text (Excalidraw text has no rich
 * formatting, so lists are written as text: "• item" and "1. item").
 *
 * Everything here is pure string logic; TabCanvas wires it to the text editor.
 */
export const BULLET = "•";

const LIST_LINE = /^(\s*)(?:([•◦▪\-*])|(\d+)([.)]))[ \t]+(.*)$/;
/** A marker with nothing after it yet, e.g. "• " or "3. ". */
const EMPTY_ITEM = /^(\s*)(?:[•◦▪\-*]|\d+[.)])[ \t]*$/;

export interface ListLine {
  indent: string;
  kind: "bullet" | "number";
  /** The marker as written, e.g. "•" or "3." */
  marker: string;
  number?: number;
  delimiter?: string;
  content: string;
  /** Length of indent + marker + following space(s). */
  prefixLength: number;
}

export function parseListLine(line: string): ListLine | null {
  const m = line.match(LIST_LINE);
  if (!m) return null;
  const [, indent, bullet, num, delimiter, content] = m;
  const prefixLength = line.length - content.length;
  if (bullet) {
    return { indent, kind: "bullet", marker: bullet, content, prefixLength };
  }
  return {
    indent,
    kind: "number",
    marker: `${num}${delimiter}`,
    number: Number(num),
    delimiter,
    content,
    prefixLength,
  };
}

export type EnterResult =
  /** Insert this at the caret (a newline plus the next item's marker). */
  | { action: "insert"; text: string }
  /** The item is empty: replace the line with this (marker removed) to end the list. */
  | { action: "end-list"; line: string };

/**
 * What Enter should do at the end of / inside `line` (Docs behaviour):
 * continue the list, or end it if the current item is empty.
 */
export function onEnter(line: string): EnterResult | null {
  const empty = line.match(EMPTY_ITEM);
  if (empty) return { action: "end-list", line: empty[1] };
  const item = parseListLine(line);
  if (!item) return null;
  const marker =
    item.kind === "bullet" ? BULLET : `${(item.number ?? 0) + 1}${item.delimiter ?? "."}`;
  return { action: "insert", text: `\n${item.indent}${marker} ` };
}

/** Typing a space right after a leading "-" or "*" turns it into a bullet. */
export function autoBullet(beforeCaret: string): string | null {
  const m = beforeCaret.match(/^(\s*)[-*]$/);
  return m ? `${m[1]}${BULLET} ` : null;
}

/**
 * Makes numbered items count 1, 2, 3… within each run of items at the same
 * indent. Deeper-indented lines (sub-items) don't break their parent's run;
 * any other line does.
 */
export function renumber(text: string): string {
  const lines = text.split("\n");
  // counters[indentLength] = next number for that level
  let counters = new Map<number, number>();
  const out = lines.map((line) => {
    const item = parseListLine(line);
    if (!item) {
      counters = new Map();
      return line;
    }
    const level = item.indent.length;
    // Leaving deeper levels resets them.
    for (const key of [...counters.keys()]) if (key > level) counters.delete(key);
    if (item.kind !== "number") {
      counters.delete(level);
      return line;
    }
    const n = counters.get(level) ?? 1;
    counters.set(level, n + 1);
    const marker = `${n}${item.delimiter}`;
    if (marker === item.marker) return line;
    return `${item.indent}${marker}${line.slice(item.indent.length + item.marker.length)}`;
  });
  return out.join("\n");
}

/**
 * Renumbers and keeps the caret on the same character, even when a marker's
 * length changes (e.g. "9." → "10.").
 */
export function renumberKeepingCaret(text: string, caret: number) {
  const next = renumber(text);
  if (next === text) return { text, caret };
  const before = text.slice(0, caret).split("\n");
  const lineIndex = before.length - 1;
  const column = before[lineIndex].length;
  const oldLine = text.split("\n")[lineIndex];
  const newLines = next.split("\n");
  const newLine = newLines[lineIndex];
  const shift = newLine.length - oldLine.length;
  const oldItem = parseListLine(oldLine);
  // Only shift if the caret is after the marker.
  const newColumn = oldItem && column >= oldItem.indent.length + oldItem.marker.length ? column + shift : column;
  const lineStart = newLines.slice(0, lineIndex).reduce((sum, l) => sum + l.length + 1, 0);
  return { text: next, caret: lineStart + Math.max(0, Math.min(newColumn, newLine.length)) };
}

function stripMarker(line: string) {
  const item = parseListLine(line);
  return item ? `${item.indent}${item.content}` : line;
}

/**
 * Toggles a list on a block of lines, like Docs' bullet/number buttons:
 * if every non-empty line is already that kind of list, remove the markers;
 * otherwise make every non-empty line an item of that kind.
 */
export function toggleList(lines: readonly string[], kind: "bullet" | "number"): string[] {
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  if (nonEmpty.length === 0) return [kind === "bullet" ? `${BULLET} ` : "1. "];
  const allSame = nonEmpty.every((l) => parseListLine(l)?.kind === kind);
  if (allSame) return lines.map(stripMarker);
  let n = 0;
  return lines.map((line) => {
    if (line.trim() === "") return line;
    const plain = stripMarker(line);
    const indent = plain.match(/^\s*/)![0];
    n += 1;
    return `${indent}${kind === "bullet" ? BULLET : `${n}.`} ${plain.slice(indent.length)}`;
  });
}

/** Backspace right after a marker removes the marker (Docs behaviour). */
export function backspaceRemovesMarker(beforeCaretOnLine: string): string | null {
  const item = parseListLine(beforeCaretOnLine + "x");
  if (!item || item.content !== "x") return null;
  return item.indent;
}
