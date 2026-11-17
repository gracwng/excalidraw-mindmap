/**
 * Tiny pub/sub so the dashboard refreshes when projects change —
 * in this tab (EventTarget) or in other tabs (BroadcastChannel).
 */
const EVENT = "projects-changed";
const local = new EventTarget();
const channel =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("mindboard-projects") : null;

export function notifyProjectsChanged() {
  local.dispatchEvent(new Event(EVENT));
  channel?.postMessage(EVENT);
}

export function subscribeProjectsChanged(listener: () => void) {
  local.addEventListener(EVENT, listener);
  const onMessage = () => listener();
  channel?.addEventListener("message", onMessage);
  return () => {
    local.removeEventListener(EVENT, listener);
    channel?.removeEventListener("message", onMessage);
  };
}
