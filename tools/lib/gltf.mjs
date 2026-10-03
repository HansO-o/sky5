// glTF helpers shared by the asset build: IO setup, material/texture creation, mesh building
// and the final optimisation pass (meshopt + quantisation).
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRTextureBasisu, KHRMaterialsEmissiveStrength } from "@gltf-transform/extensions";
import { dedup, prune, weld, meshopt, simplify, resample, flatten, join, instance, compactPrimitive } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import draco3d from "draco3dgltf";
import { toKTX2 } from "./ktx.mjs";

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;

export const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder, "draco3d.decoder": await draco3d.createDecoderModule() });

export { Document, MeshoptSimplifier };

/** Which encoder preset fits a texture, based on the material slots that use it. */
function presetForSlots(slots) {
  if (slots.some((s) => s === "normalTexture")) return "normal";
  if (slots.some((s) => s === "baseColorTexture" || s === "emissiveTexture")) return "color";
  return "linear";
}

/** Convert every non-KTX2 texture in the document to KTX2, resized to at most maxSize. */
export async function compressTextures(doc, maxSize = 1024, normalMaxSize = maxSize, linearMaxSize = maxSize) {
  const root = doc.getRoot();
  let any = false;
  await Promise.all(
    root.listTextures().map(async (tex) => {
      if (tex.getMimeType() === "image/ktx2") {
        any = true;
        return;
      }
      const slots = tex
        .getGraph()
        .listParentEdges(tex)
        .filter((e) => e.getParent() !== root)
        .map((e) => e.getName());
      const preset = presetForSlots(slots);
      const out = await toKTX2(Buffer.from(tex.getImage()), {
        preset,
        maxSize: preset === "normal" ? normalMaxSize : preset === "linear" ? linearMaxSize : maxSize,
      });
      tex.setImage(new Uint8Array(out));
      tex.setMimeType("image/ktx2");
      if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.(png|jpe?g|webp)$/i, ".ktx2"));
      any = true;
    }),
  );
  if (any) doc.createExtension(KHRTextureBasisu).setRequired(true);
}

/**
 * Aggressive simplification for photogrammetry scans whose UV islands lock most vertices in a
 * normal simplify: 'Permissive' lets edges collapse across attribute seams.
 */
export async function simplifyPermissive(doc, ratio, error = 0.02) {
  await doc.transform(weld());
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      const idx = prim.getIndices();
      if (!pos || !idx) continue;
      const P = new Float32Array(pos.getCount() * 3);
      for (let i = 0, el = [0, 0, 0]; i < pos.getCount(); i++) P.set(pos.getElement(i, el), i * 3);
      const I = new Uint32Array(idx.getArray());
      const target = Math.max(3, Math.floor((I.length * ratio) / 3) * 3);
      const [out] = MeshoptSimplifier.simplify(I, P, 3, target, error, ["Permissive"]);
      idx.setArray(pos.getCount() > 65535 ? out : new Uint16Array(out));
      compactPrimitive(prim);
    }
}

/** Final geometry optimisation + meshopt compression; returns GLB bytes. */
export async function finalize(doc, { simplifyRatio = 1, simplifyError = 0.002, keepNodes = true, keepLeaves = false } = {}) {
  const transforms = [dedup(), weld()];
  if (simplifyRatio < 1)
    transforms.push(simplify({ simplifier: MeshoptSimplifier, ratio: simplifyRatio, error: simplifyError, lockBorder: false }));
  if (!keepNodes) transforms.push(flatten(), join());
  transforms.push(resample(), prune({ keepAttributes: false, keepLeaves }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  await doc.transform(...transforms);
  return Buffer.from(await io.writeBinary(doc));
}

/** Create a KTX2 texture from an image buffer. */
export async function ktxTexture(doc, name, imageBuf, preset, maxSize) {
  const data = await toKTX2(imageBuf, { preset, maxSize });
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  return doc.createTexture(name).setImage(new Uint8Array(data)).setMimeType("image/ktx2").setURI(name + ".ktx2");
}

/**
 * Build a primitive from plain arrays.
 * @param {Document} doc
 * @param {{positions: number[]|Float32Array, normals?: ArrayLike<number>, uvs?: ArrayLike<number>, colors?: ArrayLike<number>, indices: ArrayLike<number>}} g
 */
export function makePrimitive(doc, g, material) {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const prim = doc.createPrimitive();
  const acc = (type, arr, ctor = Float32Array) =>
    doc.createAccessor().setType(type).setArray(arr instanceof ctor ? arr : new ctor(arr)).setBuffer(buffer);
  prim.setAttribute("POSITION", acc("VEC3", g.positions));
  if (g.normals) prim.setAttribute("NORMAL", acc("VEC3", g.normals));
  if (g.uvs) prim.setAttribute("TEXCOORD_0", acc("VEC2", g.uvs));
  if (g.colors) prim.setAttribute("COLOR_0", acc("VEC4", g.colors));
  const maxIndex = g.positions.length / 3;
  prim.setIndices(acc("SCALAR", g.indices, maxIndex > 65535 ? Uint32Array : Uint16Array));
  if (material) prim.setMaterial(material);
  return prim;
}

export { KHRMaterialsEmissiveStrength, instance };

/** Simple mutable mesh builder used by the procedural generators. */
export class MeshBuilder {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.c = [];
    this.i = [];
  }
  get vertexCount() {
    return this.p.length / 3;
  }
  vertex(p, n, uv, c) {
    this.p.push(p[0], p[1], p[2]);
    this.n.push(n[0], n[1], n[2]);
    this.uv.push(uv[0], uv[1]);
    if (c) this.c.push(c[0], c[1], c[2], c[3]);
    return this.vertexCount - 1;
  }
  tri(a, b, c) {
    this.i.push(a, b, c);
  }
  quad(a, b, c, d) {
    this.i.push(a, b, c, a, c, d);
  }
  /** Recompute smooth normals from triangles (area weighted). */
  computeNormals() {
    const n = new Float32Array(this.p.length);
    const P = this.p;
    for (let t = 0; t < this.i.length; t += 3) {
      const [a, b, c] = [this.i[t] * 3, this.i[t + 1] * 3, this.i[t + 2] * 3];
      const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
      const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const x = e1[1] * e2[2] - e1[2] * e2[1];
      const y = e1[2] * e2[0] - e1[0] * e2[2];
      const z = e1[0] * e2[1] - e1[1] * e2[0];
      for (const v of [a, b, c]) {
        n[v] += x;
        n[v + 1] += y;
        n[v + 2] += z;
      }
    }
    for (let v = 0; v < n.length; v += 3) {
      const l = Math.hypot(n[v], n[v + 1], n[v + 2]) || 1;
      n[v] /= l;
      n[v + 1] /= l;
      n[v + 2] /= l;
    }
    this.n = Array.from(n);
  }
  toGeometry() {
    if (this.c.length && this.c.length / 4 !== this.p.length / 3) throw new Error("MeshBuilder: colours must be given for every vertex or none");
    return {
      positions: new Float32Array(this.p),
      normals: new Float32Array(this.n),
      uvs: new Float32Array(this.uv),
      colors: this.c.length ? new Float32Array(this.c) : undefined,
      indices: this.i,
    };
  }
}

/** PBR material helper. */
export function pbr(doc, name, { color, normal, orm, rough = 0.9, metal = 0, alphaMode, alphaCutoff, doubleSided, baseColorFactor } = {}) {
  const m = doc.createMaterial(name).setRoughnessFactor(rough).setMetallicFactor(metal);
  if (color) m.setBaseColorTexture(color);
  if (normal) m.setNormalTexture(normal);
  if (orm) {
    m.setMetallicRoughnessTexture(orm);
    m.setOcclusionTexture(orm);
    m.setRoughnessFactor(1);
  }
  if (baseColorFactor) m.setBaseColorFactor(baseColorFactor);
  if (alphaMode) m.setAlphaMode(alphaMode);
  if (alphaCutoff !== undefined) m.setAlphaCutoff(alphaCutoff);
  if (doubleSided) m.setDoubleSided(true);
  return m;
}
