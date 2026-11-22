import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
  shortcut?: string;
  /** Shown but not selectable; `hint` explains why. */
  disabled?: boolean;
  hint?: string;
}

export type MenuEntry = MenuItem | "separator";

interface MenuProps {
  items: MenuEntry[];
  label: string;
  align?: "start" | "end";
  trigger?: ReactNode;
  className?: string;
  /** Non-interactive content shown above the items. */
  header?: ReactNode;
  /** Controlled open state (e.g. to open the menu on right-click). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerTitle?: string;
}

/** A small dropdown styled after Excalidraw's own dropdown menus. */
export function Menu({
  items,
  label,
  align = "end",
  trigger,
  className,
  header,
  open: controlledOpen,
  onOpenChange,
  triggerTitle,
}: MenuProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(open) : next;
    if (controlledOpen === undefined) setInternalOpen(value);
    onOpenChange?.(value);
  };
  // The outside-click/Escape listeners always close via the latest setter.
  const closeRef = useRef(() => setOpen(false));
  useEffect(() => {
    closeRef.current = () => setOpen(false);
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // The menu floats above the page (portal + fixed position) so scrolling or
  // clipping containers, like the tab strip, can't cut it off. It's placed
  // under its button as soon as it mounts, before the browser paints.
  const placeContent = (el: HTMLDivElement | null) => {
    contentRef.current = el;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!el || !rect) return;
    el.style.top = `${rect.bottom + 4}px`;
    if (align === "end") el.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    else el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - el.offsetWidth - 8))}px`;
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !contentRef.current?.contains(target)) {
        closeRef.current();
      }
    };
    const onViewportChange = () => closeRef.current();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      contentRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus();
    }
  }, [open]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = Array.from(
      contentRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
        [],
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? index + 1 : index - 1;
    buttons[(next + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div className={`mb-menu ${className ?? ""}`} ref={rootRef}>
      <button
        type="button"
        className={`mb-icon-button ${trigger ? "mb-icon-button--wide" : ""}`}
        aria-label={label}
        title={triggerTitle ?? label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {trigger ?? <DotsIcon />}
      </button>
      {open &&
        createPortal(
        <div
          ref={placeContent}
          id={menuId}
          role="menu"
          aria-label={label}
          className={`mb-menu__content mb-menu__content--${align}`}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={onMenuKeyDown}
        >
          {header}
          {header && <div className="mb-menu__separator" role="separator" />}
          {items.map((item, i) =>
            item === "separator" ? (
              <div key={`sep-${i}`} className="mb-menu__separator" role="separator" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={`mb-menu__item ${item.danger ? "mb-menu__item--danger" : ""}`}
                disabled={item.disabled}
                title={item.hint}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon && <span className="mb-menu__icon">{item.icon}</span>}
                <span className="mb-menu__label">
                  {item.label}
                  {item.disabled && item.hint && <span className="mb-menu__hint">{item.hint}</span>}
                </span>
                {item.shortcut && <span className="mb-menu__shortcut">{item.shortcut}</span>}
              </button>
            ),
          )}
        </div>,
          document.body,
        )}
    </div>
  );
}

export function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}
