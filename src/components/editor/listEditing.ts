/**
 * Google Docs-style list behaviour for Excalidraw text, without changing
 * Excalidraw itself. Excalidraw edits text in a plain <textarea
 * class="excalidraw-wysiwyg">; we listen before it does and edit its value the
 * way the browser would (so typing undo still works), which Excalidraw then
 * picks up through its normal input handling.
 *
 * While typing:
 *   "- " or "* " at the start of a line  → "• "
 *   Enter in a list item                  → next "• " / "4. " (Enter on an empty item ends the list)
 *   Backspace right after a marker        → removes the marker
 *   ⌘/Ctrl+Shift+8 / 7                    → toggle bullets / numbers on the selected lines
 *   Tab / Shift+Tab                       → indent / outdent (Excalidraw's own)
 *   Numbered items renumber themselves after every change.
 *
 * With text or boxes selected (not editing), ⌘/Ctrl+Shift+8 / 7 toggles the
 * list on their whole text.
 */
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";
import {
  autoBullet,
  backspaceRemovesMarker,
  onEnter,
  renumberKeepingCaret,
  toggleList,
} from "../../lib/lists";
import { withNewText } from "./textUpdates";

function isTextEditor(target: EventTarget | null): target is HTMLTextAreaElement {
  return target instanceof HTMLTextAreaElement && target.classList.contains("excalidraw-wysiwyg");
}

/** Replaces part of the textarea like typing would (undoable), then places the caret. */
function replaceRange(ta: HTMLTextAreaElement, start: number, end: number, text: string, caret: number) {
  ta.focus();
  ta.setSelectionRange(start, end);
  const ok =
    text === ""
      ? start === end || document.execCommand("delete")
      : document.execCommand("insertText", false, text);
  if (!ok) {
    ta.setRangeText(text, start, end, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  ta.setSelectionRange(caret, caret);
}

function lineBounds(value: string, from: number, to = from) {
  const start = value.lastIndexOf("\n", from - 1) + 1;
  const nl = value.indexOf("\n", to);
  return { start, end: nl === -1 ? value.length : nl };
}

function listShortcut(e: KeyboardEvent): "bullet" | "number" | null {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return null;
  if (e.code === "Digit8") return "bullet";
  if (e.code === "Digit7") return "number";
  return null;
}

export function installListEditing(getApi: () => ExcalidrawImperativeAPI | null) {
  let renumbering = false;

  const renumberNow = (ta: HTMLTextAreaElement) => {
    const { text, caret } = renumberKeepingCaret(ta.value, ta.selectionStart);
    if (text === ta.value) return;
    // Replace only the part that changed.
    let start = 0;
    while (start < text.length && text[start] === ta.value[start]) start++;
    let endOld = ta.value.length;
    let endNew = text.length;
    while (endOld > start && endNew > start && ta.value[endOld - 1] === text[endNew - 1]) {
      endOld--;
      endNew--;
    }
    renumbering = true;
    try {
      replaceRange(ta, start, endOld, text.slice(start, endNew), caret);
    } finally {
      renumbering = false;
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing || e.keyCode === 229) return;
    const shortcut = listShortcut(e);

    if (!isTextEditor(e.target)) {
      if (shortcut) toggleOnSelectedElements(e, shortcut);
      return;
    }
    const ta = e.target;
    const { value, selectionStart: s, selectionEnd: end } = ta;
    const { start: lineStart, end: lineEnd } = lineBounds(value, s);
    const line = value.slice(lineStart, lineEnd);
    const plainKey = !e.metaKey && !e.ctrlKey && !e.altKey;

    if (shortcut) {
      e.preventDefault();
      e.stopPropagation();
      const block = lineBounds(value, s, end);
      const lines = value.slice(block.start, block.end).split("\n");
      const next = toggleList(lines, shortcut).join("\n");
      replaceRange(ta, block.start, block.end, next, block.start + next.length);
      renumberNow(ta);
      return;
    }

    if (e.key === "Enter" && plainKey && !e.shiftKey && s === end) {
      const result = onEnter(line);
      if (!result) return;
      e.preventDefault();
      e.stopPropagation();
      if (result.action === "end-list") {
        replaceRange(ta, lineStart, lineEnd, result.line, lineStart + result.line.length);
      } else {
        replaceRange(ta, s, s, result.text, s + result.text.length);
      }
      renumberNow(ta);
      return;
    }

    if (e.key === " " && plainKey && s === end) {
      const bullet = autoBullet(value.slice(lineStart, s));
      if (!bullet) return;
      e.preventDefault();
      e.stopPropagation();
      replaceRange(ta, lineStart, s, bullet, lineStart + bullet.length);
      return;
    }

    if (e.key === "Backspace" && plainKey && s === end && s > lineStart) {
      const indent = backspaceRemovesMarker(value.slice(lineStart, s));
      if (indent === null) return;
      e.preventDefault();
      e.stopPropagation();
      replaceRange(ta, lineStart, s, indent, lineStart + indent.length);
      renumberNow(ta);
    }
  };

  // Keep numbering right after any edit (typing, deleting lines, Tab-indenting, pasting).
  const onInput = (e: Event) => {
    if (renumbering || !isTextEditor(e.target) || (e as InputEvent).isComposing) return;
    const ta = e.target;
    // Let Excalidraw handle the input first.
    queueMicrotask(() => {
      if (document.activeElement === ta) renumberNow(ta);
    });
  };

  const toggleOnSelectedElements = (e: KeyboardEvent, kind: "bullet" | "number") => {
    const api = getApi();
    if (!api) return;
    const appState = api.getAppState();
    if (appState.editingTextElement) return;
    const selected = Object.keys(appState.selectedElementIds).filter(
      (id) => appState.selectedElementIds[id],
    );
    if (selected.length === 0) return;
    const all: readonly ExcalidrawElement[] = api.getSceneElementsIncludingDeleted();
    const texts = all.filter(
      (el): el is ExcalidrawTextElement =>
        el.type === "text" &&
        !el.isDeleted &&
        (selected.includes(el.id) || (!!el.containerId && selected.includes(el.containerId))),
    );
    if (texts.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const replacements = new Map<string, ExcalidrawElement>();
    for (const text of texts) {
      const lines = (text.originalText ?? text.text).split("\n");
      const next = toggleList(lines, kind).join("\n");
      replacements.set(text.id, withNewText(all, text, next));
    }
    api.updateScene({
      elements: all.map((el) => replacements.get(el.id) ?? el),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  // Capture phase: run before Excalidraw's own handlers.
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("input", onInput, true);
  return () => {
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("input", onInput, true);
  };
}
