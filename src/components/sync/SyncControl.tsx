import { useState } from "react";
import { Menu } from "../common/Menu";
import {
  CloudCheckIcon,
  CloudIcon,
  CloudOffIcon,
  LogoutIcon,
  RefreshIcon,
} from "../common/icons";
import { useSync } from "../../hooks/useSync";
import { syncManager, type SyncState } from "../../services/sync/syncManager";
import { formatRelativeTime } from "../../lib/format";
import { AuthDialog } from "./AuthDialog";

function describe(state: SyncState) {
  switch (state.status) {
    case "syncing":
      return { icon: <CloudIcon />, label: "Syncing…", tone: "busy" };
    case "synced":
      return { icon: <CloudCheckIcon />, label: "Synced", tone: "ok" };
    case "offline":
      return { icon: <CloudOffIcon />, label: "Offline", tone: "muted" };
    case "error":
      return { icon: <CloudOffIcon />, label: "Sync issue", tone: "error" };
    default:
      return { icon: <CloudIcon />, label: "", tone: "muted" };
  }
}

/** Dashboard header control: "Sign in to sync", or sync status + account menu. */
export function SyncControl() {
  const state = useSync();
  const [authOpen, setAuthOpen] = useState(false);

  if (state.status === "disabled" || state.status === "loading") return null;

  if (state.status === "signed-out") {
    return (
      <>
        <button type="button" className="mb-button" onClick={() => setAuthOpen(true)}>
          <CloudIcon />
          <span className="mb-hide-sm">Sign in to sync</span>
        </button>
        {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} />}
      </>
    );
  }

  const { icon, label, tone } = describe(state);
  const detail =
    state.status === "error"
      ? state.error
      : state.lastSyncedAt
        ? `Last synced ${formatRelativeTime(state.lastSyncedAt)}`
        : null;

  return (
    <Menu
      label={`${label}. Account: ${state.email ?? ""}`}
      className={`mb-sync mb-sync--${tone}`}
      trigger={
        <span className="mb-sync__trigger" data-testid="sync-status">
          {icon}
          <span className="mb-hide-sm">{label}</span>
        </span>
      }
      header={
        <div className="mb-sync__header">
          <strong>{state.email}</strong>
          {detail && <span>{detail}</span>}
        </div>
      }
      items={[
        { label: "Sync now", icon: <RefreshIcon />, onSelect: () => syncManager.syncNow() },
        { label: "Sign out", icon: <LogoutIcon />, onSelect: () => void syncManager.signOut() },
      ]}
    />
  );
}

/** Compact status for the editor header. */
export function SyncBadge() {
  const state = useSync();
  if (!["syncing", "synced", "offline", "error"].includes(state.status)) return null;
  const { icon, label, tone } = describe(state);
  const title = state.status === "error" && state.error ? `${label}: ${state.error}` : label;
  return (
    <span className={`mb-sync-badge mb-sync--${tone}`} title={title} aria-label={title} role="status">
      {icon}
    </span>
  );
}
