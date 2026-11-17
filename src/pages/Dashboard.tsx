import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ProjectActions } from "../components/dashboard/ProjectActions";
import { ProjectGrid } from "../components/dashboard/ProjectGrid";
import { EmptyState } from "../components/dashboard/EmptyState";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
import { errorMessage, useToast } from "../components/common/toastContext";
import { MoonIcon, PlusIcon, SunIcon, UploadIcon } from "../components/common/icons";
import { useProjects, type ProjectListItem } from "../hooks/useProjects";
import { setThemePreference, useThemePreference } from "../lib/theme";
import {
  createProject,
  deleteProject,
  duplicateProject,
  renameProject,
} from "../services/projectService";
import {
  exportProjectById,
  importProjectFile,
  type ExportFormat,
} from "../services/importExportService";
import type { SortKey } from "../types/project";

const SORT_KEY_STORAGE = "mindboard:sort";

function readSort(): SortKey {
  try {
    const v = localStorage.getItem(SORT_KEY_STORAGE);
    if (v === "updatedAt" || v === "createdAt" || v === "name") return v;
  } catch {
    /* ignore */
  }
  return "updatedAt";
}

export default function Dashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const theme = useThemePreference();
  const { projects, error } = useProjects();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>(readSort);
  const [pendingDelete, setPendingDelete] = useState<ProjectListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    if (!projects) return [];
    const q = query.trim().toLowerCase();
    const filtered = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
    return [...filtered].sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
        : b[sort] - a[sort],
    );
  }, [projects, query, sort]);

  const handleSort = (next: SortKey) => {
    setSort(next);
    try {
      localStorage.setItem(SORT_KEY_STORAGE, next);
    } catch {
      /* ignore */
    }
  };

  const handleCreate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const project = await createProject();
      navigate(`/project/${project.id}`);
    } catch (err) {
      toast(errorMessage(err, "Couldn't create a project."), "error");
      setBusy(false);
    }
  }, [busy, navigate, toast]);

  const handleImport = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      let imported = 0;
      for (const file of Array.from(files)) {
        try {
          await importProjectFile(file);
          imported += 1;
        } catch (err) {
          toast(errorMessage(err, `Couldn't import ${file.name}.`), "error");
        }
      }
      if (imported) toast(`Imported ${imported} ${imported === 1 ? "file" : "files"}`);
    },
    [toast],
  );

  const actions = useMemo(
    () => ({
      onOpen: (id: string) => navigate(`/project/${id}`),
      onRename: (id: string, name: string) => {
        renameProject(id, name).catch((err) =>
          toast(errorMessage(err, "Couldn't rename project."), "error"),
        );
      },
      onDuplicate: (id: string) => {
        duplicateProject(id)
          .then((copy) => toast(`Created “${copy.name}”`))
          .catch((err) => toast(errorMessage(err, "Couldn't duplicate project."), "error"));
      },
      onExport: (id: string, format: ExportFormat) => {
        exportProjectById(id, format).catch((err) =>
          toast(errorMessage(err, "Export failed."), "error"),
        );
      },
      onDelete: (project: ProjectListItem) => setPendingDelete(project),
    }),
    [navigate, toast],
  );

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    try {
      await deleteProject(target.id);
      toast(`Deleted “${target.name}”`);
    } catch (err) {
      toast(errorMessage(err, "Couldn't delete project."), "error");
    }
  };

  return (
    <div
      className="mb-dashboard"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        void handleImport(e.dataTransfer.files);
      }}
    >
      <header className="mb-dashboard__header">
        <div className="mb-brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span className="mb-brand__name">Mindboard</span>
        </div>
        <div className="mb-dashboard__header-actions">
          <button
            type="button"
            className="mb-icon-button"
            onClick={() => setThemePreference(theme === "dark" ? "light" : "dark")}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <button
            type="button"
            className="mb-button"
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadIcon />
            <span className="mb-hide-sm">Import</span>
          </button>
          <button
            type="button"
            className="mb-button mb-button--primary"
            onClick={() => void handleCreate()}
            disabled={busy}
          >
            <PlusIcon />
            New mind map
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".excalidraw,application/json,.json"
            multiple
            hidden
            onChange={(e) => {
              void handleImport(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      <main className="mb-dashboard__main">
        {error && <div className="mb-banner mb-banner--error">{error}</div>}
        {projects === null ? null : projects.length === 0 ? (
          <EmptyState
            onCreate={() => void handleCreate()}
            onImport={() => fileInputRef.current?.click()}
          />
        ) : (
          <>
            <ProjectActions
              query={query}
              onQueryChange={setQuery}
              sort={sort}
              onSortChange={handleSort}
              count={visible.length}
              total={projects.length}
            />
            {visible.length === 0 ? (
              <p className="mb-no-results">No mind maps match “{query}”.</p>
            ) : (
              <ProjectGrid projects={visible} {...actions} />
            )}
          </>
        )}
      </main>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete project"
          confirmLabel="Delete"
          danger
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        >
          “{pendingDelete.name}” will be permanently deleted. This can't be undone.
        </ConfirmDialog>
      )}
    </div>
  );
}
