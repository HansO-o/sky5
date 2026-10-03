/** Story segments in play order. Asset download order follows this list. */
export const SEGMENTS = ["menu", "cart", "muster", "execution", "dragon", "keep", "exit"] as const;
export type SegmentId = (typeof SEGMENTS)[number];

export function segmentIndex(s: SegmentId): number {
  return SEGMENTS.indexOf(s);
}

export type AssetType = "glb" | "ktx2" | "audio" | "hdr" | "json" | "bin";

export interface AssetVariant {
  url: string;
  /** Full SHA-256 hex of the file bytes; also the IndexedDB key. */
  hash: string;
  size: number;
}

export interface ManifestEntry extends AssetVariant {
  id: string;
  type: AssetType;
  segment: SegmentId;
  /** 0..100, higher downloads first within a tier. */
  priority: number;
  /** Optional world position (x, z) used for "near the player" prioritisation. */
  pos?: [number, number];
  /** Not required to enter the segment; streams in while it plays. */
  optional?: boolean;
  /** Audio only: loops seamlessly. */
  loop?: boolean;
  /** Audio only: alternate encodings keyed by codec. The build picks `url/hash/size` = opus. */
  variants?: { opus: AssetVariant; aac: AssetVariant };
}

export interface Manifest {
  version: string;
  generated: string;
  assets: ManifestEntry[];
}

/** A manifest entry after codec resolution, as used by the downloader. */
export type ResolvedEntry = Omit<ManifestEntry, "variants">;

export function resolveManifest(m: Manifest, canOpus: boolean): ResolvedEntry[] {
  return m.assets.map((a) => {
    const { variants, ...rest } = a;
    if (variants && !canOpus) return { ...rest, ...variants.aac };
    return rest;
  });
}
