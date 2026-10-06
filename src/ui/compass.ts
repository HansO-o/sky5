import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { hud } from "./hud";

type Point = { x: number; y: number; z: number };

interface Objective {
  text: string;
  /** where the compass marker points (null: no marker) */
  target: (() => Point | null) | null;
}

let current: Objective | null = null;

function el(id: string) {
  let e = document.getElementById(id);
  if (!e) {
    e = document.createElement("div");
    e.id = id;
    document.getElementById("ui")!.appendChild(e);
  }
  return e;
}

/**
 * The current quest objective: the line is `hud.objective` (announced with a toast the first time),
 * and the target is a marker on the compass until the next objective (or clear()). The marker only
 * shows while the HUD line still says this objective, so anything that replaces the line (e.g.
 * `stage.objective`) also takes the marker down.
 */
export const objective = {
  set(text: string, target: Objective["target"] = null, announce = true) {
    const same = current?.text === text && hud.currentObjective === text;
    current = { text, target };
    hud.objective(text, { toast: announce && !same ? 4500 : false });
  },
  /** change only where the marker points (e.g. the next waypoint, or null once it is reached) */
  retarget(target: Objective["target"]) {
    if (current) current.target = target;
  },
  clear() {
    if (current && hud.currentObjective === current.text) hud.objective(null);
    current = null;
  },
  /** put the line back after the HUD was reset (a loaded game's stage begins) */
  reshow() {
    if (current && !hud.currentObjective) hud.objective(current.text);
  },
  get text() {
    return current?.text ?? null;
  },
};

/** north is -Z, east is +X (the town map); one tick every 15 degrees */
const CARDINALS: [number, string][] = [[0, "北"], [90, "东"], [180, "南"], [270, "西"]];
const SPAN = Math.PI / 2; // the strip shows ±90 degrees around the heading
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const fwd = new Vector3();

interface Item {
  e: HTMLElement;
  bearing: number;
  left: string;
  opacity: string;
}
const items: Item[] = [];
let marker: HTMLElement | null = null;
let dist: HTMLElement | null = null;
let shown = false;
let last = { left: "", side: "", dist: "", on: false };
let warned = false;

function build() {
  const c = el("compass");
  c.innerHTML = "";
  for (let deg = 0; deg < 360; deg += 15) {
    const e = document.createElement("i");
    const card = CARDINALS.find(([d]) => d === deg);
    e.className = card ? "card" : deg % 45 === 0 ? "major" : "";
    if (card) e.textContent = card[1];
    c.appendChild(e);
    items.push({ e, bearing: (deg * Math.PI) / 180, left: "", opacity: "" });
  }
  marker = document.createElement("b");
  marker.className = "mark";
  dist = document.createElement("span");
  dist.className = "dist";
  marker.appendChild(dist);
  c.appendChild(marker);
}

const pct = (a: number) => `${(50 + (Math.max(-SPAN, Math.min(SPAN, a)) / SPAN) * 50).toFixed(2)}%`;

/**
 * Called every frame by the stage. The strip depends on the horizontal heading only (looking up or
 * down does not move it); the objective marker is pinned to the edge with an arrow when it is
 * behind. `from` is where distances are measured (the player, not the third-person camera).
 */
export function updateCompass(camera: Camera | null, visible: boolean, from?: Point | null) {
  const c = el("compass");
  if (!visible || !camera) {
    if (shown) c.classList.remove("on");
    shown = false;
    return;
  }
  if (!items.length) build();
  if (!shown) c.classList.add("on");
  shown = true;
  // heading: bearing of the view direction from north (-Z) toward east (+X)
  camera.getDirectionToRef(camera.getScene().useRightHandedSystem ? Vector3.Forward(true) : Vector3.Forward(false), fwd);
  const heading = Math.atan2(fwd.x, -fwd.z);
  for (const it of items) {
    const a = wrap(it.bearing - heading);
    const opacity = Math.abs(a) > SPAN ? "0" : (1 - Math.max(0, Math.abs(a) / SPAN - 0.7) / 0.3).toFixed(2);
    const left = pct(a);
    if (left !== it.left) it.e.style.left = it.left = left;
    if (opacity !== it.opacity) it.e.style.opacity = it.opacity = opacity;
  }
  let target: Point | null = null;
  try {
    target = current && hud.currentObjective === current.text ? (current.target?.() ?? null) : null;
  } catch (e) {
    // a target that cannot be resolved (e.g. its actor is gone) just has no marker
    if (!warned) console.warn("objective target failed", e);
    warned = true;
  }
  if (!target || !marker || !dist) {
    if (last.on) marker?.classList.remove("on");
    last.on = false;
    return;
  }
  if (!last.on) marker.classList.add("on");
  last.on = true;
  const o = from ?? camera.globalPosition;
  const a = wrap(Math.atan2(target.x - o.x, -(target.z - o.z)) - heading);
  const left = pct(a);
  if (left !== last.left) marker.style.left = last.left = left;
  const side = a < -SPAN ? "left" : a > SPAN ? "right" : "";
  if (side !== last.side) {
    marker.classList.toggle("left", side === "left");
    marker.classList.toggle("right", side === "right");
    last.side = side;
  }
  const d = Math.hypot(target.x - o.x, target.z - o.z);
  const text = d < 3 ? "" : `${Math.round(d)} 米`;
  if (text !== last.dist) dist.textContent = last.dist = text;
}
