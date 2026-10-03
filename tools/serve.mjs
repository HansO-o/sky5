// Static server for dist/ with brotli, immutable caching for hashed files and an optional shared
// bandwidth limit to simulate a home connection:  node tools/serve.mjs --port 4173 --mbps 20 --latency 20
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const ROOT = path.resolve(arg("root", path.join(import.meta.dirname, "../dist")));
const PORT = +arg("port", 4173);
const MBPS = +arg("mbps", 0);
const LATENCY = +arg("latency", 0);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".ktx2": "image/ktx2",
  ".hdr": "application/octet-stream", ".bin": "application/octet-stream", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
  ".png": "image/png", ".svg": "image/svg+xml",
};
const brCache = new Map();
function brotli(file, buf, mtime) {
  const key = `${file}:${buf.length}:${mtime}`;
  let b = brCache.get(key);
  if (!b) {
    b = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } });
    brCache.set(key, b);
  }
  return b;
}

// shared token bucket across all responses
let tokens = 0;
const rate = (MBPS * 1e6) / 8; // bytes per second
let lastFill = Date.now();
const waiters = [];
function take(n) {
  if (!MBPS) return Promise.resolve();
  return new Promise((res) => {
    waiters.push({ n, res });
    pump();
  });
}
function pump() {
  const now = Date.now();
  tokens = Math.min(rate * 0.1, tokens + ((now - lastFill) / 1000) * rate);
  lastFill = now;
  while (waiters.length && tokens >= Math.min(waiters[0].n, rate * 0.05)) {
    const w = waiters.shift();
    tokens -= w.n;
    w.res();
  }
  if (waiters.length) setTimeout(pump, 5);
}

async function send(res, data) {
  const CH = 16 * 1024;
  for (let o = 0; o < data.length; o += CH) {
    const part = data.subarray(o, o + CH);
    await take(part.length);
    if (!res.write(part)) await new Promise((r) => res.once("drain", r));
  }
  res.end();
}

let requests = 0, bytesOut = 0;
http
  .createServer(async (req, res) => {
    requests++;
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/__stats") {
      res.end(JSON.stringify({ requests, bytesOut }));
      return;
    }
    let p = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!p.startsWith(ROOT)) return res.writeHead(403).end();
    if (p.endsWith("/")) p += "index.html";
    let buf;
    try {
      buf = await fs.promises.readFile(p);
    } catch {
      res.writeHead(404).end("not found");
      return;
    }
    if (LATENCY) await new Promise((r) => setTimeout(r, LATENCY));
    const ext = path.extname(p);
    const hashed = /[.-][0-9a-zA-Z_-]{8,}\.\w+$/.test(p) && !p.endsWith("manifest.json");
    const headers = {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
      "cross-origin-opener-policy": "same-origin",
    };
    let body = buf;
    if (/\bbr\b/.test(req.headers["accept-encoding"] ?? "") && ![".ogg", ".m4a", ".png"].includes(ext) && buf.length > 1024) {
      body = brotli(p, buf, (await fs.promises.stat(p)).mtimeMs);
      headers["content-encoding"] = "br";
    }
    headers["content-length"] = body.length;
    res.writeHead(200, headers);
    bytesOut += body.length;
    if (req.method === "HEAD") return res.end();
    await send(res, body);
  })
  .listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}${MBPS ? ` at ${MBPS} Mbps` : ""}`));
