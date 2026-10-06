// The shapes of `keep/anchors` and `cave/anchors` (design Appendix "Pipeline outputs"): every
// anchor, door, zone and room the keep and the cave gallery are built around. Pure data and small
// helpers (no Babylon). Load them with `loadJSON("keep/anchors")` / `loadJSON("cave/anchors")`.

export type V3 = readonly [number, number, number];

/** One keep anchor (`anchors.<name>`). `world` uses the design's base 37.73; prefer `local` + the runtime keep origin. */
export interface KeepAnchor {
  kind: "light" | "prop" | "use" | "spawn" | "mark" | "cp" | "camera" | "blocker" | "ext" | string;
  local: V3;
  world: V3;
  /** game convention: atan2(−dx, −dz) of the facing */
  yaw?: number;
  /** the air box it stands in, or "outside" */
  room?: string;
  route?: "rebel" | "imperial";
  /** light: sconce / brazier / fire / candle */
  light?: string;
  lightHint?: { intensity: number; range: number; color: V3 };
  /** sconce: the bracket point on the wall, and the wall's normal (into the room) */
  wall?: { local: V3; world: V3 };
  normal?: V3;
  /** prop / use: the suggested asset (`kit/<Model>`, `ph/<id>`, `procprops/<name>`) */
  prop?: string;
  items?: readonly string[];
  item?: string;
  /** blocker: half extents and registry tag */
  half?: V3;
  tag?: string;
  /** cp: the companion's mark (world) */
  companion?: V3;
  /** camera: the point it looks at (world) */
  lookAt?: V3;
  size?: V3;
  who?: string;
  note?: string;
}

export type KeepDoorTag = "g2_door" | "store_door" | "stair_door" | "torture_door" | "cell_gate" | "postern";

export interface KeepDoorDef {
  asset: "keep/interior" | "town/buildings";
  /** the hinge node (identity when closed) */
  node: string;
  leaf: string;
  /** the leaf's box collider node (null: build it from the leaf, the postern) */
  collider: string | null;
  hinge: { local: V3; world: V3 };
  /** radians about +Y at fully open (signed) */
  openYaw: number;
  width: number;
  height: number;
  initial: "open" | "closed" | "locked";
  opening: { min: V3; max: V3 };
}

export interface KeepBox {
  min: V3;
  max: V3;
  worldMin: V3;
  worldMax: V3;
}

export interface KeepRoom extends KeepBox {
  kind: "room" | "door" | "pass" | "hidden" | string;
  label?: string;
}

export interface KeepAnchors {
  version: number;
  frame: { origin: V3 };
  levels: { gf: { local: number; world: number }; bs: { local: number; world: number } };
  anchors: Record<string, KeepAnchor>;
  doors: Record<KeepDoorTag, KeepDoorDef>;
  zones: Record<string, KeepBox[]>;
  rooms: Record<string, KeepRoom>;
}

export type CaveZoneId = "A" | "B" | "C" | "D" | "E";

/** One cave anchor (world; `pos.y` is the collider floor). */
export interface CaveAnchor {
  kind: string;
  pos: V3;
  zone?: CaveZoneId | string;
  yaw?: number;
  clear?: number;
  use?: string;
}

export interface CaveZoneDef {
  boxes: { min: V3; max: V3 }[];
  neighbours: CaveZoneId[];
  show: string[];
  profile: "cave" | "climb-out" | string;
}

export interface CaveMaterialDef {
  textures?: { albedo?: string; normal?: string; orm?: string };
  tile?: number;
}

export interface CaveAnchors {
  version: number;
  anchors: Record<string, CaveAnchor>;
  zones: Partial<Record<CaveZoneId, CaveZoneDef>>;
  zoneOrder?: CaveZoneId[];
  materials: Record<string, CaveMaterialDef>;
  nodes: Record<string, { asset: string; kind: string; group: string }>;
  lights: Record<string, { pos: V3; kind: string; hint: { intensity: number; range: number; color: V3; angle?: number } }>;
  volumes: Record<string, { min?: V3; max?: V3; to?: string[]; surface?: number }>;
}

/** Keep-local → world with the runtime keep origin (the keep holder's position). */
export function keepWorld(origin: { x: number; y: number; z: number }, local: V3): [number, number, number] {
  return [origin.x + local[0], origin.y + local[1], origin.z + local[2]];
}

/** Whether `p` is inside `b` (world), with `pad` metres of slack all round. */
export function inBox(b: { min: V3; max: V3 }, p: { x: number; y: number; z: number }, pad = 0) {
  return p.x >= b.min[0] - pad && p.x <= b.max[0] + pad && p.y >= b.min[1] - pad && p.y <= b.max[1] + pad && p.z >= b.min[2] - pad && p.z <= b.max[2] + pad;
}
