// Downloads the non-Poly-Haven sources (characters, horse, audio) into assets-src/ so the asset
// build is reproducible. Licences are recorded in tools/credits-extra.mjs; each pack's own licence
// file is kept next to the extracted files. Idempotent: existing files are skipped. Mirrors that
// live in someone else's git repository are pinned to a commit and checked against a sha256.
//
//   node tools/fetch-extra.mjs        (BLENDER=<Blender 4.2.3 executable> off Linux x64)
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DRAGON_MIRROR, BLENDER, reexportDragon, sha256 } from "./lib/dragon-source.mjs";

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "assets-src");
const TMP = await fs.mkdtemp(path.join(os.tmpdir(), "np-extra-"));

const exists = (p) => fs.access(p).then(() => true, () => false);

/** Download once; with `hash`, the file must be exactly the one the shipped build was made from. */
async function download(url, dest, hash) {
  if (await exists(dest)) {
    // a file from an earlier fetch counts only if it is the pinned one (older fetches followed moving refs)
    const have = hash && sha256(await fs.readFile(dest));
    if (have && have !== hash) throw new Error(`${path.relative(ROOT, dest)} is not the pinned file (sha256 ${have}, expected ${hash}): delete it and re-run`);
    return false;
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  let buf;
  for (let i = 0; !buf; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      buf = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  if (hash && sha256(buf) !== hash) throw new Error(`${url} has sha256 ${sha256(buf)}, expected ${hash}`);
  await fs.writeFile(dest + ".part", buf);
  await fs.rename(dest + ".part", dest);
  console.log("got", path.relative(ROOT, dest));
  return true;
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
  await unzip(path.join(TMP, "outfits.zip"), /Exports\/glTF \(Godot-Unreal\)\/Outfits\/(Male_|Female_|T_)/, path.join(C, "outfits"), true);
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
const zad = "https://raw.githubusercontent.com/PhantomMatthew/ZeroAD-Godot/b56df2818f9c535eed5f1ebddfd7c0e12b258017/godot/assets";
const art = "https://raw.githubusercontent.com/0ad/0ad/61a3b9507d974084e6badb88a0826bd89a6d5b8b/binaries/data/mods/public/art";
await download(`${zad}/animations/quadraped/horse_walk.glb`, path.join(H, "horse_walk.glb"), "6a9079dbdc83ebc80034adbdf94d621a48c13ca449c7aa9a4b43c38f8602ed3b");
await download(`${zad}/animations/quadraped/horse_trot.glb`, path.join(H, "horse_trot.glb"), "ab3449e31cae416eb5330377358aa49bb48e3c436bccdb63d6e5f3ed7a451f48");
await download(`${zad}/meshes/skeletal/horse.glb`, path.join(H, "horse.glb"), "ba5257036a89102d0877c678063c039bca7239667a1478dc4d6dcc380ff41dc0");
await download(`${art}/textures/skins/skeletal/horse_brown.png`, path.join(H, "horse_brown.png"), "3e6549478bfd81305dce532714808038a7341194150b4a80ba0d4301b7189c2a");
await download(`${art}/LICENSE.txt`, path.join(H, "LICENSE-0ad-art.txt"), "ef98babd771c206032e005f3d440a1e610df409d9a9191f03e64deaa4abefbd9");

// ---------------------------------------------------------------- audio (CC0)
const A = path.join(SRC, "audio");
const audio = {
  "01_frost_in_the_northern_winter.ogg": "https://opengameart.org/sites/default/files/01_frost_in_the_northern_winter.ogg",
  "Lament_for_a_Warriors_Soul_REUPLOAD.mp3": "https://opengameart.org/sites/default/files/Lament_for_a_Warriors_Soul_REUPLOAD.mp3",
  "fs_627064_13875907-hq.ogg": "https://cdn.freesound.org/previews/627/627064_13875907-hq.ogg",
  "fs_479790_2524442-hq.ogg": "https://cdn.freesound.org/previews/479/479790_2524442-hq.ogg",
  "fs_538438_11519060-hq.ogg": "https://cdn.freesound.org/previews/538/538438_11519060-hq.ogg",
  // RandomMind "Medieval: Exploration" (CC0): not shipped yet (planned as the exit chapter's
  // music_explore); add its credit to tools/credits-extra.mjs when it goes into tools/gen/audio.mjs.
  "Exploration.mp3": "https://opengameart.org/sites/default/files/Exploration_0.mp3",
};
for (const [f, url] of Object.entries(audio)) await download(url, path.join(A, f));

// ---------------------------------------------------------------- M2: full animation library, FX, more audio (dragon at the end)
// Quaternius Universal Animation Library 1+2, full clip sets on the same skeleton (CC0, hosted by Cinevva)
await download("https://cdn.cinevva.com/rt/clips/1/UAL1.glb", path.join(SRC, "chars/anim_full/UAL1.glb"), "bccd7586a5b6b088397965dd69d431d2209bc07fb3a602bafca9492a7dca69da");
await download("https://cdn.cinevva.com/rt/clips/1/UAL2.glb", path.join(SRC, "chars/anim_full/UAL2.glb"), "23d0d7bf3582b9f9e0c26ce52239e29ddacd2d9c7a0735c1fab1959b02d23a88");
// Kenney Particle Pack (CC0)
const FX = path.join(SRC, "fx");
if (!(await exists(path.join(FX, "flame_01.png")))) {
  await download("https://kenney.nl/media/pages/assets/particle-pack/f8fe0f8cb8-1677578741/kenney_particle-pack.zip", path.join(TMP, "kenney.zip"));
  await unzip(path.join(TMP, "kenney.zip"), /PNG \(Transparent\)\/(flame_0[1-4]|fire_0[12]|smoke_(01|04|07|10)|spark_0[145]|scorch_01)\.png$|License\.txt$/, FX, true);
}
// Babylon.js asset sprite sheets (CC BY 4.0)
for (const f of ["Fire_SpriteSheet2_8x8", "Smoke_SpriteSheet_8x8"]) await download(`https://assets.babylonjs.com/sprites/${f}.png`, path.join(FX, `bab_${f}.png`));
// Freesound (all CC0): [id, user id]. 675821 (arrows) here and 479790 (hooves) above are craigsmith's CC0
// transfers of old studio-library effects; reviewed and kept, but replace them if that provenance is questioned.
const FS = [
  [546391, 6174371], [651817, 12852018], [479380, 9159316], [670509, 621042], [867029, 15638039], [564621, 9250976],
  [636178, 4980667], [508546, 5026978], [712918, 15139380], [569510, 3248005], [263675, 4946670], [675821, 2524442],
  [464839, 9159316], [435716, 3140040], [770122, 13973196], [546871, 4803028],
];
for (const [id, uid] of FS) await download(`https://cdn.freesound.org/previews/${Math.floor(id / 1000)}/${id}_${uid}-hq.ogg`, path.join(A, `fs_${id}_${uid}-hq.ogg`));
await download("https://opengameart.org/sites/default/files/Juhani%20Junkala%20-%20Epic%20Boss%20Battle%20%5BSeamlessly%20Looping%5D.wav", path.join(A, "epic_boss_battle_loop.wav"));
await download("https://incompetech.com/music/royalty-free/mp3-royaltyfree/Gathering%20Darkness.mp3", path.join(A, "km_Gathering_Darkness.mp3"));

// ---------------------------------------------------------------- dragon (CC BY 4.0)
// The build reads a Blender re-export of the pinned Draco mirror (see tools/lib/dragon-source.mjs);
// last, so that a machine without Blender still gets every other source.
const DRAGON = path.join(SRC, "dragon/european_dragon.glb");
if (!(await exists(DRAGON))) {
  const draco = path.join(SRC, "dragon/european_dragon_draco.glb");
  await download(DRAGON_MIRROR.url, draco, DRAGON_MIRROR.sha256);
  await reexportDragon(await blender(), draco, DRAGON);
  console.log("got", path.relative(ROOT, DRAGON));
}

/** $BLENDER, else the pinned Linux build, unpacked once into .cache/. */
async function blender() {
  if (process.env.BLENDER) return process.env.BLENDER;
  if (process.platform !== "linux" || process.arch !== "x64") throw new Error(`set BLENDER to a Blender ${BLENDER.version} executable to make ${path.relative(ROOT, DRAGON)}`);
  const dir = path.join(ROOT, ".cache", `blender-${BLENDER.version}`);
  const bin = path.join(dir, `blender-${BLENDER.version}-linux-x64`, "blender");
  if (!(await exists(bin))) {
    await download(BLENDER.url, path.join(TMP, "blender.tar.xz"), BLENDER.sha256);
    // unpack next to the cache dir and move it into place only once tar succeeded, so an interrupted
    // unpack never leaves a tree whose blender exists but is missing its libraries
    const part = dir + ".part";
    await fs.rm(part, { recursive: true, force: true });
    await fs.mkdir(part, { recursive: true });
    await run("tar", ["-xJf", path.join(TMP, "blender.tar.xz"), "-C", part]);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rename(part, dir);
  }
  return bin;
}

await fs.rm(TMP, { recursive: true, force: true });
console.log("extra sources ready");
