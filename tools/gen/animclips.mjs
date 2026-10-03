// Animation clip libraries -> animation-only glTF documents (+ a root-motion sidecar).
//
// Game-agnostic: works on any set of glTF files that share one skeleton by joint name (here the
// Quaternius Universal Animation Library UAL1/UAL2). It
//   - picks named clips from several source files and FAILS when a requested clip is missing
//     (a silently dropped clip only shows up at runtime as "missing clip"),
//   - retargets clips from the other files onto the first file's skeleton by joint name and disposes
//     every node the merge copied (no orphan joint copies in the output),
//   - strips channels the runtime does not use (scale, and translation except on listed joints),
//   - extracts a joint's root motion into a curve and pins that joint at a fixed translation
//     (extractRootMotion),
//   - evaluates joint positions by forward kinematics (jointPositions) so builds can check that clips
//     line up (footprints across transitions, chain joins).
// Self-contained on purpose: it only depends on @gltf-transform so it can move to tools/engine later.
import { mergeDocuments } from "@gltf-transform/functions";

export function disposeAnimation(a) {
  for (const c of a.listChannels()) c.dispose();
  for (const s of a.listSamplers()) s.dispose();
  a.dispose();
}

const count = (arr) => arr.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());

/**
 * Keep only the requested clips of every source and merge them onto the first source's skeleton.
 * The first source document is modified and returned (meshes and skins removed, nodes kept).
 * @param {{doc: import("@gltf-transform/core").Document, clips: string[], label: string}[]} sources
 * @param {{keepTranslation?: string[], hint?: string}} [o]
 *   keepTranslation: joints whose translation channel is kept (every other joint keeps rotation only);
 *   hint: appended to the missing-clip error.
 */
export function pickClips(sources, { keepTranslation = [], hint = "" } = {}) {
  // --- contract: every requested clip exists exactly once, and no name is requested twice
  const errors = [];
  const requested = sources.flatMap((s) => s.clips);
  const twice = [...count(requested)].filter(([, k]) => k > 1).map(([n]) => n);
  if (twice.length) errors.push(`requested more than once: ${twice.join(", ")}`);
  for (const s of sources) {
    const have = count(s.doc.getRoot().listAnimations().map((a) => a.getName()));
    const missing = s.clips.filter((n) => !have.has(n));
    const ambiguous = s.clips.filter((n) => have.get(n) > 1);
    if (missing.length) errors.push(`${s.label} lacks ${missing.length} clip(s): ${missing.join(", ")}`);
    if (ambiguous.length) errors.push(`${s.label} has several clips named ${ambiguous.join(", ")}`);
  }
  if (errors.length) throw new Error(`animation clips: ${errors.join("; ")}${hint ? ` ${hint}` : ""}`);

  for (const s of sources) {
    const want = new Set(s.clips);
    for (const a of s.doc.getRoot().listAnimations()) if (!want.has(a.getName())) disposeAnimation(a);
  }

  const [base, ...rest] = sources;
  const doc = base.doc;
  const byName = new Map();
  for (const n of doc.getRoot().listNodes()) {
    if (byName.has(n.getName())) throw new Error(`${base.label}: duplicate node name ${n.getName()}`);
    byName.set(n.getName(), n);
  }
  for (const s of rest) {
    const src = s.doc.getRoot();
    const map = mergeDocuments(doc, s.doc);
    for (const a of src.listAnimations()) {
      for (const ch of map.get(a).listChannels()) {
        const name = ch.getTargetNode()?.getName();
        const t = byName.get(name);
        if (!t) throw new Error(`${s.label} ${a.getName()}: no joint "${name}" in ${base.label} to retarget to`);
        ch.setTargetNode(t);
      }
    }
    // Drop everything else the merge copied. Dispose each copied node explicitly: disposing only the
    // scene's top nodes leaves their joint subtrees behind as orphans.
    for (const p of [...src.listNodes(), ...src.listScenes(), ...src.listSkins(), ...src.listMeshes()]) map.get(p)?.dispose();
  }

  const keepT = new Set(keepTranslation);
  for (const a of doc.getRoot().listAnimations()) {
    for (const c of a.listChannels()) {
      const path = c.getTargetPath();
      if (path === "rotation" || (path === "translation" && keepT.has(c.getTargetNode()?.getName()))) continue;
      const smp = c.getSampler();
      c.dispose();
      if (!smp.listParents().some((p) => p.propertyType === "AnimationChannel")) smp.dispose();
    }
  }
  for (const n of doc.getRoot().listNodes()) {
    n.setMesh(null);
    n.setSkin(null);
  }
  for (const m of doc.getRoot().listMeshes()) m.dispose();
  for (const s of doc.getRoot().listSkins()) s.dispose();

  const got = doc.getRoot().listAnimations().map((a) => a.getName());
  if (got.length !== requested.length) throw new Error(`animation clips: expected ${requested.length}, got ${got.length}`);
  return doc;
}

// ------------------------------------------------------------------ root motion

const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (q) => {
  const n = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
  return [-q[0] / n, -q[1] / n, -q[2] / n, q[3] / n];
};
const qrot = (q, v) => {
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q));
  return [p[0], p[1], p[2]];
};
const qnorm = (q) => {
  const l = Math.hypot(...q);
  return q.map((x) => x / l);
};

/** Sample a LINEAR/STEP sampler at time t (vec3 or normalised-lerp quaternion). */
function sample(smp, t, k) {
  const interp = smp.getInterpolation();
  if (interp === "CUBICSPLINE") throw new Error("root motion: CUBICSPLINE samplers are not supported");
  const T = smp.getInput().getArray();
  const V = smp.getOutput().getArray();
  const at = (i) => Array.from(V.subarray(i * k, i * k + k));
  if (t <= T[0]) return at(0);
  if (t >= T[T.length - 1]) return at(T.length - 1);
  let i = 0;
  while (T[i + 1] < t) i++;
  if (interp === "STEP") return at(i);
  const u = (t - T[i]) / (T[i + 1] - T[i]);
  const a = at(i);
  let b = at(i + 1);
  if (k === 4 && a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0) b = b.map((x) => -x);
  const r = a.map((x, j) => x + (b[j] - x) * u);
  return k === 4 ? qnorm(r) : r;
}

/** Drop keys so that linear interpolation of the kept keys reproduces every original key within eps. */
function reduceKeys(keys, eps) {
  if (keys.length <= 2) return keys;
  const out = [keys[0]];
  let anchor = 0;
  const fits = (a, c, b) => {
    const u = (b[0] - a[0]) / (c[0] - a[0]);
    return b.every((x, j) => j === 0 || Math.abs(a[j] + (c[j] - a[j]) * u - x) <= eps);
  };
  for (let i = 1; i < keys.length - 1; i++) {
    // can key i go? every key since the last kept one must lie on the segment anchor -> i+1
    let ok = true;
    for (let k = anchor + 1; k <= i && ok; k++) ok = fits(keys[anchor], keys[i + 1], keys[k]);
    if (!ok) {
      out.push(keys[i]);
      anchor = i;
    }
  }
  out.push(keys[keys.length - 1]);
  return out;
}

const r4 = (x) => Math.round(x * 1e4) / 1e4 || 0;
const r5 = (x) => Math.round(x * 1e5) / 1e5 || 0;

/**
 * Move `bone`'s motion in `anim` into a curve and pin the bone at a fixed transform.
 *
 * The curve is in the parent space of the bone. Every ancestor of the bone must have an identity
 * transform (checked), so that space is the model space of the scene. It is rebased so the clip starts
 * at (0, 0, 0, yaw 0) and expressed in the clip's start frame (rotated by -yaw0). Yaw is the turn about
 * +Y, measured as the heading of the bone's rotation with its rest rotation removed:
 * yaw = atan2(f.x, f.z), f = (q * rest^-1) * (0, 0, 1); positive yaw turns +Z toward +X.
 * Throws if the bone tilts (non-yaw rotation away from rest).
 *
 * The bone is pinned at its rest rotation and at `pin` (default: its rest translation). Pick `pin` so
 * the pinned pose stands where the clips it blends with stand: some libraries keep a static root
 * offset that the rest of the pose compensates for, and pinning those clips at rest moves their feet.
 * The curve does not depend on `pin`.
 * @param {{eps?: number, pin?: number[]}} [o] eps: key-reduction tolerance (m, rad)
 * @returns {{duration: number, delta: number[], keys: number[][]}} keys: [t, x, y, z, yaw]
 */
export function extractRootMotion(anim, bone, { eps = 1e-4, pin } = {}) {
  for (let p = bone.getParentNode(); p; p = p.getParentNode()) {
    const [t, r, sc] = [p.getTranslation(), p.getRotation(), p.getScale()];
    const id = t.every((x) => Math.abs(x) < 1e-6) && r.slice(0, 3).every((x) => Math.abs(x) < 1e-6) && sc.every((x) => Math.abs(x - 1) < 1e-6);
    if (!id) throw new Error(`root motion: ${bone.getName()}'s ancestor ${p.getName()} is not an identity transform (T ${t}, R ${r}, S ${sc}); the curve would not be in model space`);
  }
  if (pin && (pin.length !== 3 || !pin.every(Number.isFinite))) throw new Error(`root motion: pin must be a translation [x, y, z], got ${pin}`);
  const ch = (path) => anim.listChannels().find((c) => c.getTargetNode() === bone && c.getTargetPath() === path);
  const cT = ch("translation"), cR = ch("rotation");
  const restT = bone.getTranslation(), restQ = bone.getRotation();
  const pinT = pin ?? restT;
  if (!cT && pinT.some((x, i) => Math.abs(x - restT[i]) > 1e-6)) throw new Error(`root motion: ${anim.getName()} has no ${bone.getName()} translation channel to pin at ${pinT}`);
  const restInv = qinv(restQ);
  let duration = 0;
  for (const c of anim.listChannels()) {
    const T = c.getSampler().getInput().getArray();
    duration = Math.max(duration, T[T.length - 1]);
  }
  const times = [...new Set([cT, cR].filter(Boolean).flatMap((c) => Array.from(c.getSampler().getInput().getArray())))].sort((a, b) => a - b);
  if (!times.length) times.push(0, duration);
  const raw = [];
  let prevYaw = 0;
  for (const t of times) {
    const p = cT ? sample(cT.getSampler(), t, 3) : restT;
    const q = cR ? sample(cR.getSampler(), t, 4) : restQ;
    const qy = qmul(q, restInv);
    const f = qrot(qy, [0, 0, 1]);
    let yaw = Math.atan2(f[0], f[2]);
    // a pure yaw keeps the up axis; anything else would be lost by pinning the bone at rest
    const up = qrot(qy, [0, 1, 0]);
    if (up[1] < 0.9995) throw new Error(`root motion: ${anim.getName()} tilts the ${bone.getName()} bone ${((Math.acos(Math.min(1, up[1])) * 180) / Math.PI).toFixed(2)} deg at t=${t.toFixed(3)}`);
    if (raw.length) yaw = prevYaw + Math.atan2(Math.sin(yaw - prevYaw), Math.cos(yaw - prevYaw));
    prevYaw = yaw;
    raw.push([t, p[0], p[1], p[2], yaw]);
  }
  const [, x0, y0, z0, yaw0] = raw[0];
  const c = Math.cos(yaw0), s = Math.sin(yaw0);
  const keys = raw.map(([t, x, y, z, yaw]) => {
    const dx = x - x0, dz = z - z0;
    return [r5(t), r4(dx * c - dz * s), r4(y - y0), r4(dx * s + dz * c), r5(yaw - yaw0)];
  });
  // pin the bone (keep the channels so cross-fades from clips that animate it still blend to the pin)
  // (a fresh accessor, in case the source shares the output with another sampler)
  for (const [chan, v] of [[cT, pinT], [cR, restQ]]) {
    if (!chan) continue;
    const out = chan.getSampler().getOutput();
    const arr = out.getArray().slice();
    for (let i = 0; i < arr.length; i += v.length) arr.set(v, i);
    chan.getSampler().setOutput(out.clone().setArray(arr));
  }
  const reduced = reduceKeys(keys, eps);
  return { duration: r5(duration), delta: reduced[reduced.length - 1].slice(1), keys: reduced };
}

/** Largest deviation of `bone` from its rest translation (m) and rotation (degrees) over a clip. */
export function restDeviation(anim, bone) {
  const restT = bone.getTranslation(), restQ = bone.getRotation();
  let t = 0, r = 0;
  for (const c of anim.listChannels()) {
    if (c.getTargetNode() !== bone) continue;
    const V = c.getSampler().getOutput().getArray();
    if (c.getTargetPath() === "translation") for (let i = 0; i < V.length; i += 3) t = Math.max(t, Math.hypot(V[i] - restT[0], V[i + 1] - restT[1], V[i + 2] - restT[2]));
    if (c.getTargetPath() === "rotation")
      for (let i = 0; i < V.length; i += 4) {
        const d = Math.abs(V[i] * restQ[0] + V[i + 1] * restQ[1] + V[i + 2] * restQ[2] + V[i + 3] * restQ[3]);
        r = Math.max(r, (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI);
      }
  }
  return { translation: t, rotation: r };
}

// ------------------------------------------------------------------ forward kinematics

/** Column-major 4x4 from translation, rotation (quaternion) and scale. */
function compose(t, q, s) {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

/**
 * Model-space positions (the space of the scene's top nodes) of the named joints at clip time `t`.
 * Animated channels are sampled; everything else uses the node's own transform. Names must be unique.
 * @param {import("@gltf-transform/core").Document} doc
 * @returns {number[][]}
 */
export function jointPositions(doc, anim, t, names) {
  const byNode = new Map();
  for (const c of anim.listChannels()) {
    const n = c.getTargetNode();
    if (!byNode.has(n)) byNode.set(n, {});
    byNode.get(n)[c.getTargetPath()] = c.getSampler();
  }
  const world = new Map();
  const W = (n) => {
    if (world.has(n)) return world.get(n);
    const a = byNode.get(n) ?? {};
    const m = compose(
      a.translation ? sample(a.translation, t, 3) : n.getTranslation(),
      a.rotation ? sample(a.rotation, t, 4) : n.getRotation(),
      a.scale ? sample(a.scale, t, 3) : n.getScale(),
    );
    const p = n.getParentNode();
    const r = p ? mul(W(p), m) : m;
    world.set(n, r);
    return r;
  };
  const nodes = doc.getRoot().listNodes();
  return names.map((name) => {
    const found = nodes.filter((n) => n.getName() === name);
    if (found.length !== 1) throw new Error(`jointPositions: ${found.length} nodes named ${name}`);
    const m = W(found[0]);
    return [m[12], m[13], m[14]];
  });
}

/** Clip length: the last key time over all its samplers. */
export function clipDuration(anim) {
  return Math.max(...anim.listSamplers().map((s) => s.getInput().getMax([])[0]));
}
