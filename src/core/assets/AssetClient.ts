import { resolveManifest, type Manifest, type ResolvedEntry, type SegmentId } from "./manifest";
import type { CacheStats, FromWorker, SegmentProgress, ToWorker } from "./protocol";

type Listener = (p: { segments: SegmentProgress[]; bps: number; active: number; queued: number }) => void;

/**
 * Main-thread facade for the asset worker. All network, IndexedDB and hashing happens in the
 * worker; the main thread only receives transferred ArrayBuffers.
 */
export class AssetClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners = new Set<Listener>();
  private entries = new Map<string, ResolvedEntry>();
  private readyP: Promise<string[]>;
  private resolveReady!: (ids: string[]) => void;
  /** Latest progress snapshot. */
  progress: { segments: SegmentProgress[]; bps: number; active: number; queued: number } | null = null;
  readonly cachedAtStart = new Set<string>();

  constructor() {
    this.worker = new Worker(new URL("./asset.worker.ts", import.meta.url), { type: "module", name: "assets" });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onMessage(ev.data);
    this.readyP = new Promise((r) => (this.resolveReady = r));
  }

  private send(m: ToWorker) {
    this.worker.postMessage(m);
  }

  private onMessage(m: FromWorker) {
    switch (m.t) {
      case "ready":
        m.cachedIds.forEach((id) => this.cachedAtStart.add(id));
        this.resolveReady(m.cachedIds);
        break;
      case "data":
        this.pending.get(m.req)?.resolve(m.buf);
        this.pending.delete(m.req);
        break;
      case "error":
        this.pending.get(m.req)?.reject(new Error(m.message));
        this.pending.delete(m.req);
        break;
      case "stats":
        this.pending.get(m.req)?.resolve(m.stats);
        this.pending.delete(m.req);
        break;
      case "cleared":
        this.pending.get(m.req)?.resolve(undefined);
        this.pending.delete(m.req);
        break;
      case "progress": {
        const { t: _t, ...p } = m;
        this.progress = p;
        this.listeners.forEach((l) => l(p));
        break;
      }
      case "log":
        console.info("[assets]", m.message);
        break;
    }
  }

  private call<T>(make: (req: number) => ToWorker): Promise<T> {
    const req = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(req, { resolve, reject });
      this.send(make(req));
    });
  }

  async init(manifest: Manifest, segment: SegmentId) {
    const canOpus = typeof Audio !== "undefined" && new Audio().canPlayType('audio/ogg; codecs="opus"') !== "";
    // absolute URLs: the worker would otherwise resolve them against its own script location
    const resolved = resolveManifest(manifest, canOpus).map((e) => ({ ...e, url: new URL(e.url, document.baseURI).href }));
    for (const e of resolved) this.entries.set(e.id, e);
    this.send({ t: "init", entries: resolved, segment, concurrency: 6 });
    return this.readyP;
  }

  has(id: string) {
    return this.entries.has(id);
  }

  entry(id: string) {
    return this.entries.get(id);
  }

  idsFor(segment: SegmentId) {
    return [...this.entries.values()].filter((e) => e.segment === segment).map((e) => e.id);
  }

  /** Fetch an asset (cache first). Requests jump to the front of the download queue. */
  get(id: string): Promise<ArrayBuffer> {
    return this.call<ArrayBuffer>((req) => ({ t: "get", req, id }));
  }

  setSegment(segment: SegmentId) {
    this.send({ t: "segment", segment });
  }

  private lastPos = { x: NaN, z: NaN };
  setPlayerPosition(x: number, z: number) {
    if (Math.hypot(x - this.lastPos.x, z - this.lastPos.z) < 10) return;
    this.lastPos = { x, z };
    this.send({ t: "player", x, z });
  }

  setPaused(paused: boolean) {
    this.send({ t: "pause", paused });
  }

  stats() {
    return this.call<CacheStats>((req) => ({ t: "stats", req }));
  }

  clear() {
    return this.call<void>((req) => ({ t: "clear", req }));
  }

  onProgress(l: Listener) {
    this.listeners.add(l);
    if (this.progress) l(this.progress);
    return () => this.listeners.delete(l);
  }

  segmentProgress(segment: SegmentId) {
    return this.progress?.segments.find((s) => s.segment === segment);
  }

  /** Ids that must be present before the segment can start. */
  startPack(segment: SegmentId) {
    return [...this.entries.values()].filter((e) => e.segment === segment && !e.optional).map((e) => e.id);
  }

  /** 0..1 progress of a segment's start pack. */
  startPackProgress(segment: SegmentId) {
    const p = this.segmentProgress(segment);
    if (!p || !p.startBytesTotal) return p ? 1 : 0;
    return p.startBytesDone / p.startBytesTotal;
  }

  /** Estimated seconds until `segment` is fully downloaded (Infinity if unknown). */
  etaSeconds(segment: SegmentId) {
    const p = this.segmentProgress(segment);
    if (!p) return Infinity;
    const left = p.bytesTotal - p.bytesDone;
    if (left <= 0) return 0;
    return this.progress!.bps > 0 ? left / this.progress!.bps : Infinity;
  }
}

export const assets = new AssetClient();
