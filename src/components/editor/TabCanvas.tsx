/**
 * One tab's canvas: the stock Excalidraw editor, its autosave pipeline, and
 * the link conveniences. Mounted with `key={tabId}`, so every tab gets a fresh
 * editor and nothing leaks between tabs.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  getCommonBounds,
  newElementWith,
  restoreElements,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type { ClipboardData } from "@excalidraw/excalidraw/clipboard";
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import { useAutosave } from "../../hooks/useAutosave";
import { getThemePreference, setThemePreference } from "../../lib/theme";
import { extractTextLink, hostOf, isUrl, normalizeUrl, openLinkShortcut } from "../../lib/links";
import type { PersistedAppState, SaveStatus } from "../../types/project";

export interface TabCanvasController {
  flush(): Promise<void>;
  api(): ExcalidrawImperativeAPI | null;
  adoptBaseline(elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles): void;
}

interface TabCanvasProps {
  projectId: string;
  tabId: string;
  elements: readonly ExcalidrawElement[];
  appState: PersistedAppState;
  files: BinaryFiles;
  /** Used by Excalidraw for its own export file names. */
  exportName: string;
  controllerRef: MutableRefObject<TabCanvasController | null>;
  onSaveStatus: (status: SaveStatus, error: string | null) => void;
  children?: ReactNode;
}

/**
 * After a box's label gets shorter, put it back where Excalidraw would: centred
 * for the default middle/center alignment (top/bottom and left/right keep their edge).
 */
function recenterInContainer(text: ExcalidrawTextElement, container: ExcalidrawElement) {
  let { x, y } = text;
  if (text.verticalAlign === "middle") y = container.y + (container.height - text.height) / 2;
  if (text.textAlign === "center") x = container.x + (container.width - text.width) / 2;
  return { ...text, x, y };
}

/** Marks text we've already auto-linked, so removing that link later sticks. */
const AUTO_LINKED = "mindboardAutoLinked";

export function TabCanvas(props: TabCanvasProps) {
  const { projectId, tabId, controllerRef, onSaveStatus } = props;
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const autosave = useAutosave(projectId, tabId, props.files);
  const { onChange: autosaveOnChange, flush, adoptBaseline, status, error } = autosave;
  const checkedTexts = useRef(new Map<string, number>());

  // Excalidraw only reads initialData on mount.
  const [initialData] = useState<ExcalidrawInitialDataState>(() => {
    const live = props.elements.filter((el) => !el.isDeleted);
    return {
      elements: props.elements,
      appState: { ...props.appState, theme: getThemePreference() },
      files: props.files,
      // Imported or synced canvases may have no viewport on this device — frame the content.
      scrollToContent: props.appState.scrollX === undefined && live.length > 0,
    };
  });

  useEffect(() => {
    onSaveStatus(status, error);
  }, [status, error, onSaveStatus]);

  useEffect(() => {
    const controller: TabCanvasController = {
      flush,
      api: () => apiRef.current,
      adoptBaseline,
    };
    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [controllerRef, flush, adoptBaseline]);

  /**
   * Turns `[label](url)` into a linked "label", and links text that contains a
   * URL. Runs on text that isn't being edited, once per element version.
   */
  const linkifyTexts = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const editingId = api.getAppState().editingTextElement?.id;
    const all = api.getSceneElementsIncludingDeleted();
    const byId = new Map(all.map((el) => [el.id, el]));
    const replacements = new Map<string, ExcalidrawElement>();
    let firstUrl: string | null = null;

    for (const el of all) {
      if (el.type !== "text" || el.isDeleted || el.id === editingId) continue;
      if (checkedTexts.current.get(el.id) === el.version) continue;
      checkedTexts.current.set(el.id, el.version);

      const text = el as ExcalidrawTextElement;
      const { text: newText, url, explicit } = extractTextLink(text.originalText ?? text.text);
      if (!url) continue;
      const container = text.containerId ? byId.get(text.containerId) : undefined;
      const target = container && !container.isDeleted ? container : text;
      const alreadyAuto = !!text.customData?.[AUTO_LINKED];
      // Bare URLs link once; explicit [label](url) always (re)links.
      if (!explicit && (alreadyAuto || target.link)) continue;

      let updatedText: ExcalidrawElement = newElementWith(text, {
        text: newText,
        originalText: newText,
        customData: { ...text.customData, [AUTO_LINKED]: true },
        ...(target === text ? { link: url } : {}),
      });
      if (newText !== (text.originalText ?? text.text)) {
        // Re-measure (and re-wrap inside a box) now that the text is shorter.
        const subset = all.filter((e) => e.id === text.id || e.id === container?.id);
        const restored = restoreElements(
          subset.map((e) => (e.id === text.id ? updatedText : e)),
          null,
          { refreshDimensions: true, repairBindings: true },
        );
        updatedText = restored.find((e) => e.id === text.id) ?? updatedText;
        if (container) updatedText = recenterInContainer(updatedText as ExcalidrawTextElement, container);
      }
      replacements.set(text.id, updatedText);
      if (target !== text) replacements.set(target.id, newElementWith(target, { link: url }));
      firstUrl ??= url;
    }

    if (replacements.size === 0) return;
    api.updateScene({
      elements: all.map((el) => replacements.get(el.id) ?? el),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    for (const el of replacements.values()) checkedTexts.current.set(el.id, el.version);
    if (firstUrl) {
      api.setToast({
        message: `Linked to ${hostOf(firstUrl)} · ${openLinkShortcut}-click to open`,
        duration: 3000,
      });
    }
  }, []);

  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      autosaveOnChange(elements, appState, files);
      // Excalidraw's own theme toggle drives the app-wide preference.
      if (appState.theme !== getThemePreference()) setThemePreference(appState.theme);
      // Defer: don't update the scene from inside Excalidraw's change callback.
      setTimeout(linkifyTexts, 0);
    },
    [autosaveOnChange, linkifyTexts],
  );

  /** Pasting a URL while shapes are selected links them instead of adding a URL box. */
  const onPaste = useCallback((data: ClipboardData) => {
    const api = apiRef.current;
    const text = data.text?.trim();
    if (!api || !text || !isUrl(text) || data.elements?.length) return true;
    const appState = api.getAppState();
    if (appState.editingTextElement) return true;
    const selected = new Set(
      Object.entries(appState.selectedElementIds)
        .filter(([, on]) => on)
        .map(([id]) => id),
    );
    if (selected.size === 0) return true;

    const url = normalizeUrl(text);
    const all = api.getSceneElementsIncludingDeleted();
    const byId = new Map(all.map((el) => [el.id, el]));
    // A box's label links the box itself.
    const targets = new Set<string>();
    for (const id of selected) {
      const el = byId.get(id);
      if (!el || el.isDeleted) continue;
      targets.add(el.type === "text" && el.containerId ? el.containerId : el.id);
    }
    api.updateScene({
      elements: all.map((el) => (targets.has(el.id) ? newElementWith(el, { link: url }) : el)),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    api.setToast({
      message: `Linked to ${hostOf(url)} · ${openLinkShortcut}-click to open`,
      duration: 3000,
    });
    return false;
  }, []);

  // ⌘/Ctrl-click anywhere on a linked shape or text opens its link.
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  useEffect(() => {
    if (!api) return;
    return api.onPointerDown((_tool, pointerDownState, event) => {
      if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return;
      const { x, y } = pointerDownState.origin;
      const elements = api.getSceneElements();
      const byId = new Map(elements.map((el) => [el.id, el]));
      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i];
        const [x1, y1, x2, y2] = getCommonBounds([el as NonDeletedExcalidrawElement]);
        if (x < x1 || x > x2 || y < y1 || y > y2) continue;
        const container = el.type === "text" && el.containerId ? byId.get(el.containerId) : null;
        const link = el.link ?? container?.link;
        if (!link) continue;
        window.open(normalizeUrl(link), "_blank", "noopener,noreferrer");
        return;
      }
    });
  }, [api]);

  return (
    <Excalidraw
      excalidrawAPI={(instance) => {
        apiRef.current = instance;
        setApi(instance);
      }}
      initialData={initialData}
      onChange={onChange}
      onPaste={onPaste}
      name={props.exportName}
      handleKeyboardGlobally
      autoFocus
    >
      {props.children}
    </Excalidraw>
  );
}
