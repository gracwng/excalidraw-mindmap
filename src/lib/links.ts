/**
 * Link helpers for text on the canvas.
 *
 * Excalidraw attaches a link to a whole element (shape or text) rather than to
 * individual words, so we work with that model:
 *   - `[label](url)` typed in a text becomes just "label", with the element linked to url
 *   - a bare URL typed in a text links the element to it
 */
const MARKDOWN_LINK = /\[([^\]\n]+)\]\(\s*((?:https?:\/\/|mailto:|www\.)[^\s)]+)\s*\)/gi;
const BARE_URL = /(?:https?:\/\/|www\.)[^\s<>"']*[^\s<>"'.,;:!?)\]}]/i;
const WHOLE_URL = /^(?:https?:\/\/|mailto:|www\.)[^\s]+$/i;

/** Adds a scheme to "www." links so they open as web pages. */
export function normalizeUrl(url: string) {
  const trimmed = url.trim();
  return /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
}

export function isUrl(text: string) {
  return WHOLE_URL.test(text.trim());
}

export interface TextLinkResult {
  /** The text with `[label](url)` replaced by `label` (unchanged if none). */
  text: string;
  /** URL to attach, if any. */
  url: string | null;
  /** True if the URL came from explicit `[label](url)` syntax (it should replace an existing link). */
  explicit: boolean;
}

export function extractTextLink(text: string): TextLinkResult {
  let firstUrl: string | null = null;
  const replaced = text.replace(MARKDOWN_LINK, (_match, label: string, url: string) => {
    firstUrl ??= normalizeUrl(url);
    return label;
  });
  if (firstUrl) return { text: replaced, url: firstUrl, explicit: true };
  const bare = text.match(BARE_URL);
  return { text, url: bare ? normalizeUrl(bare[0]) : null, explicit: false };
}

export function hostOf(url: string) {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export const openLinkShortcut =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform) ? "⌘" : "Ctrl";
