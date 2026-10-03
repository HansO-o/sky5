import { openDB, reqP, txDone } from "./assets/idb";
import type { SegmentId } from "./assets/manifest";

export interface SaveGame {
  id: string; // "auto" | "quick" | "manual-<n>"
  kind: "auto" | "quick" | "manual";
  label: string;
  segment: SegmentId;
  createdAt: number;
  playSeconds: number;
  /** Segment-specific state, e.g. cart ride progress. */
  state: Record<string, unknown>;
  /** Small JPEG data URL for the load menu. */
  thumb?: string;
}

const DB_OPEN_TIMEOUT_MS = 8000;

let dbP: Promise<IDBDatabase> | null = null;
function db() {
  if (!dbP) {
    // The open can hang without ever failing (seen in WebKit), so it gets a deadline like the asset worker's.
    // A failure is not cached: a later call opens again.
    const p = Promise.race([
      openDB("northern-saves", 1, (d) => d.createObjectStore("saves", { keyPath: "id" })),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("saves DB open timed out")), DB_OPEN_TIMEOUT_MS)),
    ]);
    p.catch(() => {
      if (dbP === p) dbP = null;
    });
    dbP = p;
  }
  return dbP;
}

export async function writeSave(s: SaveGame) {
  const tx = (await db()).transaction("saves", "readwrite");
  tx.objectStore("saves").put(s);
  await txDone(tx);
}

export async function listSaves(): Promise<SaveGame[]> {
  const all = (await reqP((await db()).transaction("saves").objectStore("saves").getAll())) as SaveGame[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function latestSave() {
  return (await listSaves())[0];
}

export async function deleteSave(id: string) {
  const tx = (await db()).transaction("saves", "readwrite");
  tx.objectStore("saves").delete(id);
  await txDone(tx);
}
