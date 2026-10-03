// The dragon: "European Dragon" by Nonexistent 101 (CC BY 4.0). Textures to KTX2 at 1024, clip names
// normalised (Fly, Idle, Sit, Walk, Run); roar / breath / landing are driven procedurally at runtime.
import path from "node:path";
import fs from "node:fs/promises";
import { KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { io, compressTextures, finalize } from "../lib/gltf.mjs";

const NAMES = [[/fly/i, "Fly"], [/idle.*stand|stand/i, "Idle"], [/sit/i, "Sit"], [/walk/i, "Walk"], [/run/i, "Run"]];

export async function buildDragon({ emit, SRC }) {
  const dir = path.join(SRC, "dragon");
  const plain = path.join(dir, "european_dragon.glb");
  const src = (await fs.access(plain).then(() => true, () => false)) ? plain : path.join(dir, "european_dragon_draco.glb");
  const doc = await io.read(src);
  doc.getRoot().listExtensionsUsed().filter((e) => e instanceof KHRDracoMeshCompression).forEach((e) => e.dispose());
  for (const a of doc.getRoot().listAnimations()) {
    const hit = NAMES.find(([re]) => re.test(a.getName()));
    if (hit) a.setName(hit[1]);
  }
  await compressTextures(doc, 1024, 1024, 512);
  await emit("dragon/dragon", { segment: "dragon", priority: 99, type: "glb", ext: "glb", data: await finalize(doc), pos: [90, -584] });
}
