// Held-item attach recipes for the UE-mannequin skeleton the Quaternius characters and the UAL clips
// share, and a forward-kinematics check of them against the clips (no Babylon, no gltf-transform:
// the UAL source GLBs are plain float glTF, read directly).
//
// Hand frames (src/engine/actors/presets/ueMannequin.ts): every joint points along its local +Y (wrist
// to fingers); a held handle runs along the hand's +Z through the grip centre (∓0.03, 0.095, 0), and
// +Z is the business end (blade, head, flame). A recipe is what `attachToSocket(item, socket, r)` takes:
// the item's origin and rotation in the joint frame, so that the item's model-space grip point lands
// on the grip centre.
import fs from "node:fs";

/** Where a held handle's centre sits in the hand's frame (m). Mirrors ueMannequin.ts `gripCentre`. */
export const gripCentre = (side) => [side === "r" ? -0.03 : 0.03, 0.095, 0];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qrot = (q, v) => {
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [p[0], p[1], p[2]];
};
const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return a.map((x) => x / l);
};

/**
 * Quaternion [x, y, z, w] of the rotation that takes the model axes X, Y, Z to the given directions
 * (an orthonormal right-handed basis, e.g. in the hand's frame).
 */
export function quatFromBasis(X, Y, Z) {
  const m00 = X[0], m10 = X[1], m20 = X[2], m01 = Y[0], m11 = Y[1], m21 = Y[2], m02 = Z[0], m12 = Z[1], m22 = Z[2];
  const det = m00 * (m11 * m22 - m12 * m21) - m01 * (m10 * m22 - m12 * m20) + m02 * (m10 * m21 - m11 * m20);
  if (Math.abs(det - 1) > 1e-3) throw new Error(`quatFromBasis: not a rotation (det ${det.toFixed(3)})`);
  const t = m00 + m11 + m22;
  let q;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  if (q[3] < 0) q = q.map((v) => -v);
  return norm(q);
}

/**
 * The recipe for an item held in `side`'s hand: `axes` gives, for two model axes, the hand axis each
 * goes to (e.g. {Y: "+Z", X: "+Y"}: the handle's +Y along the grip axis, the edge toward the fingers).
 * `grip` is the model-space point the hand closes around. Rounded to 4 decimals.
 */
export function heldRecipe(side, grip, axes, scale = 1) {
  const unit = { "+X": [1, 0, 0], "-X": [-1, 0, 0], "+Y": [0, 1, 0], "-Y": [0, -1, 0], "+Z": [0, 0, 1], "-Z": [0, 0, -1] };
  const img = {};
  for (const [k, v] of Object.entries(axes)) img[k] = unit[v];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  img.X ??= cross(img.Y, img.Z);
  img.Y ??= cross(img.Z, img.X);
  img.Z ??= cross(img.X, img.Y);
  const q = quatFromBasis(img.X, img.Y, img.Z);
  const g = qrot(q, grip.map((v) => v * scale));
  const c = gripCentre(side);
  const r4 = (v) => Math.round(v * 1e4) / 1e4 + 0;
  return { bone: side === "r" ? "hand_r" : "hand_l", rotation: q.map(r4), position: [c[0] - g[0], c[1] - g[1], c[2] - g[2]].map(r4), ...(scale !== 1 ? { scale } : {}) };
}

// ------------------------------------------------------------------------------------------------
// Clip poses (forward kinematics over the UAL source GLBs)

function readGLB(file) {
  const buf = fs.readFileSync(file);
  let off = 12, json, bin;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const cache = new Map();
  const read = (i) => {
    if (cache.has(i)) return cache.get(i);
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView], n = NC[a.type];
    if (a.componentType !== 5126) throw new Error(`${file}: accessor ${i} is not float`);
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || n * 4;
    const out = [];
    for (let k = 0; k < a.count; k++) {
      const v = [];
      for (let c = 0; c < n; c++) v.push(bin.readFloatLE(base + k * stride + c * 4));
      out.push(n === 1 ? v[0] : v);
    }
    cache.set(i, out);
    return out;
  };
  const parent = new Map();
  json.nodes.forEach((n, i) => (n.children || []).forEach((c) => parent.set(c, i)));
  return { json, read, parent, byName: new Map(json.nodes.map((n, i) => [n.name, i])) };
}

function slerp(a, b, t) {
  let d = dot(a, b) + a[3] * b[3];
  if (d < 0) (b = b.map((x) => -x)), (d = -d);
  if (d > 0.9995) return norm(a.map((x, i) => x + (b[i] - x) * t));
  const th = Math.acos(d), s = Math.sin(th);
  return a.map((x, i) => (x * Math.sin((1 - t) * th)) / s + (b[i] * Math.sin(t * th)) / s);
}

/** Pose sampler over clip files: `pose(clip, t)(joint)` → {q, p} in character space (+Z forward, +X left). */
export function clipPoses(files) {
  const glbs = files.filter((f) => fs.existsSync(f)).map(readGLB);
  return (clip, t) => {
    const g = glbs.find((x) => x.json.animations?.some((a) => a.name === clip));
    if (!g) return null;
    const anim = g.json.animations.find((a) => a.name === clip);
    const ch = new Map(anim.channels.map((c) => [`${c.target.node}:${c.target.path}`, anim.samplers[c.sampler]]));
    const sample = (node, pathName) => {
      const s = ch.get(`${node}:${pathName}`);
      if (!s) return null;
      const T = g.read(s.input), V = g.read(s.output);
      if (t <= T[0]) return V[0];
      if (t >= T[T.length - 1]) return V[V.length - 1];
      let i = 0;
      while (T[i + 1] < t) i++;
      const k = (t - T[i]) / (T[i + 1] - T[i]);
      if (s.interpolation === "STEP") return V[i];
      return pathName === "rotation" ? slerp(V[i], V[i + 1], k) : V[i].map((x, c) => x + (V[i + 1][c] - x) * k);
    };
    const memo = new Map();
    const get = (i) => {
      if (memo.has(i)) return memo.get(i);
      const n = g.json.nodes[i];
      const T = sample(i, "translation") ?? n.translation ?? [0, 0, 0];
      const R = sample(i, "rotation") ?? n.rotation ?? [0, 0, 0, 1];
      let r;
      if (g.parent.has(i)) {
        const p = get(g.parent.get(i));
        const o = qrot(p.q, T);
        r = { q: qmul(p.q, R), p: [p.p[0] + o[0], p.p[1] + o[1], p.p[2] + o[2]] };
      } else r = { q: R, p: T };
      memo.set(i, r);
      return r;
    };
    return (joint) => {
      const i = g.byName.get(joint);
      return i === undefined ? null : get(i);
    };
  };
}

/**
 * Where an item's model axis `axis` points in character space (+Z forward, +Y up, +X left) when the
 * clip is at `t` and the item hangs on its recipe; also the world position of a model point.
 */
export function heldInPose(poses, recipe, clip, t, axis, point = [0, 0, 0]) {
  const P = poses(clip, t);
  const h = P?.(recipe.bone);
  if (!h) return null;
  const qi = qmul(h.q, recipe.rotation);
  const s = recipe.scale ?? 1;
  const local = qrot(recipe.rotation, point.map((v) => v * s));
  const off = qrot(h.q, [local[0] + recipe.position[0], local[1] + recipe.position[1], local[2] + recipe.position[2]]);
  return { dir: norm(qrot(qi, axis)), at: [h.p[0] + off[0], h.p[1] + off[1], h.p[2] + off[2]] };
}

/** Angle in degrees between two directions. */
export const angleDeg = (a, b) => (Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) * 180) / Math.PI;
