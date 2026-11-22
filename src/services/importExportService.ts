/**
 * Import/export in the native Excalidraw format (.excalidraw JSON),
 * plus PNG/SVG image export via Excalidraw's own exporters.
 */
import { loadExcalidraw } from "../lib/excalidraw";
import { createProject, pickPersistedAppState } from "./projectService";
import { projectStorage } from "./projectStorage";
import { updateThumbnail } from "./thumbnailService";
import type {
  BinaryFiles,
  ExcalidrawElement,
  PersistedAppState,
  Project,
} from "../types/project";
import { visibleTabs } from "../lib/tabs";

export type ExportFormat = "excalidraw" | "png" | "svg";

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "mindboard";
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One canvas to export: a tab of a project. */
export interface ExportableCanvas {
  fileName: string;
  elements: readonly ExcalidrawElement[];
  appState: PersistedAppState;
  files: BinaryFiles;
}

async function exportCanvas(canvas: ExportableCanvas, format: ExportFormat) {
  const { serializeAsJSON, exportToBlob, exportToSvg, MIME_TYPES } = await loadExcalidraw();
  const elements = canvas.elements.filter((el) => !el.isDeleted);
  const base = safeFileName(canvas.fileName);

  if (format === "excalidraw") {
    const json = serializeAsJSON(elements, canvas.appState, canvas.files, "local");
    downloadBlob(new Blob([json], { type: MIME_TYPES.excalidraw }), `${base}.excalidraw`);
    return;
  }

  const appState = {
    viewBackgroundColor: canvas.appState.viewBackgroundColor ?? "#ffffff",
    exportBackground: true,
    exportWithDarkMode: false,
    exportEmbedScene: false,
  };

  if (format === "png") {
    const blob = await exportToBlob({
      elements,
      appState: { ...appState, exportScale: 2 },
      files: canvas.files,
      exportPadding: 16,
      mimeType: MIME_TYPES.png,
    });
    downloadBlob(blob, `${base}.png`);
  } else {
    const svg = await exportToSvg({
      elements,
      appState,
      files: canvas.files,
      exportPadding: 16,
    });
    downloadBlob(new Blob([svg.outerHTML], { type: MIME_TYPES.svg }), `${base}.svg`);
  }
}

/**
 * Exports a project. With `tabId`, just that tab; otherwise every tab, one
 * file each (a .excalidraw file holds a single canvas). Files are named
 * "Project" for single-tab projects and "Project - Tab" otherwise.
 */
export async function exportProject(project: Project, format: ExportFormat, tabId?: string) {
  const all = visibleTabs(project.tabs);
  const tabs = tabId ? all.filter((t) => t.id === tabId) : all;
  const exportable =
    format === "excalidraw" ? tabs : tabs.filter((t) => t.elements.some((el) => !el.isDeleted));
  if (exportable.length === 0) {
    throw new Error(
      tabId ? "This tab is empty — nothing to export." : "This mindboard is empty — nothing to export.",
    );
  }
  for (const [i, tab] of exportable.entries()) {
    // Browsers drop rapid back-to-back downloads; space them out.
    if (i > 0) await new Promise((r) => setTimeout(r, 400));
    await exportCanvas(
      {
        fileName: all.length > 1 ? `${project.name} - ${tab.name}` : project.name,
        elements: tab.elements,
        appState: tab.appState,
        files: project.files,
      },
      format,
    );
  }
}

export async function exportProjectById(id: string, format: ExportFormat) {
  const project = await projectStorage.loadProject(id);
  if (!project) throw new Error("Project not found");
  await exportProject(project, format);
}

/** Imports a .excalidraw (or Excalidraw-embedded PNG/SVG) file as a new project. */
export async function importProjectFile(file: File): Promise<Project> {
  const { loadFromBlob } = await loadExcalidraw();
  let scene;
  try {
    scene = await loadFromBlob(file, null, null);
  } catch (err) {
    throw new Error(
      `"${file.name}" isn't a valid Excalidraw file${err instanceof Error ? ` (${err.message})` : ""}.`,
    );
  }
  const elements = scene.elements.filter((el) => !el.isDeleted);
  const name = file.name.replace(/\.(excalidraw|json|png|svg)$/i, "");
  const appState = pickPersistedAppState(scene.appState as unknown as Record<string, unknown>);
  const project = await createProject({ name, elements, appState, files: scene.files ?? {} });
  // Fire-and-forget; a thumbnail failure shouldn't fail the import.
  updateThumbnail(project.id).catch(console.error);
  return project;
}
