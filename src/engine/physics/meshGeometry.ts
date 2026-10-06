import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

const v = new Vector3();

/**
 * Append a mesh's triangles in world space (for static colliders built from render or collider
 * meshes: `Physics.addStaticMesh(pos, idx)`). Quantised glTF meshes carry their dequantisation in the
 * node transform, which the world matrix includes.
 */
export function appendWorldGeometry(m: AbstractMesh, pos: number[], idx: number[]) {
  const p = m.getVerticesData(VertexBuffer.PositionKind);
  const ind = m.getIndices();
  if (!p || !ind) return;
  m.computeWorldMatrix(true);
  const W = m.getWorldMatrix();
  const base = pos.length / 3;
  for (let i = 0; i < p.length; i += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(p[i], p[i + 1], p[i + 2], W, v);
    pos.push(v.x, v.y, v.z);
  }
  // a mirrored transform (negative scale) flips winding; Jolt mesh shapes are double-sided for
  // the character anyway, so winding does not matter here
  for (let i = 0; i < ind.length; i++) idx.push(base + ind[i]);
}

/** The world-space triangles of several meshes, ready for `Physics.addStaticMesh`. */
export function worldGeometry(meshes: Iterable<AbstractMesh>) {
  const pos: number[] = [], idx: number[] = [];
  for (const m of meshes) appendWorldGeometry(m, pos, idx);
  return { pos, idx };
}
