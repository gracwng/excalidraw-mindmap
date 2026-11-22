import { useEffect, useRef, useState } from "react";
import { Menu } from "../common/Menu";
import { CopyIcon, PencilIcon, PlusIcon, TrashIcon } from "../common/icons";
import type { TabMeta } from "../../types/project";

interface TabStripProps {
  tabs: TabMeta[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDelete: (id: string) => void;
}

/** Google Docs-style tabs for the canvases in a project. Double-click a tab to rename it. */
export function TabStrip(props: TabStripProps) {
  const { tabs, activeTabId } = props;
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (renamingId) inputRef.current?.select();
  }, [renamingId]);

  // Keep the active tab visible when the strip scrolls.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId, tabs.length]);

  const startRename = (tab: TabMeta) => {
    setDraft(tab.name);
    setRenamingId(tab.id);
  };
  const commitRename = () => {
    const id = renamingId;
    setRenamingId(null);
    const name = draft.trim();
    const tab = tabs.find((t) => t.id === id);
    if (id && tab && name && name !== tab.name) props.onRename(id, name);
  };

  return (
    <div className="mb-tabs">
      <div className="mb-tabs__list" role="tablist" aria-label="Tabs" ref={listRef}>
        {tabs.map((tab, index) => {
          const active = tab.id === activeTabId;
          if (renamingId === tab.id) {
            return (
              <input
                key={tab.id}
                ref={inputRef}
                className="mb-tab mb-tab--editing"
                value={draft}
                aria-label="Tab name"
                maxLength={60}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setRenamingId(null);
                  e.stopPropagation();
                }}
              />
            );
          }
          return (
            <div
              key={tab.id}
              className={`mb-tab ${active ? "mb-tab--active" : ""} ${menuFor === tab.id ? "mb-tab--menu-open" : ""}`}
              onContextMenu={(e) => {
                // Right-click a tab for its options, like Google Docs / Sheets.
                e.preventDefault();
                setMenuFor(tab.id);
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="mb-tab__label"
                title={active ? `${tab.name} — double-click to rename` : tab.name}
                onClick={() => props.onSelect(tab.id)}
                onDoubleClick={() => startRename(tab)}
              >
                {tab.name}
              </button>
              <Menu
                label={`Options for tab ${tab.name}`}
                triggerTitle="Tab options (or right-click the tab)"
                className="mb-tab__menu"
                align="start"
                open={menuFor === tab.id}
                onOpenChange={(open) => setMenuFor(open ? tab.id : null)}
                trigger={<span className="mb-tab__chevron" aria-hidden="true">▾</span>}
                items={[
                  { label: "Rename", icon: <PencilIcon />, onSelect: () => startRename(tab) },
                  { label: "Duplicate", icon: <CopyIcon />, onSelect: () => props.onDuplicate(tab.id) },
                  ...(index > 0 ? [{ label: "Move left", onSelect: () => props.onMove(tab.id, -1) }] : []),
                  ...(index < tabs.length - 1
                    ? [{ label: "Move right", onSelect: () => props.onMove(tab.id, 1) }]
                    : []),
                  "separator" as const,
                  {
                    label: "Delete tab",
                    icon: <TrashIcon />,
                    danger: true,
                    disabled: tabs.length < 2,
                    hint: tabs.length < 2 ? "A mindboard needs at least one tab" : undefined,
                    onSelect: () => props.onDelete(tab.id),
                  },
                ]}
              />
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="mb-icon-button mb-tabs__add"
        aria-label="Add tab"
        title="Add tab"
        onClick={props.onAdd}
      >
        <PlusIcon />
      </button>
    </div>
  );
}
