// The props step (design §10.2, §10.1 "Procedural props"): builds kit/fpm (tools/gen/propkit.mjs),
// procprops/keep + procprops/exit (tools/gen/procprops.mjs) and composes props/meta, the JSON the
// runtime reads to resolve the anchors' prop suggestions, attach held items and place props.
//
// props/meta (version 1):
//   resolve     "kit/<Model>" / "procprops/<name>" → {asset, node} (the anchors name props that way)
//   kit         per kit/fpm model: bounds, facing, anchors, hinge, held (from propkit)
//   procprops   per procedural prop: pivots, colliders and tags, anchors, held (from procprops)
//   held        every held item's attach recipes by asset#node (BoneSocket recipes, hand-local)
//   placements  world placements derived from the keep and cave anchors (+ a yaw, game convention)
//   ph          the Poly Haven props this unit added, with placement hints
//   joins       the cave/keep anchor values the props were built against (build-assets checks them)
import path from "node:path";
import { io } from "../lib/gltf.mjs";
import { buildPropKit, PROPKIT } from "./propkit.mjs";
import { buildProcProps, PROCPROPS } from "./procprops.mjs";

export const PROPS_META = { id: "props/meta", segment: "keep", priority: 93, pos: [60, -662] };

const r3 = (v) => v.map((x) => Math.round(x * 1000) / 1000 + 0);
const rotY = (p, a) => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** world point of a prop-local point, for a prop at `at` turned by `yaw` (local −Z → the facing) */
const place = (at, yaw, local) => add(at, rotY(local, yaw));
const qYaw = (yaw) => [0, +Math.sin(yaw / 2).toFixed(5), 0, +Math.cos(yaw / 2).toFixed(5)];

/** The cave and keep anchor values the props depend on (compared again at manifest time). */
export function propJoins(anchors) {
  const c = anchors.cave.anchors;
  const pick = (k) => r3(c[k].pos);
  return {
    cave: Object.fromEntries(["bridge_hinge", "slab_drop", "lever", "lever_stance", "winch"].map((k) => [k, pick(k)])),
    keep: { drain: anchors.keep.rooms.drain ? { worldMin: r3(anchors.keep.rooms.drain.worldMin), worldMax: r3(anchors.keep.rooms.drain.worldMax) } : null },
  };
}

/** Lowest point of a Poly Haven source model (to stand it on a slot). */
async function phMinY(SRC, id) {
  const doc = await io.read(path.join(SRC, "models", id, `${id}.gltf`));
  let min = Infinity;
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const M = n.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const P = p.getAttribute("POSITION");
      const v = [];
      for (let i = 0; i < P.getCount(); i++) {
        P.getElement(i, v);
        min = Math.min(min, M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13]);
      }
    }
  }
  return min;
}

function placements(anchors, kit, pp, phLift) {
  const K = anchors.keep.anchors, rooms = anchors.keep.rooms, C = anchors.cave.anchors;
  const out = {};
  out.gallery_bridge = { asset: PROCPROPS.keep.id, node: "gallery_bridge", at: r3(C.bridge_hinge.pos), yaw: 0, note: "world axes; add at the origin of this transform (no recentring)" };
  // the drain grate at the opening's bottom centre, on the B5 wall face
  const d = rooms.drain;
  out.drain_grate = { asset: PROCPROPS.keep.id, node: "drain_grate", at: r3([(d.worldMin[0] + d.worldMax[0]) / 2, d.worldMin[1], d.worldMax[2]]), yaw: 0 };
  // sconces on every sconce light anchor (origin on its wall point)
  out.sconces = Object.entries(K)
    .filter(([, a]) => a.kind === "light" && a.light === "sconce" && a.wall)
    .map(([k, a]) => ({ anchor: k, asset: PROCPROPS.keep.id, node: "sconce", at: r3(a.wall.world), yaw: a.yaw ?? 0, flame: r3(a.world) }));
  // a straw bed along the back wall of each cell
  out.straw_beds = Object.entries(rooms)
    .filter(([k]) => /^cell_[we]\d$/.test(k))
    .map(([k, r]) => {
      const west = k.startsWith("cell_w");
      const x = west ? r.worldMin[0] + 0.5 : r.worldMax[0] - 0.5;
      return { room: k, asset: PROCPROPS.keep.id, node: "straw_bed", at: r3([x, r.worldMin[1], (r.worldMin[2] + r.worldMax[2]) / 2]), yaw: west ? -Math.PI / 2 : Math.PI / 2 };
    });
  // the wolf den's bones
  out.bones = ["bones_1", "bones_2", "bones_3"].filter((k) => C[k]).map((k, i) => ({ anchor: k, asset: PROCPROPS.exit.id, node: ["bones_a", "bones_b", "bones_c"][i], at: r3(C[k].pos), yaw: [0.4, 2.1, -1.2][i] }));
  // B3: the cage, the strap chair, the shackles and the irons in the brazier
  for (const [k, node] of [["prop_cage", "cage"], ["prop_strap_chair", "strap_chair"], ["prop_shackles_corpse", "shackles"], ["prop_brazier_b3", "brazier_irons"]])
    if (K[k]) out[node] = { anchor: k, asset: PROCPROPS.keep.id, node, at: r3(K[k].world), yaw: K[k].yaw ?? 0 };
  // table dressing: the jailer's dice, the records on the B3 table
  const top = kit.models.Table_Large.anchors.top.at[1];
  if (K.prop_j_table) out.dice = { anchor: "prop_j_table", asset: PROCPROPS.keep.id, node: "dice", at: r3(place(K.prop_j_table.world, K.prop_j_table.yaw ?? 0, [0.35, top, 0.12])), yaw: 0.3 };
  if (K.use_records) {
    const a = K.use_records, y = a.yaw ?? 0;
    out.records = [
      { item: "kit/fpm#Scroll_1", at: r3(place(a.world, y, [-0.45, top, 0.05])), yaw: y + 0.4 },
      { item: "kit/fpm#Book", at: r3(place(a.world, y, [0.35, top, -0.05])), yaw: y - 0.25 },
    ];
  }
  // the storeroom shelf, pushed back onto the G4 east wall (its anchor stands 0.6 m out), and its potions
  if (K.use_store_potions) {
    const a = K.use_store_potions, y = a.yaw ?? 0, room = rooms[a.room];
    const facing = rotY([0, 0, -1], y);
    let at = a.world.slice();
    // walk back (against the facing) to the room's wall along that axis
    if (Math.abs(facing[0]) > 0.5) at[0] = facing[0] < 0 ? room.worldMax[0] : room.worldMin[0];
    else at[2] = facing[2] < 0 ? room.worldMax[2] : room.worldMin[2];
    const shelf = kit.models.Shelf_Small_Bottles.anchors;
    out.store_shelf = {
      anchor: "use_store_potions",
      item: "kit/fpm#Shelf_Small_Bottles",
      at: r3(at),
      yaw: y,
      potions: ["top_0", "top_1"].map((s) => ({ item: "kit/fpm#Potion_2", at: r3(place(at, y, shelf[s].at)), yaw: y })),
      note: "the anchor stands 0.6 m off the wall; the shelf's back (z = 0) is put on the wall",
    };
  }
  // weapon stands: items upright in the notches (lifted so their lowest point is on the slot)
  const stand = kit.models.WeaponStand.anchors;
  const swordLift = -kit.models.Sword_Bronze.bbox.min[1];
  const items = {
    use_weaponstand_imp: [["kit/fpm#Sword_Bronze", "slot_1", swordLift]],
    use_weaponstand_reb: [["ph/wooden_axe_03", "slot_1", phLift.wooden_axe_03], ["kit/fpm#Sword_Bronze", "slot_2", swordLift], ["kit/fpm#Axe_Bronze", "slot_3", -kit.models.Axe_Bronze.bbox.min[1]]],
  };
  out.weapon_stands = Object.entries(items)
    .filter(([k]) => K[k])
    .map(([k, list]) => {
      const a = K[k], y = a.yaw ?? 0;
      return {
        anchor: k,
        item: "kit/fpm#WeaponStand",
        at: r3(a.world),
        yaw: y,
        items: list.map(([item, slot, lift]) => ({ item, slot, at: r3(place(a.world, y, add(stand[slot].at, [0, lift, 0]))), rotation: qYaw(y + Math.PI / 2), note: "upright, handle +Y" })),
        shield: { item: k.endsWith("imp") ? "ph/kite_shield" : null, at: r3(place(a.world, y, stand.lean.at)), yaw: y, note: "lean the shield against the stand's front (orientation by eye)" },
      };
    });
  // the camp fire in the gallery
  if (C.camp_fire) out.camp_fire = { item: "ph/stone_fire_pit", at: r3(add(C.camp_fire.pos, [0, 0.15, 0])), yaw: 0, note: "the scan's origin is mid-height: 0.15 m up sinks the ring 4 cm into the uneven floor" };
  // the outcrop brow (cave/anchors outcrop.props)
  const brow = anchors.cave.outcrop?.props?.find((p) => p.name === "brow");
  if (brow) out.outcrop_brow = { item: "ph/rock_face_02", at: brow.pos, yaw: brow.yaw ?? 0, note: "shown with the town (outdoor set) like cave/outcrop; streamed in muster" };
  return out;
}

/** Build kit/fpm, procprops/keep, procprops/exit and props/meta. */
export async function buildProps({ emit, SRC, anchors }) {
  const kit = await buildPropKit({ emit, SRC });
  const pp = await buildProcProps({ emit, SRC, anchors });
  const phLift = { wooden_axe_03: -(await phMinY(SRC, "wooden_axe_03")) };
  const resolve = {};
  for (const m of Object.keys(kit.meta.models)) resolve[`kit/${m}`] = { asset: PROPKIT.id, node: m };
  for (const [k, part] of [["keep", pp.keep], ["exit", pp.exit]]) for (const n of Object.keys(part.meta)) resolve[`procprops/${n}`] = { asset: PROCPROPS[k].id, node: n };
  const held = {};
  for (const [m, info] of Object.entries(kit.meta.models)) if (info.held) held[`${PROPKIT.id}#${m}`] = info.held;
  for (const [k, part] of [["keep", pp.keep]]) for (const [n, info] of Object.entries(part.meta)) if (info.held) held[`${PROCPROPS[k].id}#${n}`] = info.held;
  held[`${PROCPROPS.keep.id}#cuffs_rope`] = { recipes: pp.keep.meta.cuffs_rope.recipes, worn: true };
  // the existing Poly Haven items (design §3.3 recipes, not re-measured here)
  held["ph/wooden_axe_03"] = { recipes: { hand_r: { bone: "hand_r", rotation: [0, 0.7071, 0.7071, 0], position: [-0.03, 0.095, 0.15], scale: 1.25 } }, source: "design §3.3" };
  held["ph/kite_shield"] = { recipes: { hand_l: { bone: "hand_l", rotation: [0.5, -0.5, -0.5, 0.5], position: "tune" } }, source: "design §3.3" };
  const meta = {
    version: 1,
    assets: {
      [PROPKIT.id]: { segment: PROPKIT.segment, tris: kit.meta.tris, animations: kit.meta.animations },
      [PROCPROPS.keep.id]: { segment: PROCPROPS.keep.segment, tris: pp.keep.tris, colliders: pp.keep.colliders },
      [PROCPROPS.exit.id]: { segment: PROCPROPS.exit.segment, tris: pp.exit.tris, colliders: pp.exit.colliders },
    },
    conventions: {
      nodes: "one top-level node per prop at the origin (identity); geometry on `<node>_mesh` leaves; colliders on `*_col` nodes (POSITION only, no material: hide them and build static bodies); anchors are empty nodes",
      facing: "props face −Z: turn them by the anchor's yaw (game convention: yaw = atan2(−dx, −dz) of the facing; rotation.y = yaw turns local −Z to the facing)",
      recipes: "attachToSocket(item, BoneSocket(bone), recipe): position and rotation [x, y, z, w] in the joint's frame; the grip point lands on gripCentre (∓0.03, 0.095, 0)",
      extras: "each top-level node carries the same data as here in its glTF extras (node.metadata.gltf.extras)",
    },
    resolve,
    kit: kit.meta.models,
    procprops: { keep: pp.keep.meta, exit: pp.exit.meta },
    held,
    placements: placements(anchors, kit.meta, pp, phLift),
    ph: {
      "ph/wooden_table_02": { use: "hall cover tables (keep anchors prop_hall_table_1/2)", origin: "on the floor" },
      "ph/stone_fire_pit": { use: "the cave camp (cave anchor camp_fire)", origin: "mid-height of the stone ring: lift 0.15 m" },
      "ph/rock_face_02": { use: "the outcrop brow (cave/anchors outcrop.props brow)", segment: "muster, streamed" },
    },
    joins: propJoins(anchors),
    stats: { gallery: pp.gallery, notes: pp.notes },
  };
  await emit(PROPS_META.id, { segment: PROPS_META.segment, priority: PROPS_META.priority, type: "json", ext: "json", data: Buffer.from(JSON.stringify(meta)), pos: PROPS_META.pos });
  return meta;
}
