/**
 * Changing a text element's words from code, the way Excalidraw would after
 * you typed them: re-measure the text, re-wrap it inside its box, and keep a
 * box label centred.
 */
import { newElementWith, restoreElements } from "@excalidraw/excalidraw";
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";

/** Excalidraw's padding between a box's edge and its label. */
const BOUND_TEXT_PADDING = 5;

/** Horizontal inset of the area text can use inside a shape (as Excalidraw computes it). */
function innerInsetX(container: ExcalidrawElement) {
  if (container.type === "ellipse") return (container.width / 2) * (1 - Math.SQRT1_2);
  if (container.type === "diamond") return container.width / 4;
  return 0;
}

/**
 * Puts a box label where Excalidraw would after its size or alignment changed:
 * centred vertically for "middle", and placed per its left/center/right alignment.
 */
function positionInContainer(text: ExcalidrawTextElement, container: ExcalidrawElement) {
  let { x, y } = text;
  if (text.verticalAlign === "middle") y = container.y + (container.height - text.height) / 2;
  const inset = innerInsetX(container) + BOUND_TEXT_PADDING;
  if (text.textAlign === "center") x = container.x + (container.width - text.width) / 2;
  else if (text.textAlign === "left") x = container.x + inset;
  else if (text.textAlign === "right") x = container.x + container.width - inset - text.width;
  return { ...text, x, y };
}

/**
 * Returns a new version of `text` with `newText` (and any extra updates),
 * measured and positioned correctly. `all` is the current scene.
 */
export function withNewText(
  all: readonly ExcalidrawElement[],
  text: ExcalidrawTextElement,
  newText: string,
  extra: Partial<ExcalidrawTextElement> = {},
): ExcalidrawTextElement {
  let updated = newElementWith(text, { ...extra, text: newText, originalText: newText });
  const container = text.containerId
    ? all.find((e) => e.id === text.containerId && !e.isDeleted)
    : undefined;
  if (newText === (text.originalText ?? text.text)) {
    return container && extra.textAlign ? positionInContainer(updated, container) : updated;
  }
  // restoreElements re-measures (and re-wraps inside a box) when asked to.
  const subset = all.filter((e) => e.id === text.id || e.id === container?.id);
  const restored = restoreElements(
    subset.map((e) => (e.id === text.id ? updated : e)),
    null,
    { refreshDimensions: true, repairBindings: true },
  );
  updated = (restored.find((e) => e.id === text.id) as ExcalidrawTextElement) ?? updated;
  return container ? positionInContainer(updated, container) : updated;
}
