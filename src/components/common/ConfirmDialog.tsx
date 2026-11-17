import { useEffect, useRef, type ReactNode } from "react";

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modal confirmation, modelled on Excalidraw's "Clear canvas" dialog. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  return (
    <div className="mb-modal" role="presentation" onPointerDown={onCancel}>
      <div
        className="mb-modal__dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="mb-confirm-title"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 id="mb-confirm-title" className="mb-modal__title">
          {title}
        </h2>
        <div className="mb-modal__body">{children}</div>
        <div className="mb-modal__actions">
          <button ref={cancelRef} type="button" className="mb-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={`mb-button ${danger ? "mb-button--danger" : "mb-button--primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
