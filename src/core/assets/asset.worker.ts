/// <reference lib="webworker" />
/**
 * Asset worker: owns the download scheduler, the IndexedDB content cache and integrity checks,
 * so none of the network / IDB / hashing work touches the main thread.
 *
 * Cache layout (DB "northern-assets"):
 *   blobs: hash -> ArrayBuffer
 *   meta:  hash -> { hash, id, size, segment, lastUsed }
 */
import { openDB, reqP, txDone } from "./idb";
import { SEGMENTS, segmentIndex, type ResolvedEntry, type SegmentId } from "./manifest";
import type { FromWorker, SegmentProgress, ToWorker } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

interface Meta {
  hash: string;
  id: string;
  size: number;
  segment: SegmentId;
  lastUsed: number;
}

const NEAR_RADIUS = 160; // metres: "close to the player" tier
const BACKGROUND_SLOTS_WHEN_URGENT = 2;
const MAX_RETRIES = 3;

let db: IDBDatabase;
let entries = new Map<string, ResolvedEntry>();
const cached = new Set<string>(); // hashes present in IDB
const inflight = new Map<string, { ctrl: AbortController; urgent: boolean; received: number }>();
const demands = new Map<string, number[]>(); // id -> request ids waiting for data
const failures = new Map<string, number>();
let segment: SegmentId = "menu";
let player: { x: number; z: number } | null = null;
let concurrency = 6;
let paused = false;

// bandwidth estimate (bytes/s), exponentially smoothed over ~3s windows
let bwBytes = 0;
let bwStart = performance.now();
let bps = 0;

function post(msg: FromWorker, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

async function initDB() {
  db = await openDB("northern-assets", 1, (d) => {
    d.createObjectStore("blobs");
    d.createObjectStore("meta");
  });
  const keys = (await reqP(db.transaction("meta").objectStore("meta").getAllKeys())) as string[];
  for (const k of keys) cached.add(k);
}

// ---------------------------------------------------------------- priorities

/** Lower is more urgent. Returns null for "do not schedule now". */
function rank(e: ResolvedEntry): number[] {
  const cur = segmentIndex(segment);
  const si = segmentIndex(e.segment);
  if (demands.has(e.id)) return [0, 0, -e.priority];
  const opt = e.optional ? 1 : 0;
  if (si === cur) return [1, opt, -e.priority];
  if (si === cur + 1) return [2, opt, -e.priority];
  if (si > cur && player && e.pos) {
    const d = Math.hypot(e.pos[0] - player.x, e.pos[1] - player.z);
    if (d < NEAR_RADIUS) return [3, d, -e.priority];
  }
  if (si > cur) return [4, si, -e.priority];
  // Segments already passed: only fetched last, to complete the offline cache.
  return [5, si, -e.priority];
}

function cmp(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function isUrgent(e: ResolvedEntry) {
  return demands.has(e.id) || e.segment === segment;
}

function pump() {
  if (!db) return;
  const candidates: { e: ResolvedEntry; r: number[] }[] = [];
  for (const e of entries.values()) {
    if (cached.has(e.hash) || inflight.has(e.id)) continue;
    if ((failures.get(e.id) ?? 0) >= MAX_RETRIES && !demands.has(e.id)) continue;
    if (paused && !demands.has(e.id)) continue;
    candidates.push({ e, r: rank(e) });
  }
  candidates.sort((a, b) => cmp(a.r, b.r));

  const urgentWaiting = candidates.some((c) => isUrgent(c.e)) || [...inflight.values()].some((f) => f.urgent);
  let background = [...inflight.values()].filter((f) => !f.urgent).length;

  // When something urgent is waiting and all slots are busy, cancel background downloads so the
  // urgent items get the bandwidth now; they are re-queued automatically.
  if (urgentWaiting && inflight.size >= concurrency) {
    for (const [id, f] of inflight) {
      if (inflight.size < concurrency || background <= BACKGROUND_SLOTS_WHEN_URGENT) break;
      if (!f.urgent && candidates.some((c) => isUrgent(c.e))) {
        f.ctrl.abort("preempted");
        inflight.delete(id);
        background--;
      }
    }
  }

  for (const { e } of candidates) {
    if (inflight.size >= concurrency) break;
    const urgent = isUrgent(e);
    if (!urgent && urgentWaiting && background >= BACKGROUND_SLOTS_WHEN_URGENT) continue;
    if (!urgent) background++;
    void download(e, urgent);
  }
  scheduleProgress();
}

// ---------------------------------------------------------------- download

async function sha256Hex(buf: ArrayBuffer) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  let s = "";
  for (const b of d) s += b.toString(16).padStart(2, "0");
  return s;
}

async function download(e: ResolvedEntry, urgent: boolean) {
  const ctrl = new AbortController();
  const rec = { ctrl, urgent, received: 0 };
  inflight.set(e.id, rec);
  try {
    const res = await fetch(e.url, { signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const out = new Uint8Array(e.size);
    const reader = res.body.getReader();
    let off = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (off + value.length > out.length) throw new Error("size mismatch");
      out.set(value, off);
      off += value.length;
      rec.received = off;
      bwBytes += value.length;
      scheduleProgress();
    }
    if (off !== e.size) throw new Error(`short read ${off}/${e.size}`);
    const buf = out.buffer;
    const h = await sha256Hex(buf);
    if (h !== e.hash) throw new Error(`hash mismatch for ${e.id}`);
    // Hand the data to waiting callers first (cloning for all but the last), then persist.
    await store(e, buf);
    inflight.delete(e.id);
    deliver(e, buf, false);
  } catch (err) {
    if (inflight.get(e.id) === rec) inflight.delete(e.id);
    if (ctrl.signal.aborted) {
      // preempted or cancelled: will be re-ranked on next pump
    } else {
      const n = (failures.get(e.id) ?? 0) + 1;
      failures.set(e.id, n);
      post({ t: "log", message: `download failed ${e.id} (${n}/${MAX_RETRIES}): ${String(err)}` });
      if (n >= MAX_RETRIES) failDemands(e.id, String(err));
      else await new Promise((r) => setTimeout(r, 500 * 2 ** n));
    }
  } finally {
    pump();
  }
}

async function store(e: ResolvedEntry, buf: ArrayBuffer) {
  const meta: Meta = { hash: e.hash, id: e.id, size: e.size, segment: e.segment, lastUsed: Date.now() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await ensureRoom(e.size);
      const tx = db.transaction(["blobs", "meta"], "readwrite");
      tx.objectStore("blobs").put(buf, e.hash);
      tx.objectStore("meta").put(meta, e.hash);
      await txDone(tx);
      cached.add(e.hash);
      return;
    } catch (err) {
      if (attempt === 0 && (err as DOMException)?.name === "QuotaExceededError") {
        await evict(e.size * 2 + 32 * 1024 * 1024, true);
        continue;
      }
      // Could not persist: the data is still delivered from memory to whoever asked for it.
      post({ t: "log", message: `cache write failed for ${e.id}: ${String(err)}` });
      return;
    }
  }
}

function deliver(e: ResolvedEntry, buf: ArrayBuffer, fromCache: boolean) {
  const reqs = demands.get(e.id);
  if (!reqs) return;
  demands.delete(e.id);
  reqs.forEach((req, i) => {
    const last = i === reqs.length - 1;
    const b = last ? buf : buf.slice(0);
    post({ t: "data", req, id: e.id, buf: b, fromCache }, [b]);
  });
}

function failDemands(id: string, message: string) {
  const reqs = demands.get(id);
  demands.delete(id);
  for (const req of reqs ?? []) post({ t: "error", req, id, message });
}

async function readCached(e: ResolvedEntry): Promise<ArrayBuffer | undefined> {
  const tx = db.transaction(["blobs", "meta"], "readwrite");
  const buf = (await reqP(tx.objectStore("blobs").get(e.hash))) as ArrayBuffer | undefined;
  if (buf) {
    const metaStore = tx.objectStore("meta");
    const m = (await reqP(metaStore.get(e.hash))) as Meta | undefined;
    if (m) {
      m.lastUsed = Date.now();
      m.segment = e.segment;
      metaStore.put(m, e.hash);
    }
  }
  await txDone(tx).catch(() => {});
  return buf;
}

async function handleGet(req: number, id: string) {
  const e = entries.get(id);
  if (!e) {
    post({ t: "error", req, id, message: `unknown asset ${id}` });
    return;
  }
  const list = demands.get(id);
  if (list) {
    list.push(req);
    return;
  }
  demands.set(id, [req]);
  if (cached.has(e.hash)) {
    try {
      const buf = await readCached(e);
      if (buf) {
        deliver(e, buf, true);
        return;
      }
    } catch (err) {
      post({ t: "log", message: `cache read failed ${id}: ${String(err)}` });
    }
    cached.delete(e.hash); // stale index; fall through to network
  }
  failures.delete(id);
  // Already downloading in the background: upgrade it to urgent, data arrives via deliver().
  const f = inflight.get(id);
  if (f) f.urgent = true;
  pump();
}

// ---------------------------------------------------------------- eviction

async function ensureRoom(bytes: number) {
  if (!navigator.storage?.estimate) return;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  if (quota && usage + bytes > quota * 0.9) await evict(usage + bytes - quota * 0.85, false);
}

/** Least-recently-used eviction of assets outside the current/next segment. */
async function evict(bytes: number, aggressive: boolean) {
  const all = (await reqP(db.transaction("meta").objectStore("meta").getAll())) as Meta[];
  const cur = segmentIndex(segment);
  const protectedSeg = (s: SegmentId) => {
    const i = segmentIndex(s);
    return i === cur || (!aggressive && i === cur + 1);
  };
  const protectedIds = new Set(demands.keys());
  const victims = all
    .filter((m) => !protectedSeg(m.segment) && !protectedIds.has(m.id))
    .sort((a, b) => a.lastUsed - b.lastUsed);
  let freed = 0;
  const tx = db.transaction(["blobs", "meta"], "readwrite");
  for (const v of victims) {
    if (freed >= bytes) break;
    tx.objectStore("blobs").delete(v.hash);
    tx.objectStore("meta").delete(v.hash);
    cached.delete(v.hash);
    freed += v.size;
  }
  await txDone(tx);
  post({ t: "log", message: `evicted ${(freed / 1e6).toFixed(1)} MB` });
}

/** Remove cache entries that no longer belong to the current manifest (old versions). */
async function dropStale() {
  const live = new Set([...entries.values()].map((e) => e.hash));
  const stale = [...cached].filter((h) => !live.has(h));
  if (!stale.length) return;
  const tx = db.transaction(["blobs", "meta"], "readwrite");
  for (const h of stale) {
    tx.objectStore("blobs").delete(h);
    tx.objectStore("meta").delete(h);
    cached.delete(h);
  }
  await txDone(tx);
  post({ t: "log", message: `removed ${stale.length} stale cache entries` });
}

// ---------------------------------------------------------------- progress

let progressTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleProgress() {
  if (progressTimer) return;
  progressTimer = setTimeout(() => {
    progressTimer = null;
    sendProgress();
  }, 250);
}

function sendProgress() {
  const now = performance.now();
  const dt = (now - bwStart) / 1000;
  if (dt > 0.5) {
    const inst = bwBytes / dt;
    bps = bps ? bps * 0.6 + inst * 0.4 : inst;
    bwBytes = 0;
    bwStart = now;
  }
  const segs = new Map<SegmentId, SegmentProgress>();
  for (const s of SEGMENTS)
    segs.set(s, { segment: s, bytesTotal: 0, bytesDone: 0, filesTotal: 0, filesDone: 0, startBytesTotal: 0, startBytesDone: 0 });
  for (const e of entries.values()) {
    const p = segs.get(e.segment)!;
    p.bytesTotal += e.size;
    p.filesTotal++;
    if (!e.optional) p.startBytesTotal += e.size;
    let done = 0;
    if (cached.has(e.hash)) {
      done = e.size;
      p.filesDone++;
    } else {
      done = inflight.get(e.id)?.received ?? 0;
    }
    p.bytesDone += done;
    if (!e.optional) p.startBytesDone += done;
  }
  const queued = [...entries.values()].filter((e) => !cached.has(e.hash) && !inflight.has(e.id)).length;
  post({ t: "progress", segments: [...segs.values()], bps, active: inflight.size, queued });
  if (inflight.size) scheduleProgress();
}

// ---------------------------------------------------------------- messages

const ready = initDB();

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  if (m.t !== "init") await ready;
  switch (m.t) {
    case "init": {
      await ready;
      entries = new Map(m.entries.map((e) => [e.id, e]));
      segment = m.segment;
      concurrency = m.concurrency;
      const byHash = new Map(m.entries.map((e) => [e.hash, e.id]));
      post({ t: "ready", cachedIds: [...cached].map((h) => byHash.get(h)).filter((x): x is string => !!x) });
      pump();
      setTimeout(() => void dropStale(), 5000);
      break;
    }
    case "get":
      await handleGet(m.req, m.id);
      break;
    case "segment": {
      segment = m.segment;
      // Cancel background downloads for segments the player has left behind.
      const cur = segmentIndex(segment);
      for (const [id, f] of inflight) {
        const e = entries.get(id)!;
        if (segmentIndex(e.segment) < cur && !demands.has(id)) {
          f.ctrl.abort("segment passed");
          inflight.delete(id);
        } else {
          f.urgent = isUrgent(e);
        }
      }
      pump();
      break;
    }
    case "player":
      player = { x: m.x, z: m.z };
      pump();
      break;
    case "pause":
      paused = m.paused;
      if (paused) {
        for (const [id, f] of inflight) {
          if (!demands.has(id)) {
            f.ctrl.abort("paused");
            inflight.delete(id);
          }
        }
      }
      pump();
      break;
    case "stats": {
      const all = (await reqP(db.transaction("meta").objectStore("meta").getAll())) as Meta[];
      const est = navigator.storage?.estimate ? await navigator.storage.estimate() : { usage: 0, quota: 0 };
      post({
        t: "stats",
        req: m.req,
        stats: {
          assetBytes: all.reduce((s, x) => s + x.size, 0),
          assetCount: all.length,
          usage: est.usage ?? 0,
          quota: est.quota ?? 0,
        },
      });
      break;
    }
    case "clear": {
      paused = true;
      for (const f of inflight.values()) f.ctrl.abort("cleared");
      inflight.clear();
      const tx = db.transaction(["blobs", "meta"], "readwrite");
      tx.objectStore("blobs").clear();
      tx.objectStore("meta").clear();
      await txDone(tx);
      cached.clear();
      post({ t: "cleared", req: m.req });
      sendProgress();
      break;
    }
  }
};
