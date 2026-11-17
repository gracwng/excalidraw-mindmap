# Mindboard

A browser-based mind-mapping app built **around** the official
[Excalidraw](https://github.com/excalidraw/excalidraw) editor. Inside a project it
*is* Excalidraw — same canvas, tools, menus, shortcuts and dark mode. On top of that it
adds a project dashboard, so you can keep many independent mind maps that save automatically.

## Features

- **Dashboard** — every mind map as a card with a live thumbnail, search,
  sort (last modified / created / name), rename, duplicate, delete, export.
- **The real Excalidraw editor** (`@excalidraw/excalidraw@0.18.1`) with its default UI,
  plus a slim header: `← Projects · Project name ✎ · Saved · ⋯`.
- **Autosave** — debounced (800 ms), race-free, flushed when you leave the project,
  hide the tab or reload. Shows *Saving… / Saved / Save failed* with automatic retry.
- **Exact restore** — elements, images, viewport (scroll and zoom) and your last-used
  styles come back when you reopen a project.
- **Import/export** — native `.excalidraw` files (images included), plus PNG and SVG.
  You can also drag `.excalidraw` files onto the dashboard.
- **Local-first** — everything lives in your browser's IndexedDB. No backend, no account.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build
```

`predev` / `prebuild` copy Excalidraw's fonts into `public/fonts` so the app serves them
itself instead of using a CDN (`window.EXCALIDRAW_ASSET_PATH = "/"`).

When deploying, configure your host to fall back to `index.html` for unknown paths
(SPA routing), so `/project/:id` links work on reload.

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
- Undo history is per session (same as Excalidraw).
- Two tabs editing the *same* project at once will overwrite each other (last write wins).
