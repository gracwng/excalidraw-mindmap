import { useSyncExternalStore } from "react";
import { syncManager } from "../services/sync/syncManager";

export function useSync() {
  return useSyncExternalStore(syncManager.subscribe, syncManager.getState);
}
