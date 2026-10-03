// "European Dragon" by Nonexistent 101 (CC BY 4.0). tools/gen/dragon.mjs reads a Blender 4.2.3
// re-export of a glTF-Transform/Draco mirror of the Sketchfab download, and src/prologue/dragon.ts
// (DRAGON_SCALE, PIVOT, CLIP_OFFSET) is tuned to that exact file. The mirror is pinned to a commit,
// both files are pinned by hash, and tools/fetch-extra.mjs reproduces the re-export byte for byte.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

export const DRAGON_MIRROR = {
  url: "https://raw.githubusercontent.com/GeoStrong/treasure-hunt-quiz/92388a8cbfb5a374feef34041791e1a58bea0e8d/public/dragon.glb",
  sha256: "64e9dea5c883198aa4c947633afb7cc0adb33908ce08b98836674fd089f99b2d",
};
/** assets-src/dragon/european_dragon.glb, the file the build reads. */
export const DRAGON_SHA256 = "5efaadf863ae7efe305e0d416e4a3a903c44901c56c4dc1bc7dc9a6059b4da0c";
/** The Blender build that produces DRAGON_SHA256 (other versions export different bytes). */
export const BLENDER = {
  version: "4.2.3",
  url: "https://download.blender.org/release/Blender4.2/blender-4.2.3-linux-x64.tar.xz",
  sha256: "3a64efd1982465395abab4259b4091d5c8c56054c7267e9633e4f702a71ea3f4",
};

/** Re-export the Draco mirror through Blender, then drop the importer's "_Armature" clip suffix. */
export async function reexportDragon(blender, draco, dest) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "np-dragon-"));
  try {
    const glb = path.join(tmp, "dragon.glb");
    await run(blender, ["-b", "--factory-startup", "-P", path.join(import.meta.dirname, "blender-reexport.py"), "--", draco, glb], { maxBuffer: 64 << 20 });
    const data = renameClips(await fs.readFile(glb), /_Armature$/);
    if (sha256(data) !== DRAGON_SHA256) throw new Error(`the dragon re-export doesn't match its lock; it needs Blender ${BLENDER.version} (${blender})`);
    await fs.writeFile(dest + ".part", data);
    await fs.rename(dest + ".part", dest);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** Rewrite a GLB's JSON chunk with `re` removed from every animation name. */
function renameClips(glb, re) {
  const len = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + len).toString());
  for (const a of json.animations ?? []) a.name = a.name.replace(re, "");
  let js = Buffer.from(JSON.stringify(json));
  if (js.length % 4) js = Buffer.concat([js, Buffer.alloc(4 - (js.length % 4), " ")]);
  const rest = glb.subarray(20 + len);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); // "glTF"
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + js.length + rest.length, 8);
  head.writeUInt32LE(js.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16); // "JSON"
  return Buffer.concat([head, js, rest]);
}
