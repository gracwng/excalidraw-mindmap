import { memo, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Menu } from "../common/Menu";
import {
  CopyIcon,
  DownloadIcon,
  ImageIcon,
  OpenIcon,
  PencilIcon,
  TrashIcon,
} from "../common/icons";
import { formatRelativeTime, formatDate } from "../../lib/format";
import type { ProjectListItem } from "../../hooks/useProjects";
import type { ExportFormat } from "../../services/importExportService";

export interface ProjectCardActions {
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onExport: (id: string, format: ExportFormat) => void;
  onDelete: (project: ProjectListItem) => void;
}

interface ProjectCardProps extends ProjectCardActions {
  project: ProjectListItem;
}

export const ProjectCard = memo(function ProjectCard({ project, ...actions }: ProjectCardProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const commitRename = () => {
    setRenaming(false);
    const next = draft.trim();
    if (next && next !== project.name) actions.onRename(project.id, next);
  };

  return (
    <article className="mb-card" data-testid="project-card">
      <Link
        to={`/project/${project.id}`}
        className="mb-card__preview"
        aria-label={`Open ${project.name}`}
        tabIndex={-1}
      >
        {project.thumbnailUrl ? (
          <img src={project.thumbnailUrl} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="mb-card__empty-preview">Empty canvas</span>
        )}
      </Link>
      <div className="mb-card__footer">
        <div className="mb-card__info">
          {renaming ? (
            <input
              ref={inputRef}
              className="mb-card__rename"
              value={draft}
              aria-label="Project name"
              maxLength={120}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            <Link to={`/project/${project.id}`} className="mb-card__title" title={project.name}>
              {project.name}
            </Link>
          )}
          <span
            className="mb-card__meta"
            title={`Created ${formatDate(project.createdAt)}\nEdited ${formatDate(project.updatedAt)}`}
          >
            Edited {formatRelativeTime(project.updatedAt)}
          </span>
        </div>
        <Menu
          label={`More options for ${project.name}`}
          items={[
            { label: "Open", icon: <OpenIcon />, onSelect: () => actions.onOpen(project.id) },
            {
              label: "Rename",
              icon: <PencilIcon />,
              onSelect: () => {
                setDraft(project.name);
                setRenaming(true);
              },
            },
            {
              label: "Duplicate",
              icon: <CopyIcon />,
              onSelect: () => actions.onDuplicate(project.id),
            },
            "separator",
            {
              label: "Download .excalidraw",
              icon: <DownloadIcon />,
              onSelect: () => actions.onExport(project.id, "excalidraw"),
            },
            {
              label: "Export as PNG",
              icon: <ImageIcon />,
              onSelect: () => actions.onExport(project.id, "png"),
            },
            {
              label: "Export as SVG",
              icon: <ImageIcon />,
              onSelect: () => actions.onExport(project.id, "svg"),
            },
            "separator",
            {
              label: "Delete",
              icon: <TrashIcon />,
              danger: true,
              onSelect: () => actions.onDelete(project),
            },
          ]}
        />
      </div>
    </article>
  );
});
