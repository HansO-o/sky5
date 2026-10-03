import type { ResolvedEntry, SegmentId } from "./manifest";

export interface SegmentProgress {
  segment: SegmentId;
  bytesTotal: number;
  bytesDone: number;
  filesTotal: number;
  filesDone: number;
  /** Bytes of the segment's start pack (non-optional assets). */
  startBytesTotal: number;
  startBytesDone: number;
}

export interface CacheStats {
  /** Bytes of asset data we hold in IndexedDB. */
  assetBytes: number;
  assetCount: number;
  /** navigator.storage.estimate() as seen from the worker. */
  usage: number;
  quota: number;
}

/** Main thread -> worker */
export type ToWorker =
  | { t: "init"; entries: ResolvedEntry[]; segment: SegmentId; concurrency: number }
  | { t: "get"; req: number; id: string }
  | { t: "segment"; segment: SegmentId }
  | { t: "player"; x: number; z: number }
  | { t: "pause"; paused: boolean }
  | { t: "stats"; req: number }
  | { t: "clear"; req: number };

/** Worker -> main thread */
export type FromWorker =
  | { t: "ready"; cachedIds: string[] }
  | { t: "data"; req: number; id: string; buf: ArrayBuffer; fromCache: boolean }
  | { t: "error"; req: number; id: string; message: string }
  | { t: "progress"; segments: SegmentProgress[]; bps: number; active: number; queued: number; caching: boolean }
  | { t: "stats"; req: number; stats: CacheStats }
  | { t: "cleared"; req: number }
  | { t: "log"; message: string };
