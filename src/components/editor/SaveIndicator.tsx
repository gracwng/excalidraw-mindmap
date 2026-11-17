import { AlertIcon, CheckIcon } from "../common/icons";
import type { SaveStatus } from "../../types/project";

interface SaveIndicatorProps {
  status: SaveStatus;
  error: string | null;
  onRetry: () => void;
}

export function SaveIndicator({ status, error, onRetry }: SaveIndicatorProps) {
  if (status === "error") {
    return (
      <button
        type="button"
        className="mb-save mb-save--error"
        title={error ?? "Save failed"}
        onClick={onRetry}
      >
        <AlertIcon />
        <span>Save failed</span>
        <span className="mb-save__retry">Retry</span>
      </button>
    );
  }
  return (
    <span className="mb-save" role="status" aria-live="polite" data-status={status}>
      {status === "saving" && (
        <>
          <span className="mb-save__dot" aria-hidden="true" />
          <span>Saving…</span>
        </>
      )}
      {(status === "saved" || status === "idle") && (
        <>
          <CheckIcon />
          <span>Saved</span>
        </>
      )}
    </span>
  );
}
