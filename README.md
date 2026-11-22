# Mindboard

A browser-based mind-mapping app built **around** the official
[Excalidraw](https://github.com/excalidraw/excalidraw) editor. Inside a project it
*is* Excalidraw — same canvas, tools, menus, shortcuts and dark mode. On top of that it
adds a project dashboard, so you can keep many independent mindboards that save automatically.

## Features

- **Dashboard** — every mindboard as a card with a live thumbnail, search,
  sort (last modified / created / name), rename, duplicate, delete, export.
- **Tabs** — like Google Docs tabs: each mindboard can hold several canvases. Add, rename
  (double-click), duplicate, reorder and delete them from the tab strip in the header.
- **Links** — write `[words](https://…)` in any text or box and it shows just the words,
  linked; a typed URL links itself; paste a URL with shapes selected to link them.
  ⌘-click (Ctrl-click on Windows) a linked shape to open it, or tap its link icon on iPad.
- **The real Excalidraw editor** (`@excalidraw/excalidraw@0.18.1`) with its default UI,
  plus a slim header: `← Projects · Project name ✎ · Saved · ⋯`.
- **Autosave** — debounced (800 ms), race-free, flushed when you leave the project,
  hide the tab or reload. Shows *Saving… / Saved / Save failed* with automatic retry.
- **Exact restore** — elements, images, viewport (scroll and zoom) and your last-used
  styles come back when you reopen a project.
- **Import/export** — native `.excalidraw` files (images included), plus PNG and SVG.
  A `.excalidraw` file holds one canvas: the editor exports the open tab, and the
  dashboard exports one file per tab.
  You can also drag `.excalidraw` files onto the dashboard.
- **Local-first** — everything lives in your browser's IndexedDB and works offline.
- **Optional cloud sync** (Supabase) — sign in on your laptop and iPad and the same mind
  maps appear on both, with live updates and per-shape merging of simultaneous edits.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build
```

`predev` / `prebuild` copy Excalidraw's fonts into `public/fonts` so the app serves them
itself instead of using a CDN (`window.EXCALIDRAW_ASSET_PATH = "/"`).

## Deploying (Vercel) and keeping it private

`vercel.json` already sets up the build, SPA routing, `noindex` headers and caching.

1. Go to [vercel.com/new](https://vercel.com/new), import `gracwng/excalidraw-mindmap` and click **Deploy**.
   Every push to `main` redeploys automatically.
2. Open **Project → Settings → Deployment Protection**, turn on **Vercel Authentication**
   and set it to **All Deployments**. Visitors must then be logged in to your Vercel account.

Without signing in, drawings never leave the device. With sync on, they're stored in your
Supabase project, readable only by your account (row-level security).

### iPad

Open the site in Safari, then **Share → Add to Home Screen** to run it full-screen.
Excalidraw turns on pen mode when it detects an Apple Pencil: the pencil draws and your
fingers pan and zoom. Sign in to sync (below) to see the same projects as on your laptop.

## Cloud sync (Supabase)

`.env` holds the project URL and publishable key. Both are public by design; never put the
`service_role`/secret key in this repo. One-time setup in the Supabase dashboard:

1. **SQL Editor → New query**, paste [`supabase/schema.sql`](supabase/schema.sql), **Run**.
   Creates the `projects` table, a private `mindboard-files` bucket for images, row-level
   security so each account only sees its own data, and realtime updates.
2. **Authentication → URL Configuration**: set *Site URL* to your Vercel URL and add it,
   plus `http://localhost:5173/**`, to *Redirect URLs* (used by the email confirmation link).
3. In the app, **Sign in to sync → Create an account**, confirm the email, then sign in.
4. **Authentication → Sign In / Providers → Email**: turn off *Allow new users to sign up*,
   so nobody else can create an account.

How it works (`src/services/sync/`):

- IndexedDB stays the source of truth on each device; `SyncEngine` mirrors it to the cloud
  in the background (after edits, on realtime notifications, on focus/online, every minute).
- Each project row stores its tabs (`tabs` column) and has a `revision`. Writes only succeed if the cloud is still at the
  revision this device last saw. Otherwise the device downloads the newer copy, merges it
  with Excalidraw's `reconcileElements` (per shape, newer version wins) and retries.
- Deleted shapes are kept as tombstones (`isDeleted`), so deletes win over stale copies.
  Tabs merge the same way: matched by id, name/order/deleted follow the newer tab
  version, and each tab's canvas merges shape by shape. Deleted tabs and projects
  become tombstones.
- Changes arriving for the project you have open are merged into the live canvas,
  outside your undo history.
- Each device keeps its own zoom and scroll position.
- Images are uploaded once to `mindboard-files/<user>/<project>/<file>`.

Signing out keeps this device's local copies. Signing in with a different account uploads
this device's projects to that account.

## Architecture

```text
src/
├── pages/             Dashboard.tsx, ProjectEditor.tsx (lazy-loaded with Excalidraw)
├── components/
│   ├── dashboard/     ProjectCard, ProjectGrid, ProjectActions, EmptyState
│   ├── editor/        DrawingEditor, EditorHeader, ProjectName, SaveIndicator
│   └── common/        Menu, ConfirmDialog, Toast, icons
├── hooks/             useProjects, useProject, useAutosave
├── services/          projectStorage (IndexedDB), projectService,
│                      thumbnailService, importExportService
├── lib/               theme preference, cross-tab change events, formatting
└── types/project.ts
```

### Storage

`services/projectStorage.ts` defines a `ProjectStorage` interface with an IndexedDB
implementation (no React dependencies), so a cloud backend can replace it later.

| Store        | Key                 | Contents                                   |
| ------------ | ------------------- | ------------------------------------------ |
| `projects`   | `id`                | name, createdAt, updatedAt                 |
| `scenes`     | `projectId`         | elements + persisted appState subset       |
| `files`      | `[projectId, id]`   | image data (`BinaryFileData`)               |
| `thumbnails` | `projectId`         | PNG preview blob                           |

Metadata is kept separate from drawing data so the dashboard loads quickly even with
large, image-heavy drawings. Images are only written once, the first time they appear.

### Autosave guarantees (`hooks/useAutosave.ts`)

- Only one write is in flight per project. Each write snapshots the *latest* scene when
  it starts, so an older async save can never overwrite a newer one.
- Cursor moves and selection changes don't trigger writes. Changes are detected by
  diffing element versions, the persisted appState and file ids.
- Viewport-only changes are saved quietly and don't change "last modified".
- Saves that fail stay pending and retry with backoff. Quota errors get a clear message.
- The editor is keyed by project id, so switching projects always starts a fresh editor
  and autosave pipeline.

## Testing

`npm test` runs the sync engine unit tests (two simulated devices with separate
IndexedDB databases and an in-memory cloud: merges, deletes, images, offline, no ping-pong).

`tests/tabs_links_e2e.py` covers tabs and links in one browser, and `tests/tabs_sync_e2e.py`
syncs tabs between two (same setup as the sync test below).

`tests/sync_e2e.py` drives two real browsers ("laptop" and "iPad") against
`scripts/dev-sync-server.mjs`, a local stand-in for Supabase:

```bash
node scripts/dev-sync-server.mjs 8787 &
VITE_FAKE_SYNC_URL=http://localhost:8787 npx vite build --outDir /tmp/dist-fake
npx vite preview --outDir /tmp/dist-fake --port 4174 &
python3 tests/sync_e2e.py http://localhost:4174 http://localhost:8787 sync-output
```

`tests/e2e.py` is a Playwright (Python) end-to-end suite covering create, draw, undo/redo,
refresh, viewport restore, images, thumbnails, duplicate independence, rapid-edit flushing,
import/export, dark mode, search, sort, rename and delete.

```bash
pip install playwright && playwright install chromium
npm run build && npm run preview &
python3 tests/e2e.py http://localhost:4173 test-output
```

## Known notes

- Excalidraw logs `Failed to use workers for subsetting` when exporting under Vite.
  It falls back to the main thread automatically and exports work normally.
- Undo history is per session (same as Excalidraw), and per tab.
- A link belongs to a whole text or shape, not to single words inside it; that's how
  Excalidraw draws text. With several `[label](url)` in one text, the first URL is used.
- With sync off, two tabs editing the *same* project at once will overwrite each other.
  With sync on, they merge.
- Free Supabase projects pause after about a week without use; unpause from the dashboard.
