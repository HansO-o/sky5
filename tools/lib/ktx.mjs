// KTX2 (Basis) encoding with a worker-thread pool and an on-disk cache keyed by input+options.
import { Worker } from "node:worker_threads";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

const CACHE = path.resolve(import.meta.dirname, "../../.cache/ktx");
const N = Math.max(1, os.cpus().length);
const workers = [];
const idle = [];
const queue = [];
const waiting = new Map();
let seq = 0;

function spawn() {
  const w = new Worker(new URL("./ktx-thread.mjs", import.meta.url));
  w.on("message", (m) => {
    const p = waiting.get(m.id);
    waiting.delete(m.id);
    if (m.error) p.reject(new Error(m.error));
    else p.resolve(Buffer.from(m.out));
    idle.push(w);
    drain();
  });
  workers.push(w);
  idle.push(w);
}

function drain() {
  while (idle.length && queue.length) {
    const w = idle.pop();
    const job = queue.shift();
    w.postMessage(job.msg, [job.msg.png.buffer]);
  }
}

function run(png, opts) {
  if (!workers.length) for (let i = 0; i < N; i++) spawn();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    queue.push({ msg: { id, png: new Uint8Array(png), opts } });
    drain();
  });
}

export async function shutdownKtx() {
  await Promise.all(workers.map((w) => w.terminate()));
  workers.length = 0;
  idle.length = 0;
}

/** Encoder presets. */
export const PRESET = {
  color: { isUASTC: false, qualityLevel: 160, compressionLevel: 2, generateMipmap: true, isPerceptual: true },
  colorHQ: { isUASTC: false, qualityLevel: 230, compressionLevel: 2, generateMipmap: true, isPerceptual: true },
  linear: { isUASTC: false, qualityLevel: 140, compressionLevel: 2, generateMipmap: true, isPerceptual: false },
  normal: { isUASTC: false, qualityLevel: 200, compressionLevel: 2, generateMipmap: true, isPerceptual: false, isNormalMap: true },
  sky: { isUASTC: false, qualityLevel: 230, compressionLevel: 2, generateMipmap: false, isPerceptual: true },
};

/**
 * Encode an image (any sharp-readable buffer, or a sharp pipeline factory) to KTX2.
 * @param {Buffer} input
 * @param {{preset: keyof PRESET, maxSize?: number, size?: [number, number]}} o
 */
export async function toKTX2(input, o) {
  const opts = PRESET[o.preset];
  const key = crypto
    .createHash("sha256")
    .update(input)
    .update(JSON.stringify({ opts, maxSize: o.maxSize, size: o.size, v: 2 }))
    .digest("hex");
  const cacheFile = path.join(CACHE, key + ".ktx2");
  try {
    return await fs.readFile(cacheFile);
  } catch {}
  let img = sharp(input);
  const meta = await img.metadata();
  let w = meta.width, h = meta.height;
  if (o.size) [w, h] = o.size;
  else if (o.maxSize && Math.max(w, h) > o.maxSize) {
    const s = o.maxSize / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  // Basis needs multiple-of-4 dims; keep power of two where the source already was.
  const pot = (v) => 2 ** Math.round(Math.log2(v));
  w = pot(w);
  h = pot(h);
  if (w !== meta.width || h !== meta.height) img = img.resize(w, h, { fit: "fill", kernel: "lanczos3" });
  const png = await img.png({ compressionLevel: 1 }).toBuffer();
  const out = await run(png, opts);
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(cacheFile, out);
  return out;
}
