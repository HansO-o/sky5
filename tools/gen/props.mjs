// The props step (design §10.2, §10.1 "Procedural props"): builds kit/fpm (tools/gen/propkit.mjs),
// procprops/keep + procprops/exit (tools/gen/procprops.mjs) and composes props/meta, the JSON the
// runtime reads to resolve the anchors' prop suggestions, attach held items and place props.
//
// props/meta (version 1):
//   resolve     "kit/<Model>" / "procprops/<name>" → {asset, node} (the anchors name props that way)
//   kit         per kit/fpm model: bounds, facing, anchors, hinge, collider ("bbox" | "none"), held (from propkit)
//   procprops   per procedural prop: pivots, colliders and tags, anchors, held, worn (from procprops)
//   held        every held item's attach recipes by asset#node (BoneSocket recipes keyed by bone, hand-local, with the grip)
//   worn        worn items (the rope cuffs) by asset#node: recipes keyed by bone, no grip
//   placements  world placements derived from the keep and cave anchors (+ a yaw, game convention)
//   ph          the Poly Haven props this unit added, with placement hints
//   joins       the shipped inputs the props were built against: `inputs` maps cave/anchors,
//               cave/mesh_a (the rock field the gallery is fitted to) and keep/anchors to the sha256
//               they had; build-assets.mjs fails while the manifest ships other versions
//               (tools/lib/joins.mjs checkPropsJoin)
import path from "node:path";
import { io } from "../lib/gltf.mjs";
import { heldRecipe, clipPoses, heldInPose, angleDeg } from "../lib/handheld.mjs";
import { buildPropKit, PROPKIT, KIT_COLLIDER, trianglesOf, columnHits } from "./propkit.mjs";
import { buildProcProps, PROCPROPS } from "./procprops.mjs";

export const PROPS_META = { id: "props/meta", segment: "keep", priority: 93, pos: [60, -662] };

const r3 = (v) => v.map((x) => Math.round(x * 1000) / 1000 + 0);
const rotY = (p, a) => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** world point of a prop-local point, for a prop at `at` turned by `yaw` (local −Z → the facing) */
const place = (at, yaw, local) => add(at, rotY(local, yaw));
const qYaw = (yaw) => [0, +Math.sin(yaw / 2).toFixed(5), 0, +Math.cos(yaw / 2).toFixed(5)];

/**
 * The shipped files props/ reads, by manifest id: everything placements(), the gallery set piece and its
 * rock checks consume comes from these (the anchors and rooms of both, the cave's rock field). Their
 * sha256 goes to props/meta.joins.inputs; tools/lib/joins.mjs checkPropsJoin compares them with the
 * manifest before it is written.
 */
export const PROPS_INPUTS = ["cave/anchors", "cave/mesh_a", "keep/anchors"];

/** Model-space vertices of a Poly Haven source model (node transforms applied). */
async function phVerts(SRC, id) {
  const doc = await io.read(path.join(SRC, "models", id, `${id}.gltf`));
  const out = [];
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const M = n.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const P = p.getAttribute("POSITION");
      const v = [];
      for (let i = 0; i < P.getCount(); i++) {
        P.getElement(i, v);
        out.push([0, 1, 2].map((r) => M[r] * v[0] + M[4 + r] * v[1] + M[8 + r] * v[2] + M[12 + r]));
      }
    }
  }
  return out;
}

/** Babylon's Quaternion.RotationYawPitchRoll(yaw, pitch, 0): pitch about X first, then yaw about Y. */
const qYawPitch = (yaw, pitch) => {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  const q = [cy * sp, sy * cp, -sy * sp, cy * cp];
  return q.map((v) => +(q[3] < 0 ? -v : v).toFixed(5) + 0);
};
const rotX = (p, a) => [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a)];

/**
 * The kite shield leaning on a weapon stand (stand-local, the stand facing −Z): its face (+Z) turned to
 * the stand's facing, its tip on the floor at `lean`, tilted back about X until its back rests on the
 * front of the stand's top bar (`bar`: {z, y: [y0, y1]}). Returns the shield origin, the tilt and the
 * stand-local Euler.
 */
function shieldLean(verts, lean, bar) {
  for (let deg = 0; deg <= 40; deg += 0.25) {
    const th = (deg * Math.PI) / 180;
    const q = verts.map((p) => rotX([-p[0], p[1], -p[2]], th));
    let low = q[0];
    for (const v of q) if (v[1] < low[1]) low = v;
    const o = [lean[0] - low[0], -low[1], lean[2] - low[2]];
    const touch = q.some((v) => v[1] + o[1] >= bar.y[0] && v[1] + o[1] <= bar.y[1] && v[2] + o[2] >= bar.z);
    if (touch) return { at: o, tilt: th, deg };
  }
  throw new Error("props: the kite shield does not reach the weapon stand's top bar within 40° of lean");
}

/**
 * An item standing in a weapon stand slot (stand-local, the stand facing −Z). The stand's top "bar" is two
 * rails (y 0.76…0.86) with a 7 cm gap between them along x, and under the gap runs a base beam (top y 0.14):
 * a weapon stands on the beam and rises through the gap, which holds it upright. `verts`: the item's
 * model-space vertices; `yaw`: its turn about Y in the stand's frame; `slot`: the slot point.
 * The item is lowered onto the highest surface under it below the rails (the beam, else the floor), then
 * checked against the whole stand: `depth` is how far its deepest vertex is inside it (ray parity against
 * the stand's triangles), `inGap` whether it reaches up between the rails.
 */
function standFit(tris, verts, { yaw, scale = 1, slot }) {
  const RAILS = 0.5; // stand surfaces above this height are the rails; below it, the base beam and the feet
  const P = verts.map((v) => add(rotY(v.map((x) => x * scale), yaw), [slot[0], 0, slot[2]]));
  let lift = -Math.min(...P.map((v) => v[1])), on = "floor";
  for (const v of P) {
    const top = columnHits(tris, v[0], v[2]).filter((h) => h < RAILS).pop();
    if (top !== undefined && top - v[1] > lift) (lift = top - v[1]), (on = "beam");
  }
  let depth = 0, inGap = false;
  for (const v of P) {
    const y = v[1] + lift, hits = columnHits(tris, v[0], v[2]);
    if (hits.filter((h) => h > y + 1e-4).length % 2) depth = Math.max(depth, Math.min(...hits.map((h) => Math.abs(h - y))));
    if (y > 0.8 && !hits.some((h) => h > RAILS)) inGap = true;
  }
  const ys = P.map((v) => v[1] + lift);
  return {
    at: [slot[0], lift, slot[2]],
    on,
    depth,
    inGap,
    top: Math.max(...ys),
    box: { min: [0, 1, 2].map((k) => Math.min(...P.map((v) => v[k] + (k === 1 ? lift : 0)))), max: [0, 1, 2].map((k) => Math.max(...P.map((v) => v[k] + (k === 1 ? lift : 0)))) },
  };
}

function placements(anchors, kit, ph, kitGeom) {
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
  // weapon stands: items upright on the base beam at their slots, rising through the gap between the top
  // rails (standFit, checked against the stand's triangles; the wooden axe at the 1.25 scale it has in the
  // hand, design §3.3), and the imperial kite shield leaning on the front rail (its tip on the floor at `lean`)
  const stand = kit.models.WeaponStand.anchors;
  const standTris = trianglesOf(kitGeom.WeaponStand);
  const vertsOf = (parts) => parts.flatMap((p) => Array.from({ length: p.pos.length / 3 }, (_, i) => Array.from(p.pos.subarray(i * 3, i * 3 + 3))));
  const W = { sword: vertsOf(kitGeom.Sword_Bronze), axe: vertsOf(kitGeom.Axe_Bronze) };
  // [item, slot, turn about Y in the stand's frame, scale, model vertices]. The sword turns π/2 like the
  // slots, so its blade's flat faces along the gap. kit/fpm#Axe_Bronze's head runs along model X: the
  // slots' turn would put it across the rails (its blade 1.8 cm into the back rail), so it turns π, the
  // head along the gap toward the empty slot_4. ph/wooden_axe_03's head runs along model Z, along the gap
  // at the slots' turn but with its blade at the sword in slot_2: it turns −π/2, toward the empty slot_0
  const items = {
    use_weaponstand_imp: [["kit/fpm#Sword_Bronze", "slot_1", Math.PI / 2, 1, W.sword]],
    use_weaponstand_reb: [
      ["ph/wooden_axe_03", "slot_1", -Math.PI / 2, ph.axe.scale, ph.axe.verts],
      ["kit/fpm#Sword_Bronze", "slot_2", Math.PI / 2, 1, W.sword],
      ["kit/fpm#Axe_Bronze", "slot_3", Math.PI, 1, W.axe],
    ],
  };
  const lean = shieldLean(ph.shield.verts, stand.lean.at, kit.models.WeaponStand.leanRest);
  const standProblems = [];
  out.weapon_stands = Object.entries(items)
    .filter(([k]) => K[k])
    .map(([k, list]) => {
      const a = K[k], y = a.yaw ?? 0;
      const fits = list.map(([item, slot, turn, scale, verts]) => {
        const f = standFit(standTris, verts, { yaw: turn, scale, slot: stand[slot].at });
        if (f.depth > 0.005) standProblems.push(`${k} ${item}: ${(f.depth * 100).toFixed(1)} cm inside the stand`);
        if (!f.inGap) standProblems.push(`${k} ${item}: does not reach up between the rails (top y ${f.top.toFixed(2)}), so nothing holds it upright`);
        return f;
      });
      for (let i = 0; i < fits.length; i++)
        for (let j = i + 1; j < fits.length; j++) {
          const p = fits[i].box, q = fits[j].box;
          if ([0, 1, 2].every((ax) => p.min[ax] < q.max[ax] && q.min[ax] < p.max[ax])) standProblems.push(`${k}: ${list[i][0]} and ${list[j][0]} overlap`);
        }
      return {
        anchor: k,
        item: "kit/fpm#WeaponStand",
        at: r3(a.world),
        yaw: y,
        items: list.map(([item, slot, turn, scale], i) => ({
          item,
          slot,
          at: r3(place(a.world, y, fits[i].at)),
          rotation: qYaw(y + turn),
          ...(scale !== 1 ? { scale } : {}),
          fit: { on: fits[i].on, lift: +fits[i].at[1].toFixed(3), top: +fits[i].top.toFixed(3), depth: +fits[i].depth.toFixed(3) },
          note: `upright, handle +Y, standing on the stand's ${fits[i].on} and rising between its rails to y ${fits[i].top.toFixed(2)} (stand-local)${/axe/i.test(item) ? "; its head turned along the gap" : ""}${scale !== 1 ? `; scale ${scale}, as in the hand` : ""}`,
        })),
        shield: k.endsWith("imp")
          ? {
              item: "ph/kite_shield",
              at: r3(place(a.world, y, lean.at)),
              yaw: y,
              rotation: qYawPitch(y + Math.PI, -lean.tilt),
              euler: [+(-lean.tilt).toFixed(4), +(y + Math.PI).toFixed(4), 0],
              tilt: +lean.tilt.toFixed(4),
              note: `the shield's origin; its face (+Z) turned to the stand's facing, tilted back ${lean.deg}° so its back rests on the top bar, its tip on the floor at the stand's lean point. Use \`rotation\` (Babylon RotationYawPitchRoll(yaw + π, −tilt, 0), = node.rotation \`euler\`), not \`yaw\``,
            }
          : null,
      };
    });
  if (standProblems.length) throw new Error(`props: weapon stand items:\n  ${standProblems.join("\n  ")}`);
  // the camp fire in the gallery
  if (C.camp_fire) out.camp_fire = { item: "ph/stone_fire_pit", at: r3(add(C.camp_fire.pos, [0, 0.15, 0])), yaw: 0, note: "the scan's origin is mid-height: 0.15 m up sinks the ring 4 cm into the uneven floor" };
  // the outcrop brow (cave/anchors outcrop.props)
  const brow = anchors.cave.outcrop?.props?.find((p) => p.name === "brow");
  if (brow) out.outcrop_brow = { item: "ph/rock_face_02", at: brow.pos, yaw: brow.yaw ?? 0, note: "shown with the town (outdoor set) like cave/outcrop; streamed in muster" };
  return out;
}

/**
 * The kite shield's attach recipe: no handle in the model, so the fist sits 3.5 cm behind the back at
 * the centre (y 0.05), the rotation of design §3.3 (the face +Z away from the back of the hand), checked
 * like kit/fpm#Shield_Wooden.
 */
function kiteShieldHeld(verts, poses) {
  let back = Infinity;
  // the source mesh is sparse (rows about 0.2 m apart): the back-most vertex within 0.15 m of the grip height
  for (const v of verts) if (Math.abs(v[0]) < 0.05 && Math.abs(v[1] - 0.05) < 0.15) back = Math.min(back, v[2]);
  if (!Number.isFinite(back)) throw new Error("props: no kite_shield vertices at the centre of its back");
  const grip = r3([0, 0.05, back - 0.035]);
  const recipe = heldRecipe("l", grip, { Y: "+Z", Z: "-X" });
  const checks = [];
  for (const c of [{ clip: "Idle_Shield_Loop", t: 0.5 }, { clip: "Shield_OneShot", t: 0.3 }]) {
    const r = heldInPose(poses, recipe, c.clip, c.t, [0, 0, 1], grip);
    if (!r) throw new Error(`props: clip ${c.clip} missing for the kite shield check`);
    const deg = angleDeg(r.dir, [0, 0, 1]);
    if (deg > 30) throw new Error(`props: the kite shield's face points ${deg.toFixed(1)}° off forward in ${c.clip} (> 30°)`);
    checks.push({ clip: c.clip, t: c.t, what: "face forward", deg: +deg.toFixed(1) });
  }
  return { grip, recipes: { hand_l: recipe }, checks, tune: true, source: "design §3.3 rotation; grip measured here", note: "the model has no handle or straps: the grip is 3.5 cm behind the back at its centre; tune the position by eye" };
}

/**
 * Build kit/fpm, procprops/keep, procprops/exit and props/meta. `anchors`: the shipped cave/anchors and
 * keep/anchors JSON; `inputs`: the sha256 of every PROPS_INPUTS file as shipped; `caveMeshA`: the
 * shipped cave/mesh_a GLB.
 */
export async function buildProps({ emit, SRC, anchors, inputs, caveMeshA }) {
  for (const id of PROPS_INPUTS) if (!/^[0-9a-f]{64}$/.test(inputs?.[id] ?? "")) throw new Error(`props: no sha256 for the input ${id}`);
  const kit = await buildPropKit({ emit, SRC });
  const pp = await buildProcProps({ emit, SRC, anchors, caveMeshA });
  const poses = clipPoses([path.join(SRC, "chars/anim_full/UAL1.glb"), path.join(SRC, "chars/anim_full/UAL2.glb")]);
  const AXE_SCALE = 1.25;
  const axeVerts = await phVerts(SRC, "wooden_axe_03"), shieldVerts = await phVerts(SRC, "kite_shield");
  const ph = { axe: { verts: axeVerts, scale: AXE_SCALE }, shield: { verts: shieldVerts } };
  const resolve = {};
  for (const m of Object.keys(kit.meta.models)) resolve[`kit/${m}`] = { asset: PROPKIT.id, node: m };
  for (const [k, part] of [["keep", pp.keep], ["exit", pp.exit]]) for (const n of Object.keys(part.meta)) resolve[`procprops/${n}`] = { asset: PROCPROPS[k].id, node: n };
  // every kit/ and procprops/ suggestion of the shipped anchors must resolve (keep/anchors may gain one)
  const unresolved = [];
  for (const [file, list] of [["keep/anchors", anchors.keep.anchors], ["cave/anchors", anchors.cave.anchors]])
    for (const [k, a] of Object.entries(list)) for (const p of String(a.prop ?? "").split(/[\s,+]+/)) if (/^(kit|procprops)\//.test(p) && !resolve[p]) unresolved.push(`${file} ${k}: ${p}`);
  if (unresolved.length) throw new Error(`props: anchor prop suggestions with no kit/fpm model or procedural prop: ${unresolved.join(", ")} (add them to FPM_KIT / tools/gen/procprops.mjs, or rename them in the anchors)`);
  const held = {};
  for (const [m, info] of Object.entries(kit.meta.models)) if (info.held) held[`${PROPKIT.id}#${m}`] = info.held;
  for (const [k, part] of [["keep", pp.keep]]) for (const [n, info] of Object.entries(part.meta)) if (info.held) held[`${PROCPROPS[k].id}#${n}`] = info.held;
  // worn items (no grip): each node its own entry, recipes keyed by bone like `held`
  const worn = {};
  for (const [k, part] of [["keep", pp.keep]])
    for (const [n, info] of Object.entries(part.meta))
      for (const [child, w] of Object.entries(info.worn ?? {}))
        worn[`${PROCPROPS[k].id}#${child}`] = {
          ...w,
          of: `${PROCPROPS[k].id}#${n}`,
          ...(n === "cuffs_rope" ? { checks: Object.fromEntries(Object.entries(pp.wrists).filter(([key]) => key.endsWith(`.${Object.keys(w.recipes)[0]}`))), note: "checks: how far each base body's wrist fills the coil's inner section (bind pose; the build fails over 1)" } : {}),
        };
  // the existing Poly Haven items: the axe as design §3.3 has it (not re-measured; scale 1.25, also on
  // its stand), the kite shield measured here
  // (its grip, the model point the recipe puts on the grip centre: R⁻¹(gripCentre − position) / scale)
  held["ph/wooden_axe_03"] = { grip: [0, -0.12, 0], recipes: { hand_r: { bone: "hand_r", rotation: [0, 0.7071, 0.7071, 0], position: [-0.03, 0.095, 0.15], scale: AXE_SCALE } }, source: "design §3.3", note: "the grip is 0.10 m above the butt (model y −0.224)" };
  held["ph/kite_shield"] = kiteShieldHeld(shieldVerts, poses);
  const meta = {
    version: 1,
    assets: {
      [PROPKIT.id]: { segment: PROPKIT.segment, tris: kit.meta.tris, animations: kit.meta.animations, colliders: { bbox: Object.keys(kit.meta.models).filter((m) => kit.meta.models[m].collider === "bbox") } },
      [PROCPROPS.keep.id]: { segment: PROCPROPS.keep.segment, tris: pp.keep.tris, colliders: pp.keep.colliders },
      [PROCPROPS.exit.id]: { segment: PROCPROPS.exit.segment, tris: pp.exit.tris, colliders: pp.exit.colliders },
    },
    conventions: {
      nodes: "one top-level node per prop at the origin (identity); geometry on `<node>_mesh` leaves; anchors are empty nodes",
      colliders: `procprops/*: on \`*_col\` nodes (POSITION only, no material: hide them and build static bodies, tags in their extras). kit/fpm has no \`*_col\` nodes: each model's \`collider\` says how it collides, "bbox" = ${KIT_COLLIDER.bbox}; "none" = ${KIT_COLLIDER.none}`,
      facing: "props face −Z: turn them by the anchor's yaw (game convention: yaw = atan2(−dx, −dz) of the facing; rotation.y = yaw turns local −Z to the facing)",
      recipes: "attachToSocket(item, BoneSocket(bone), recipe): position and rotation [x, y, z, w] in the joint's frame; for `held` the grip point lands on gripCentre (∓0.03, 0.095, 0); `worn` items have no grip",
      extras: "each top-level node carries the same data as here in its glTF extras (node.metadata.gltf.extras)",
    },
    resolve,
    kit: kit.meta.models,
    procprops: { keep: pp.keep.meta, exit: pp.exit.meta },
    held,
    worn,
    placements: placements(anchors, kit.meta, ph, kit.geom),
    ph: {
      "ph/wooden_table_02": { use: "hall cover tables (keep anchors prop_hall_table_1/2)", origin: "on the floor" },
      "ph/stone_fire_pit": { use: "the cave camp (cave anchor camp_fire)", origin: "mid-height of the stone ring: lift 0.15 m" },
      "ph/rock_face_02": { use: "the outcrop brow (cave/anchors outcrop.props brow)", segment: "muster, streamed" },
    },
    joins: {
      inputs: Object.fromEntries(PROPS_INPUTS.map((id) => [id, inputs[id]])),
      note: "the sha256 of the shipped files props/ was built from (anchors and rooms, the cave's rock field); tools/build-assets.mjs fails while the manifest ships other versions: rebuild with --only=props/",
      field: pp.field,
    },
    stats: { gallery: pp.gallery, lever: pp.lever, notes: pp.notes },
  };
  await emit(PROPS_META.id, { segment: PROPS_META.segment, priority: PROPS_META.priority, type: "json", ext: "json", data: Buffer.from(JSON.stringify(meta)), pos: PROPS_META.pos });
  return meta;
}
