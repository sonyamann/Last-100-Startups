// The Last 100 Startups server. Everything lives under /startups:
//   GET  /startups/               the page (built by Vite into dist/web)
//   GET  /startups/assets/...     the page's scripts and styles
//   GET  /startups/board.json     written by the pipeline (data/board.json)
//   POST /startups/api/merge      make (or fetch) a mashup
//   POST /startups/api/acquire    record a startup fed to an acquirer
//   GET  /startups/api/acquisitions  the acquirers' tallies
//   POST /startups/api/subscribe  newsletter signup (Ghost, double opt-in)
//   GET  /startups/m/<key>        a mashup's shareable page
//   GET  /startups/m/<key>.png    its link-preview image (made once, kept in data/og)
//
// Listens on PORT (default 3003, beside the studio's 3000-3002) and HOST
// (127.0.0.1 in production, behind Caddy). TRUST_PROXY=1 reads visitors'
// addresses from Caddy's X-Forwarded-For. Plain node:http, like the
// studio's other apps.

import "../lib/env.ts";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../lib/db.ts";
import { createAcquisitions } from "./acquisitions.ts";
import { createMerges, loadMashup } from "./merges.ts";
import { createOgImages } from "./ogimage.ts";
import { permalinkHtml } from "./permalink.ts";
import { createSubscribe } from "./subscribe.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const distDir = process.env.DIST_DIR ?? join(root, "dist/web");
const boardPath = process.env.BOARD_PATH ?? join(root, "data/board.json");
const publicUrl = (process.env.PUBLIC_URL ?? "https://studio.sonyasupposedly.com").replace(/\/+$/, "");
const trustProxy = process.env.TRUST_PROXY === "1";

const db = openDb();
const merge = createMerges(db, { boardPath });
const acquisitions = createAcquisitions(db);
const subscribe = createSubscribe();
const og = createOgImages({ root, dataDir: process.env.DATA_DIR ?? join(root, "data"), log: (s) => console.log(s) });

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function send(res: ServerResponse, status: number, body: string, type: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": type, ...headers });
  res.end(body);
}

const json = (res: ServerResponse, status: number, body: unknown) =>
  send(res, status, JSON.stringify(body), "application/json", { "cache-control": "no-store" });

function sendFile(res: ServerResponse, path: string, cache: string): boolean {
  if (!existsSync(path) || !statSync(path).isFile()) return false;
  res.writeHead(200, {
    "content-type": TYPES[extname(path)] ?? "application/octet-stream",
    "content-length": String(statSync(path).size),
    "cache-control": cache,
  });
  createReadStream(path).pipe(res);
  return true;
}

function clientIp(req: IncomingMessage): string {
  const fwd = trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",").at(-1)?.trim() : "";
  return fwd || req.socket.remoteAddress || "?";
}

function readBody(req: IncomingMessage, max = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk;
      if (body.length > max) {
        reject(new Error("too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  // Decoded, so /startups/m/a%2Bb (how some crawlers send "+") finds a+b.
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, "Bad path", "text/plain");
  }

  if (path === "/startups") return send(res, 301, "", "text/plain", { location: "/startups/" });

  if (path === "/startups/board.json") {
    if (!sendFile(res, boardPath, "no-cache")) json(res, 503, { error: "The board isn't ready yet." });
    return;
  }

  if (path === "/startups/api/merge") {
    if (req.method !== "POST") return send(res, 405, "", "text/plain", { allow: "POST" });
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: "Send JSON." });
    }
    const result = await merge(body, clientIp(req));
    return json(res, result.status, result.body);
  }

  if (path === "/startups/api/acquisitions") return json(res, 200, acquisitions.counts());

  if (path === "/startups/api/subscribe") {
    if (req.method !== "POST") return send(res, 405, "", "text/plain", { allow: "POST" });
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req, 2048));
    } catch {
      return json(res, 400, { state: "invalid" });
    }
    const result = await subscribe(body, clientIp(req));
    return json(res, result.status, { state: result.state });
  }

  if (path === "/startups/api/acquire") {
    if (req.method !== "POST") return send(res, 405, "", "text/plain", { allow: "POST" });
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req, 1024));
    } catch {
      return json(res, 400, { error: "Send JSON." });
    }
    const result = acquisitions.record(body, clientIp(req));
    return json(res, result.status, result.body);
  }

  const img = path.match(/^\/startups\/m\/([a-z0-9+-]{3,500})\.png$/);
  if (img) {
    const mashup = loadMashup(db, img[1]!);
    if (!mashup) return send(res, 404, "Not found", "text/plain");
    const file = await og.imagePath(mashup);
    if (!file || !sendFile(res, file, "public, max-age=86400")) return send(res, 503, "No image yet", "text/plain");
    return;
  }

  const m = path.match(/^\/startups\/m\/([a-z0-9+-]{3,500})\/?$/);
  if (m) {
    const key = m[1]!;
    const mashup = loadMashup(db, key);
    if (!mashup) return send(res, 404, `<!doctype html><title>Not found</title><p>That merger never closed. <a href="/startups/">Make one</a>.`, "text/html; charset=utf-8");
    return send(res, 200, permalinkHtml(mashup, `${publicUrl}/startups/m/${key}`), "text/html; charset=utf-8", { "cache-control": "public, max-age=3600" });
  }

  if (path === "/startups/" || path === "/startups/index.html") {
    if (!sendFile(res, join(distDir, "index.html"), "no-cache")) send(res, 503, "Build the page first: npm run build:web", "text/plain");
    return;
  }

  if (path.startsWith("/startups/")) {
    // Static files from the build, without escaping dist/web.
    const rel = normalize(path.slice("/startups/".length));
    if (!rel.startsWith("..") && sendFile(res, join(distDir, rel), rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600")) return;
  }

  send(res, 404, "Not found", "text/plain");
}

const port = Number(process.env.PORT ?? 3003);
const host = process.env.HOST;
createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    console.error(`request failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    if (!res.headersSent) send(res, 500, "Server error", "text/plain");
    else res.end();
  });
}).listen(port, host, () => console.log(`Last 100 Startups listening on http://localhost:${port}/startups/`));
