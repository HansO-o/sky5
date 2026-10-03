// The dragon: "European Dragon" by Nonexistent 101 (CC BY 4.0). Textures to KTX2 at 1024, clip names
// normalised (Fly, Idle, Sit, Walk, Run); roar / breath / landing are driven procedurally at runtime.
import path from "node:path";
import fs from "node:fs/promises";
import { io, compressTextures, finalize } from "../lib/gltf.mjs";
import { DRAGON_SHA256, sha256 } from "../lib/dragon-source.mjs";

const NAMES = [[/fly/i, "Fly"], [/idle.*stand|stand/i, "Idle"], [/sit/i, "Sit"], [/walk/i, "Walk"], [/run/i, "Run"]];

export async function buildDragon({ emit, SRC }) {
  // Only the exact re-export: src/prologue/dragon.ts's scale, pivot and clip offsets are tuned to it,
  // and the Draco mirror it comes from has a different scale and root transform.
  const src = path.join(SRC, "dragon/european_dragon.glb");
  const data = await fs.readFile(src).catch(() => null);
  if (!data) throw new Error(`${src} is missing: run npm run fetch-sources`);
  if (sha256(data) !== DRAGON_SHA256) throw new Error(`${src} is not the pinned re-export (sha256 ${sha256(data)}): delete it and run npm run fetch-sources`);
  const doc = await io.read(src);
  for (const a of doc.getRoot().listAnimations()) {
    const hit = NAMES.find(([re]) => re.test(a.getName()));
    if (hit) a.setName(hit[1]);
  }
  await compressTextures(doc, 1024, 1024, 512);
  await emit("dragon/dragon", { segment: "dragon", priority: 99, type: "glb", ext: "glb", data: await finalize(doc), pos: [90, -584] });
}
