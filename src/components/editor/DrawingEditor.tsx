import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CaptureUpdateAction, MainMenu, WelcomeScreen, reconcileElements } from "@excalidraw/excalidraw";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { registerActiveEditor } from "../../lib/activeEditors";
import { EditorHeader } from "./EditorHeader";
import { TabCanvas, type TabCanvasController } from "./TabCanvas";
import { TabStrip } from "./TabStrip";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { errorMessage, useToast } from "../common/toastContext";
import { ArrowLeftIcon, PlusIcon } from "../common/icons";
import { useThemePreference } from "../../lib/theme";
import { notifyProjectsChanged } from "../../lib/projectEvents";
import {
  bumpTab,
  createTab,
  deleteTab,
  firstTab,
  nextTabName,
  tabMeta,
  visibleTabs,
} from "../../lib/tabs";
import { projectStorage } from "../../services/projectStorage";
import {
  createProject,
  deleteProject,
  duplicateProject,
  renameProject,
} from "../../services/projectService";
import { exportProject, type ExportFormat } from "../../services/importExportService";
import type { Project, ProjectTab, SaveStatus, TabMeta } from "../../types/project";

interface DrawingEditorProps {
  project: Project;
}

interface ActiveTab {
  tab: ProjectTab;
  files: BinaryFiles;
  /** Changes whenever the canvas must be remounted. */
  mountKey: number;
}

type Confirm = { kind: "project" } | { kind: "tab"; tab: TabMeta };

const lastTabKey = (projectId: string) => `mindboard:last-tab:${projectId}`;

function rememberTab(projectId: string, tabId: string) {
  try {
    localStorage.setItem(lastTabKey(projectId), tabId);
  } catch {
    /* ignore */
  }
}

function initialTab(project: Project): ProjectTab {
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(lastTabKey(project.id));
  } catch {
    /* ignore */
  }
  return (
    visibleTabs(project.tabs).find((t) => t.id === remembered) ??
    firstTab(project.tabs) ??
    project.tabs[0]
  );
}

/**
 * A project: a header with its tabs, and the Excalidraw canvas of the open tab.
 * Mounted with `key={project.id}` so switching projects always starts fresh.
 */
export function DrawingEditor({ project }: DrawingEditorProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const theme = useThemePreference();
  const controllerRef = useRef<TabCanvasController | null>(null);
  const [name, setName] = useState(project.name);
  const [tabs, setTabs] = useState<TabMeta[]>(() => visibleTabs(project.tabs).map(tabMeta));
  const [active, setActive] = useState<ActiveTab>(() => ({
    tab: initialTab(project),
    files: project.files,
    mountKey: 0,
  }));
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  const [save, setSave] = useState<{ status: SaveStatus; error: string | null }>({
    status: "idle",
    error: null,
  });
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const onSaveStatus = useCallback((status: SaveStatus, error: string | null) => {
    setSave({ status, error });
  }, []);

  const flushCanvas = useCallback(async () => {
    await controllerRef.current?.flush().catch(() => {});
  }, []);

  /** Shows a tab, reading its latest saved canvas. */
  const openTab = useCallback(
    async (tabId: string) => {
      await flushCanvas();
      const fresh = await projectStorage.loadProject(project.id);
      if (!fresh) {
        navigate("/", { replace: true });
        return;
      }
      const visible = visibleTabs(fresh.tabs);
      const tab = visible.find((t) => t.id === tabId) ?? visible[0];
      if (!tab) return;
      setTabs(visible.map(tabMeta));
      setActive((prev) => ({ tab, files: fresh.files, mountKey: prev.mountKey + 1 }));
      rememberTab(project.id, tab.id);
    },
    [flushCanvas, navigate, project.id],
  );

  /** Applies a change to the tab list and syncs it. */
  const changeTabs = useCallback(
    async (update: (tabs: ProjectTab[]) => ProjectTab[]) => {
      const next = await projectStorage.updateTabs(project.id, update, Date.now());
      setTabs(visibleTabs(next).map(tabMeta));
      notifyProjectsChanged();
      return next;
    },
    [project.id],
  );

  const handleAddTab = useCallback(async () => {
    try {
      await flushCanvas();
      const tab = createTab({
        name: nextTabName(tabs),
        order: Math.max(-1, ...tabs.map((t) => t.order)) + 1,
      });
      await changeTabs((all) => [...all, tab]);
      await openTab(tab.id);
    } catch (err) {
      toast(errorMessage(err, "Couldn't add a tab."), "error");
    }
  }, [changeTabs, flushCanvas, openTab, tabs, toast]);

  const handleRenameTab = useCallback(
    async (id: string, tabName: string) => {
      try {
        await changeTabs((all) =>
          all.map((t) => (t.id === id ? bumpTab(t, { name: tabName }) : t)),
        );
      } catch (err) {
        toast(errorMessage(err, "Couldn't rename the tab."), "error");
      }
    },
    [changeTabs, toast],
  );

  const handleDuplicateTab = useCallback(
    async (id: string) => {
      try {
        await flushCanvas();
        const index = tabs.findIndex((t) => t.id === id);
        const source = tabs[index];
        const after = tabs[index + 1];
        const order = after ? (source.order + after.order) / 2 : source.order + 1;
        let copyId = "";
        await changeTabs((all) => {
          const original = all.find((t) => t.id === id)!;
          const copy = createTab({
            name: `${original.name} (copy)`,
            order,
            elements: structuredClone(original.elements),
            appState: structuredClone(original.appState),
          });
          copyId = copy.id;
          return [...all, copy];
        });
        await openTab(copyId);
      } catch (err) {
        toast(errorMessage(err, "Couldn't duplicate the tab."), "error");
      }
    },
    [changeTabs, flushCanvas, openTab, tabs, toast],
  );

  const handleMoveTab = useCallback(
    async (id: string, direction: -1 | 1) => {
      const index = tabs.findIndex((t) => t.id === id);
      const swapWith = tabs[index + direction];
      if (index === -1 || !swapWith) return;
      const moving = tabs[index];
      try {
        await changeTabs((all) =>
          all.map((t) =>
            t.id === moving.id
              ? bumpTab(t, { order: swapWith.order })
              : t.id === swapWith.id
                ? bumpTab(t, { order: moving.order })
                : t,
          ),
        );
      } catch (err) {
        toast(errorMessage(err, "Couldn't move the tab."), "error");
      }
    },
    [changeTabs, tabs, toast],
  );

  const deleteTabNow = useCallback(
    async (id: string) => {
      try {
        if (id === activeRef.current.tab.id) {
          const index = tabs.findIndex((t) => t.id === id);
          const neighbour = tabs[index - 1] ?? tabs[index + 1];
          if (neighbour) await openTab(neighbour.id);
        }
        await changeTabs((all) => all.map((t) => (t.id === id ? deleteTab(t) : t)));
      } catch (err) {
        toast(errorMessage(err, "Couldn't delete the tab."), "error");
      }
    },
    [changeTabs, openTab, tabs, toast],
  );

  const handleDeleteTab = useCallback(
    async (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (!tab || tabs.length < 2) return;
      // Only ask when there's something to lose.
      await flushCanvas();
      const fresh = await projectStorage.loadProject(project.id);
      const hasContent = fresh?.tabs
        .find((t) => t.id === id)
        ?.elements.some((el) => !el.isDeleted);
      if (hasContent) setConfirm({ kind: "tab", tab });
      else await deleteTabNow(id);
    },
    [deleteTabNow, flushCanvas, project.id, tabs],
  );

  // Let the sync engine merge changes from other devices into this open project.
  useEffect(() => {
    return registerActiveEditor(project.id, {
      flush: flushCanvas,
      mergeRemote: (merged, files) => {
        const visible = visibleTabs(merged);
        setTabs(visible.map(tabMeta));
        const activeId = activeRef.current.tab.id;
        const target = merged.find((t) => t.id === activeId);
        const controller = controllerRef.current;
        const api = controller?.api();

        if (!target || target.deleted) {
          // The open tab was deleted on another device: show its neighbour instead.
          const next = visible[0];
          if (next) {
            const allFiles: BinaryFiles = { ...(api?.getFiles() ?? {}) };
            for (const file of files) allFiles[file.id] = file;
            setActive((prev) => ({ tab: next, files: allFiles, mountKey: prev.mountKey + 1 }));
            rememberTab(project.id, next.id);
            toast("That tab was deleted on another device.");
          }
          return merged;
        }
        if (!api || !controller) return merged;

        if (files.length) api.addFiles(files);
        const reconciled = reconcileElements(
          api.getSceneElementsIncludingDeleted(),
          target.elements as readonly RemoteExcalidrawElement[],
          api.getAppState(),
        );
        // NEVER: changes from other devices don't go into this device's undo history.
        api.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER });
        const current = api.getSceneElementsIncludingDeleted();
        controller.adoptBaseline(current, api.getAppState(), api.getFiles());
        return merged.map((t) => (t.id === activeId ? { ...t, elements: current } : t));
      },
      onRemoteRename: (next) => setName(next),
      onRemoteDelete: () => {
        toast("This mindboard was deleted on another device.");
        navigate("/", { replace: true });
      },
    });
  }, [flushCanvas, navigate, project.id, toast]);

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
      await flushCanvas();
      const copy = await duplicateProject(project.id);
      toast(`Duplicated as “${copy.name}”`);
      navigate(`/project/${copy.id}`);
    } catch (err) {
      toast(errorMessage(err, "Couldn't duplicate project."), "error");
    }
  }, [flushCanvas, navigate, project.id, toast]);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      try {
        await flushCanvas();
        const fresh = await projectStorage.loadProject(project.id);
        if (!fresh) throw new Error("Project not found");
        await exportProject({ ...fresh, name }, format, activeRef.current.tab.id);
      } catch (err) {
        toast(errorMessage(err, "Export failed."), "error");
      }
    },
    [flushCanvas, name, project.id, toast],
  );

  const handleDeleteProject = useCallback(async () => {
    try {
      await deleteProject(project.id);
      navigate("/", { replace: true });
    } catch (err) {
      toast(errorMessage(err, "Couldn't delete project."), "error");
    }
  }, [navigate, project.id, toast]);

  const handleNewProject = useCallback(async () => {
    try {
      await flushCanvas();
      const created = await createProject();
      navigate(`/project/${created.id}`);
    } catch (err) {
      toast(errorMessage(err, "Couldn't create project."), "error");
    }
  }, [flushCanvas, navigate, toast]);

  const activeName = tabs.find((t) => t.id === active.tab.id)?.name ?? active.tab.name;

  return (
    <div className="mb-editor" data-theme={theme}>
      <EditorHeader
        name={name}
        status={save.status}
        error={save.error}
        onRename={handleRename}
        onRetrySave={() => void controllerRef.current?.flush()}
        onDuplicate={handleDuplicate}
        onExport={handleExport}
        onDelete={() => setConfirm({ kind: "project" })}
        exportScope={tabs.length > 1 ? "this tab" : null}
        tabs={
          <TabStrip
            tabs={tabs}
            activeTabId={active.tab.id}
            onSelect={(id) => {
              if (id !== active.tab.id) void openTab(id);
            }}
            onAdd={() => void handleAddTab()}
            onRename={(id, n) => void handleRenameTab(id, n)}
            onDuplicate={(id) => void handleDuplicateTab(id)}
            onMove={(id, d) => void handleMoveTab(id, d)}
            onDelete={(id) => void handleDeleteTab(id)}
          />
        }
      />
      <div className="mb-editor__canvas">
        <TabCanvas
          key={`${active.tab.id}:${active.mountKey}`}
          projectId={project.id}
          tabId={active.tab.id}
          elements={active.tab.elements}
          appState={active.tab.appState}
          files={active.files}
          exportName={tabs.length > 1 ? `${name} - ${activeName}` : name}
          controllerRef={controllerRef}
          onSaveStatus={onSaveStatus}
        >
          <MainMenu>
            <MainMenu.Item icon={<ArrowLeftIcon />} onSelect={() => navigate("/")}>
              All projects
            </MainMenu.Item>
            <MainMenu.Item icon={<PlusIcon />} onSelect={() => void handleNewProject()}>
              New mindboard
            </MainMenu.Item>
            <MainMenu.Item icon={<PlusIcon />} onSelect={() => void handleAddTab()}>
              New tab
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
        </TabCanvas>
      </div>
      {confirm?.kind === "project" && (
        <ConfirmDialog
          title="Delete project"
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            setConfirm(null);
            void handleDeleteProject();
          }}
          onCancel={() => setConfirm(null)}
        >
          “{name}” will be permanently deleted. This can't be undone.
        </ConfirmDialog>
      )}
      {confirm?.kind === "tab" && (
        <ConfirmDialog
          title="Delete tab"
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            const id = confirm.tab.id;
            setConfirm(null);
            void deleteTabNow(id);
          }}
          onCancel={() => setConfirm(null)}
        >
          The tab “{confirm.tab.name}” and everything on it will be deleted. This can't be undone.
        </ConfirmDialog>
      )}
    </div>
  );
}
