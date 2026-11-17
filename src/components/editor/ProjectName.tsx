import { useEffect, useRef, useState } from "react";
import { PencilIcon } from "../common/icons";

interface ProjectNameProps {
  name: string;
  onRename: (name: string) => void;
}

/** Click-to-edit project title. Enter/blur commits, Escape cancels. */
export function ProjectName({ name, onRename }: ProjectNameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== name) onRename(next);
    else setDraft(name);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="mb-name-input"
        value={draft}
        aria-label="Project name"
        maxLength={120}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(name);
            setEditing(false);
          }
          // Keep Excalidraw from treating these keystrokes as shortcuts.
          e.stopPropagation();
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="mb-name-button"
      title="Rename"
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
    >
      <span className="mb-name-button__text">{name}</span>
      <span className="mb-name-button__icon">
        <PencilIcon />
      </span>
    </button>
  );
}
