import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  WelcomeScreen,
  reconcileElements,
} from "@excalidraw/excalidraw";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import "@excalidraw/excalidraw/index.css";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { registerActiveEditor } from "../../lib/activeEditors";
import { EditorHeader } from "./EditorHeader";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { errorMessage, useToast } from "../common/toastContext";
import { ArrowLeftIcon, PlusIcon } from "../common/icons";
import { useAutosave } from "../../hooks/useAutosave";
import { getThemePreference, setThemePreference, useThemePreference } from "../../lib/theme";
import {
  createProject,
  deleteProject,
  duplicateProject,
  pickPersistedAppState,
  renameProject,
} from "../../services/projectService";
import { exportProject, type ExportFormat } from "../../services/importExportService";
import type { Project } from "../../types/project";

interface DrawingEditorProps {
  project: Project;
}

/**
 * The official Excalidraw editor with project persistence wired in.
 * Mounted with `key={project.id}` so switching projects always gets a fresh
 * editor and a fresh autosave pipeline — no state can leak between projects.
 */
export function DrawingEditor({ project }: DrawingEditorProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const theme = useThemePreference();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [name, setName] = useState(project.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const autosave = useAutosave(project.id, project.files);

  // Computed once: Excalidraw only reads initialData on mount.
  const [initialData] = useState<ExcalidrawInitialDataState>(() => {
    const hasViewport = project.appState.scrollX !== undefined;
    return {
      elements: project.elements,
      appState: { ...project.appState, theme: getThemePreference() },
      files: project.files,
      // Imported scenes have no saved viewport — frame the content instead.
      scrollToContent: !hasViewport && project.elements.length > 0,
    };
  });

  const { onChange: autosaveOnChange, flush: autosaveFlush, adoptBaseline } = autosave;

  // Let the sync engine merge changes from other devices into this open editor.
  useEffect(() => {
    return registerActiveEditor(project.id, {
      flush: autosaveFlush,
      mergeRemote: (remoteElements, files) => {
        const api = apiRef.current;
        if (!api) return remoteElements;
        if (files.length) api.addFiles(files);
        const merged = reconcileElements(
          api.getSceneElementsIncludingDeleted(),
          remoteElements as readonly RemoteExcalidrawElement[],
          api.getAppState(),
        );
        // NEVER: remote changes don't go into this device's undo history.
        api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
        const current = api.getSceneElementsIncludingDeleted();
        adoptBaseline(current, api.getAppState(), api.getFiles());
        return current;
      },
      onRemoteRename: (next) => setName(next),
      onRemoteDelete: () => {
        toast("This mind map was deleted on another device.");
        navigate("/", { replace: true });
      },
    });
  }, [project.id, autosaveFlush, adoptBaseline, navigate, toast]);
  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      autosaveOnChange(elements, appState, files);
      // Excalidraw's own theme toggle drives the app-wide preference.
      if (appState.theme !== getThemePreference()) setThemePreference(appState.theme);
    },
    [autosaveOnChange],
  );

  /** The freshest scene, straight from the editor (falls back to the loaded one). */
  const currentProject = useCallback((): Project => {
    const api = apiRef.current;
    if (!api) return { ...project, name };
    return {
      ...project,
      name,
      elements: api.getSceneElements(),
      appState: pickPersistedAppState(api.getAppState() as unknown as Record<string, unknown>),
      files: api.getFiles(),
    };
  }, [project, name]);

  const handleRename = useCallback(
    async (next: string) => {
      setName(next);
      try {
        await renameProject(project.id, next);
      } catch (err) {
        toast(errorMessage(err, "Couldn't rename project."), "error");
      }
    },
    [project.id, toast],
  );

  const handleDuplicate = useCallback(async () => {
    try {
      await autosave.flush();
      const copy = await duplicateProject(project.id);
      toast(`Duplicated as “${copy.name}”`);
      navigate(`/project/${copy.id}`);
    } catch (err) {
      toast(errorMessage(err, "Couldn't duplicate project."), "error");
    }
  }, [autosave, navigate, project.id, toast]);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      try {
        await exportProject(currentProject(), format);
      } catch (err) {
        toast(errorMessage(err, "Export failed."), "error");
      }
    },
    [currentProject, toast],
  );

  const handleDelete = useCallback(async () => {
    setConfirmDelete(false);
    try {
      await deleteProject(project.id);
      navigate("/", { replace: true });
    } catch (err) {
      toast(errorMessage(err, "Couldn't delete project."), "error");
    }
  }, [navigate, project.id, toast]);

  const handleNewProject = useCallback(async () => {
    try {
      await autosave.flush();
      const created = await createProject();
      navigate(`/project/${created.id}`);
    } catch (err) {
      toast(errorMessage(err, "Couldn't create project."), "error");
    }
  }, [autosave, navigate, toast]);

  return (
    <div className="mb-editor" data-theme={theme}>
      <EditorHeader
        name={name}
        status={autosave.status}
        error={autosave.error}
        onRename={handleRename}
        onRetrySave={() => void autosave.flush()}
        onDuplicate={handleDuplicate}
        onExport={handleExport}
        onDelete={() => setConfirmDelete(true)}
      />
      <div className="mb-editor__canvas">
        <Excalidraw
          excalidrawAPI={(api) => {
            apiRef.current = api;
          }}
          initialData={initialData}
          onChange={onChange}
          name={name}
          handleKeyboardGlobally
          autoFocus
        >
          <MainMenu>
            <MainMenu.Item icon={<ArrowLeftIcon />} onSelect={() => navigate("/")}>
              All projects
            </MainMenu.Item>
            <MainMenu.Item icon={<PlusIcon />} onSelect={() => void handleNewProject()}>
              New mind map
            </MainMenu.Item>
            <MainMenu.Separator />
            <MainMenu.DefaultItems.LoadScene />
            <MainMenu.DefaultItems.SaveToActiveFile />
            <MainMenu.DefaultItems.Export />
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.SearchMenu />
            <MainMenu.DefaultItems.Help />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.Separator />
            <MainMenu.DefaultItems.ToggleTheme />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
          </MainMenu>
          <WelcomeScreen>
            <WelcomeScreen.Hints.MenuHint />
            <WelcomeScreen.Hints.ToolbarHint />
            <WelcomeScreen.Hints.HelpHint />
            <WelcomeScreen.Center>
              <WelcomeScreen.Center.Logo>
                <span className="mb-welcome-logo">Mindboard</span>
              </WelcomeScreen.Center.Logo>
              <WelcomeScreen.Center.Heading>
                Start with a central idea, then branch out.
              </WelcomeScreen.Center.Heading>
              <WelcomeScreen.Center.Menu>
                <WelcomeScreen.Center.MenuItemLoadScene />
                <WelcomeScreen.Center.MenuItemHelp />
              </WelcomeScreen.Center.Menu>
            </WelcomeScreen.Center>
          </WelcomeScreen>
        </Excalidraw>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete project"
          confirmLabel="Delete"
          danger
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmDelete(false)}
        >
          “{name}” will be permanently deleted. This can't be undone.
        </ConfirmDialog>
      )}
    </div>
  );
}
