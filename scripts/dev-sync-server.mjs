// Development/test-only stand-in for the cloud: serves the in-memory RemoteStore
// (src/services/sync/memoryRemote.ts) over HTTP so two browsers can sync without
// Supabase. Start with `node scripts/dev-sync-server.mjs [port]`, then build or run
// the app with VITE_FAKE_SYNC_URL=http://localhost:<port>.
import { createServer } from "node:http";
import { MemoryRemote } from "../src/services/sync/memoryRemote.ts";

const port = Number(process.argv[2] ?? 8787);
const remote = new MemoryRemote();
const streams = new Set();
remote.subscribe(() => {
  for (const res of streams) res.write("data: change\n\n");
});

const METHODS = new Set([
  "listProjects",
  "getProject",
  "insertProject",
  "updateProject",
  "markDeleted",
  "uploadFile",
  "downloadFile",
  "deleteFiles",
]);

createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.end();

  if (req.url === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write(": connected\n\n");
    streams.add(res);
    req.on("close", () => streams.delete(res));
    return;
  }

  if (req.url === "/debug") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ projects: [...remote.projects.values()], files: [...remote.files.keys()], writes: remote.writes }));
  }

  if (req.method === "POST" && req.url === "/rpc") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { method, args } = JSON.parse(body);
      if (!METHODS.has(method)) throw new Error(`Unknown method ${method}`);
      const result = await remote[method](...args);
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ result: result ?? null }));
    } catch (err) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: String(err) }));
    }
  }
  res.statusCode = 404;
  res.end();
}).listen(port, () => console.log(`[dev-sync-server] listening on http://localhost:${port}`));
