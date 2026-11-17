// Copies Excalidraw's bundled fonts into /public so the canvas fonts are
// self-hosted (window.EXCALIDRAW_ASSET_PATH = "/") instead of fetched from a CDN.
// Runs automatically before `dev` and `build`.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
const dest = resolve(root, "public/fonts");

if (!existsSync(src)) {
  console.error(`[copy-excalidraw-assets] Missing ${src}. Did you run npm install?`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("[copy-excalidraw-assets] Copied Excalidraw fonts to public/fonts");
