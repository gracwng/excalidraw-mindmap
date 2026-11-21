/**
 * Owns the signed-in session and runs the sync engine in the background:
 * on sign-in, after local edits, when the cloud changes (realtime), when the
 * app regains focus or comes back online, and every minute as a fallback.
 */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { AppState } from "@excalidraw/excalidraw/types";
import { projectStorage } from "../projectStorage";
import { updateThumbnail } from "../thumbnailService";
import { SupabaseRemote } from "./supabaseRemote";
import { SyncEngine, type MergeElements } from "./syncEngine";
import type { RemoteStore } from "./remote";
import { getActiveEditor } from "../../lib/activeEditors";
import { notifyProjectsChanged, subscribeProjectsChanged } from "../../lib/projectEvents";
import { loadExcalidraw } from "../../lib/excalidraw";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export type SyncStatus =
  | "disabled" // no Supabase configured
  | "loading" // restoring the session
  | "signed-out"
  | "syncing"
  | "synced"
  | "offline"
  | "error";

export interface SyncState {
  status: SyncStatus;
  email: string | null;
  lastSyncedAt: number | null;
  error: string | null;
}

const LAST_USER_KEY = "mindboard:sync-user";
const AFTER_EDIT_DELAY_MS = 1500;
const POLL_INTERVAL_MS = 60_000;
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000];

/** Excalidraw's own reconciliation, loaded only when a background merge is needed. */
const excalidrawMerge: MergeElements = async (local, remote) => {
  const { reconcileElements } = await loadExcalidraw();
  return reconcileElements(
    local as readonly OrderedExcalidrawElement[],
    remote as readonly RemoteExcalidrawElement[],
    {} as AppState,
  );
};

class SyncManager {
  private client: SupabaseClient | null;
  private state: SyncState;
  private listeners = new Set<() => void>();
  private user: Pick<User, "id" | "email"> | null = null;
  private engine: SyncEngine | null = null;
  private teardown: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private rerun = false;
  private failures = 0;

  constructor() {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    this.client =
      url && key
        ? createClient(url, key, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
          })
        : null;
    this.state = {
      status: this.client ? "loading" : "disabled",
      email: null,
      lastSyncedAt: null,
      error: null,
    };
    if (this.client) {
      this.client.auth.onAuthStateChange((_event, session) => {
        // Defer: Supabase recommends not awaiting other calls inside this callback.
        setTimeout(() => void this.setUser(session?.user ?? null), 0);
      });
    }

    // Development/test only: sync against scripts/dev-sync-server.mjs instead of
    // Supabase. The env var is unset in real builds, so this is compiled out.
    const fakeUrl = import.meta.env.VITE_FAKE_SYNC_URL;
    if (fakeUrl) {
      this.client = null;
      this.state = { ...this.state, status: "loading" };
      void import("./httpRemote").then(({ HttpRemote }) => {
        this.fakeRemote = new HttpRemote(fakeUrl);
        void this.setUser({ id: "dev-user", email: "dev@localhost" });
      });
    }
  }

  private fakeRemote: RemoteStore | null = null;

  // --- state for React ---

  getState = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setState(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  // --- auth ---

  async signIn(email: string, password: string) {
    if (!this.client) throw new Error("Sync isn't configured.");
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendlyAuthError(error.message));
  }

  /** Returns true if the account is ready, false if the email must be confirmed first. */
  async signUp(email: string, password: string) {
    if (!this.client) throw new Error("Sync isn't configured.");
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw new Error(friendlyAuthError(error.message));
    return !!data.session;
  }

  async signOut() {
    if (this.fakeRemote) return this.setUser(null);
    await this.client?.auth.signOut();
  }

  private async setUser(user: Pick<User, "id" | "email"> | null) {
    if (user?.id === this.user?.id && this.state.status !== "loading") return;
    this.stop();
    this.user = user;
    const remote: RemoteStore | null = this.fakeRemote
      ? this.fakeRemote
      : user && this.client
        ? new SupabaseRemote(this.client, user.id)
        : null;
    if (!user || !remote) {
      this.setState({
        status: this.client || this.fakeRemote ? "signed-out" : "disabled",
        email: null,
        error: null,
      });
      return;
    }

    // A different account than last time: this device's projects become new uploads for it.
    let lastUser: string | null = null;
    try {
      lastUser = localStorage.getItem(LAST_USER_KEY);
    } catch {
      /* ignore */
    }
    if (lastUser && lastUser !== user.id) await projectStorage.resetSyncState();
    try {
      localStorage.setItem(LAST_USER_KEY, user.id);
    } catch {
      /* ignore */
    }

    this.engine = new SyncEngine({
      storage: projectStorage,
      remote,
      merge: excalidrawMerge,
      getActiveEditor,
      onLocalChange: (projectId, kind) => {
        notifyProjectsChanged();
        if (kind === "updated" && !getActiveEditor(projectId)) {
          void refreshThumbnail(projectId);
        }
      },
    });
    this.setState({ status: "syncing", email: user.email ?? null, error: null });

    this.teardown.push(remote.subscribe(() => this.requestSync(300)));
    this.teardown.push(subscribeProjectsChanged(() => this.requestSync(AFTER_EDIT_DELAY_MS)));
    const onWake = () => this.requestSync(0);
    const onVisible = () => document.visibilityState === "visible" && onWake();
    window.addEventListener("online", onWake);
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(onWake, POLL_INTERVAL_MS);
    this.teardown.push(() => {
      window.removeEventListener("online", onWake);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    });

    this.requestSync(0);
  }

  private stop() {
    for (const fn of this.teardown.splice(0)) fn();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.engine = null;
    this.failures = 0;
  }

  // --- running sync ---

  syncNow() {
    this.failures = 0;
    this.requestSync(0);
  }

  private requestSync(delayMs: number) {
    if (!this.engine) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delayMs);
  }

  private async run() {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    const engine = this.engine;
    if (!engine) return;
    this.setState({ status: "syncing" });
    this.running = (async () => {
      try {
        do {
          this.rerun = false;
          await engine.syncOnce();
        } while (this.rerun && this.engine === engine);
        if (this.engine !== engine) return;
        this.failures = 0;
        this.setState({ status: "synced", lastSyncedAt: Date.now(), error: null });
      } catch (err) {
        if (this.engine !== engine) return;
        console.warn("Sync failed", err);
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        this.setState({
          status: offline ? "offline" : "error",
          error: offline ? null : describeError(err),
        });
        const delay = RETRY_DELAYS_MS[Math.min(this.failures, RETRY_DELAYS_MS.length - 1)];
        this.failures += 1;
        this.requestSync(delay);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }
}

async function refreshThumbnail(projectId: string) {
  const project = await projectStorage.loadProject(projectId);
  if (project) {
    await updateThumbnail(projectId, project.elements, project.appState, project.files).catch(
      (err) => console.warn("Thumbnail update failed", err),
    );
  }
}

function describeError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (/relation .*projects.* does not exist|Could not find the table/i.test(message)) {
    return "The cloud database isn't set up yet (run supabase/schema.sql).";
  }
  if (/Bucket not found/i.test(message)) {
    return "Image storage isn't set up yet (run supabase/schema.sql).";
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return "Can't reach the sync server.";
  }
  return message;
}

function friendlyAuthError(message: string) {
  if (/Invalid login credentials/i.test(message)) return "Wrong email or password.";
  if (/Email not confirmed/i.test(message)) return "Confirm your email first — check your inbox.";
  if (/Signups not allowed/i.test(message)) return "New accounts are turned off for this app.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return "Can't reach the sync server. Check your connection.";
  }
  return message;
}

export const syncManager = new SyncManager();
