import { Link } from "react-router-dom";
import { Menu } from "../common/Menu";
import { ArrowLeftIcon, CopyIcon, DownloadIcon, ImageIcon, TrashIcon } from "../common/icons";
import { ProjectName } from "./ProjectName";
import { SaveIndicator } from "./SaveIndicator";
import type { SaveStatus } from "../../types/project";
import type { ExportFormat } from "../../services/importExportService";

interface EditorHeaderProps {
  name: string;
  status: SaveStatus;
  error: string | null;
  onRename: (name: string) => void;
  onRetrySave: () => void;
  onDuplicate: () => void;
  onExport: (format: ExportFormat) => void;
  onDelete: () => void;
}

/** `[← Projects]   [Project Name ✎]        [Saved] [⋯]` */
export function EditorHeader(props: EditorHeaderProps) {
  return (
    <header className="mb-editor-header">
      <div className="mb-editor-header__left">
        <Link to="/" className="mb-back-link" title="Back to all projects">
          <ArrowLeftIcon />
          <span>Projects</span>
        </Link>
      </div>
      <div className="mb-editor-header__center">
        <ProjectName name={props.name} onRename={props.onRename} />
      </div>
      <div className="mb-editor-header__right">
        <SaveIndicator status={props.status} error={props.error} onRetry={props.onRetrySave} />
        <Menu
          label="Project actions"
          items={[
            { label: "Duplicate", icon: <CopyIcon />, onSelect: props.onDuplicate },
            "separator",
            {
              label: "Download .excalidraw",
              icon: <DownloadIcon />,
              onSelect: () => props.onExport("excalidraw"),
            },
            { label: "Export as PNG", icon: <ImageIcon />, onSelect: () => props.onExport("png") },
            { label: "Export as SVG", icon: <ImageIcon />, onSelect: () => props.onExport("svg") },
            "separator",
            { label: "Delete project", icon: <TrashIcon />, danger: true, onSelect: props.onDelete },
          ]}
        />
      </div>
    </header>
  );
}
