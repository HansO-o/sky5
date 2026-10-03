// Downloads the non-Poly-Haven sources (characters, horse, audio) into assets-src/ so the asset
// build is reproducible. Licences are recorded in tools/credits-extra.mjs; each pack's own licence
// file is kept next to the extracted files. Idempotent: existing files are skipped.
//
//   node tools/fetch-extra.mjs
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "assets-src");
const TMP = await fs.mkdtemp(path.join(os.tmpdir(), "np-extra-"));

const exists = (p) => fs.access(p).then(() => true, () => false);

async function download(url, dest, init) {
  if (await exists(dest)) return false;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, init);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      await fs.writeFile(dest + ".part", Buffer.from(await r.arrayBuffer()));
      await fs.rename(dest + ".part", dest);
      console.log("got", path.relative(ROOT, dest));
      return true;
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
}

/** itch.io free download: page -> csrf token -> POST for a short-lived signed URL. */
async function itch(gameUrl, uploadId, dest) {
  if (await exists(dest)) return;
  const page = await fetch(gameUrl);
  const cookies = page.headers.getSetCookie?.().map((c) => c.split(";")[0]).join("; ") ?? "";
  const html = await page.text();
  const token = html.match(/name="csrf_token" value="([^"]+)"/)?.[1];
  if (!token) throw new Error(`no csrf token on ${gameUrl}`);
  const r = await fetch(`${gameUrl}/file/${uploadId}?source=game_download`, {
    method: "POST",
    headers: { cookie: cookies, "content-type": "application/x-www-form-urlencoded" },
    body: `csrf_token=${encodeURIComponent(token)}`,
  });
  const { url } = await r.json();
  if (!url) throw new Error(`itch.io gave no download url for ${gameUrl}`);
  await download(url, dest);
}

async function unzip(zip, pattern, destDir, strip) {
  const out = path.join(TMP, path.basename(zip, ".zip"));
  await run("unzip", ["-q", "-o", zip, "-d", out]);
  const { stdout } = await run("find", [out, "-type", "f"]);
  for (const f of stdout.split("\n").filter(Boolean)) {
    const rel = path.relative(out, f);
    if (!pattern.test(rel)) continue;
    const dest = path.join(destDir, strip ? path.basename(f) : rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(f, dest);
  }
}

// ---------------------------------------------------------------- Quaternius (CC0)
const C = path.join(SRC, "chars");
const packs = [
  ["https://quaternius.itch.io/universal-base-characters", 15861669, "ubc.zip"],
  ["https://quaternius.itch.io/modular-character-outfits-fantasy", 16289385, "outfits.zip"],
  ["https://quaternius.itch.io/universal-animation-library", 17958403, "ual1.zip"],
  ["https://quaternius.itch.io/universal-animation-library-2", 17958478, "ual2.zip"],
];
if (!(await exists(path.join(C, "anim/UAL2_Standard.glb")))) {
  for (const [url, id, name] of packs) await itch(url, id, path.join(TMP, name));
  await unzip(path.join(TMP, "ubc.zip"), /Base Characters\/Godot - UE\//, path.join(C, "base"), true);
  await unzip(path.join(TMP, "ubc.zip"), /Hairstyles\/Rigged to Head Bone\/glTF/, path.join(C, "hair"), true);
  await unzip(path.join(TMP, "ubc.zip"), /License_Standard\.txt$/, path.join(C, "base"), true);
  await unzip(path.join(TMP, "outfits.zip"), /Exports\/glTF \(Godot-Unreal\)\/Outfits\/(Male_|T_)/, path.join(C, "outfits"), true);
  await unzip(path.join(TMP, "outfits.zip"), /License_Standard\.txt$/, path.join(C, "outfits"), true);
  await unzip(path.join(TMP, "ual1.zip"), /Unreal-Godot\/UAL1_Standard\.glb$|License\.txt$/, path.join(C, "anim"), true);
  await unzip(path.join(TMP, "ual2.zip"), /Unreal-Godot\/UAL2_Standard\.glb$/, path.join(C, "anim"), true);
  // the pack's glTF references these names; the files ship without the "_png" suffix
  for (const [a, b] of [["T_Hair_1_Normal.png", "T_Hair_1_Normal_png.png"], ["T_Eye_Normal.png", "T_Eye_Normal_png.png"]]) {
    if (!(await exists(path.join(C, "base", b)))) await fs.copyFile(path.join(C, "base", a), path.join(C, "base", b));
  }
  for (const f of ["License_Standard.txt", "License.txt"]) {
    for (const d of ["base", "outfits", "anim"]) {
      const p = path.join(C, d, f);
      if (await exists(p)) await fs.rename(p, path.join(C, d, "LICENSE.txt"));
    }
  }
}

// ---------------------------------------------------------------- 0 A.D. horse (CC BY-SA 3.0)
const H = path.join(SRC, "horse");
const zad = "https://raw.githubusercontent.com/PhantomMatthew/ZeroAD-Godot/main/godot/assets";
await download(`${zad}/animations/quadraped/horse_walk.glb`, path.join(H, "horse_walk.glb"));
await download(`${zad}/animations/quadraped/horse_trot.glb`, path.join(H, "horse_trot.glb"));
await download(`${zad}/meshes/skeletal/horse.glb`, path.join(H, "horse.glb"));
await download("https://raw.githubusercontent.com/0ad/0ad/master/binaries/data/mods/public/art/textures/skins/skeletal/horse_brown.png", path.join(H, "horse_brown.png"));
await download("https://raw.githubusercontent.com/0ad/0ad/master/binaries/data/mods/public/art/LICENSE.txt", path.join(H, "LICENSE-0ad-art.txt"));

// ---------------------------------------------------------------- audio (CC0)
const A = path.join(SRC, "audio");
const audio = {
  "01_frost_in_the_northern_winter.ogg": "https://opengameart.org/sites/default/files/01_frost_in_the_northern_winter.ogg",
  "Lament_for_a_Warriors_Soul_REUPLOAD.mp3": "https://opengameart.org/sites/default/files/Lament_for_a_Warriors_Soul_REUPLOAD.mp3",
  "fs_627064_13875907-hq.ogg": "https://cdn.freesound.org/previews/627/627064_13875907-hq.ogg",
  "fs_479790_2524442-hq.ogg": "https://cdn.freesound.org/previews/479/479790_2524442-hq.ogg",
  "fs_538438_11519060-hq.ogg": "https://cdn.freesound.org/previews/538/538438_11519060-hq.ogg",
};
for (const [f, url] of Object.entries(audio)) await download(url, path.join(A, f));

await fs.rm(TMP, { recursive: true, force: true });
console.log("extra sources ready");
