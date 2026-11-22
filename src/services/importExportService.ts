/**
 * Import/export in the native Excalidraw format (.excalidraw JSON),
 * plus PNG/SVG image export via Excalidraw's own exporters.
 */
import { loadExcalidraw } from "../lib/excalidraw";
import { createProject, pickPersistedAppState } from "./projectService";
import { projectStorage } from "./projectStorage";
import { updateThumbnail } from "./thumbnailService";
import type { Project } from "../types/project";

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

export async function exportProject(project: Project, format: ExportFormat) {
  const { serializeAsJSON, exportToBlob, exportToSvg, MIME_TYPES } = await loadExcalidraw();
  const elements = project.elements.filter((el) => !el.isDeleted);
  const base = safeFileName(project.name);

  if (format === "excalidraw") {
    const json = serializeAsJSON(elements, project.appState, project.files, "local");
    downloadBlob(new Blob([json], { type: MIME_TYPES.excalidraw }), `${base}.excalidraw`);
    return;
  }

  if (elements.length === 0) throw new Error("This mindboard is empty — nothing to export.");

  const appState = {
    viewBackgroundColor: project.appState.viewBackgroundColor ?? "#ffffff",
    exportBackground: true,
    exportWithDarkMode: false,
    exportEmbedScene: false,
  };

  if (format === "png") {
    const blob = await exportToBlob({
      elements,
      appState: { ...appState, exportScale: 2 },
      files: project.files,
      exportPadding: 16,
      mimeType: MIME_TYPES.png,
    });
    downloadBlob(blob, `${base}.png`);
  } else {
    const svg = await exportToSvg({
      elements,
      appState,
      files: project.files,
      exportPadding: 16,
    });
    downloadBlob(
      new Blob([svg.outerHTML], { type: MIME_TYPES.svg }),
      `${base}.svg`,
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
  updateThumbnail(project.id, elements, appState, project.files).catch(console.error);
  return project;
}
