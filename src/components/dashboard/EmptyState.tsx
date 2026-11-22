import { PlusIcon, UploadIcon } from "../common/icons";

interface EmptyStateProps {
  onCreate: () => void;
  onImport: () => void;
}

export function EmptyState({ onCreate, onImport }: EmptyStateProps) {
  return (
    <div className="mb-empty">
      <svg className="mb-empty__art" viewBox="0 0 240 140" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <ellipse cx="120" cy="70" rx="30" ry="17" />
          <path d="M94 62 C 82 54, 72 44, 62 38" />
          <path d="M146 62 C 158 54, 168 44, 180 37" />
          <path d="M94 78 C 82 88, 74 98, 64 104" />
          <path d="M146 78 C 158 88, 168 98, 180 104" />
          <rect x="22" y="26" width="40" height="22" rx="6" />
          <rect x="180" y="26" width="40" height="22" rx="6" />
          <rect x="24" y="94" width="40" height="22" rx="6" />
          <rect x="180" y="94" width="40" height="22" rx="6" />
        </g>
      </svg>
      <h2 className="mb-handwritten">No mindboards yet</h2>
      <p>Create your first one, or import an existing .excalidraw file.</p>
      <div className="mb-empty__actions">
        <button type="button" className="mb-button mb-button--primary" onClick={onCreate}>
          <PlusIcon />
          New mindboard
        </button>
        <button type="button" className="mb-button" onClick={onImport}>
          <UploadIcon />
          Import
        </button>
      </div>
    </div>
  );
}
