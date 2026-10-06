// Downloads the non-Poly-Haven sources (characters, horse, creatures, audio) into assets-src/ so the asset
// build is reproducible. Licences are recorded in tools/credits-extra.mjs; each pack's own licence
// file is kept next to the extracted files. Idempotent: existing files are skipped. Mirrors that
// live in someone else's git repository are pinned to a commit and checked against a sha256, and every audio
// source is checked against tools/sources-audio.sha256 (a file already present must match its pin too).
//
//   node tools/fetch-extra.mjs        (BLENDER=<Blender 4.2.3 executable> off Linux x64)
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DRAGON_MIRROR, BLENDER, reexportDragon, sha256 } from "./lib/dragon-source.mjs";
import { itchSignedUrl, zipExtract } from "./lib/zipget.mjs";
import { FPM_KIT } from "./sources.mjs";

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

// ---------------------------------------------------------------- Quaternius Fantasy Props MegaKit (CC0)
// Only what tools/gen/propkit.mjs merges (FPM_KIT in tools/sources.mjs: glTF + .bin per model, the trim
// textures and the licence), pulled out of the 150 MB zip with ranged requests (tools/lib/zipget.mjs,
// which checks each entry's size and CRC-32). Every file, the licence included, must then be the one
// pinned in tools/sources-fpm.sha256 (the files the shipped kit/fpm was built from).
{
  const FPM = path.join(SRC, "props/fpm");
  const want = [...FPM_KIT.models.flatMap((m) => [`${m}.gltf`, `${m}.bin`]), ...FPM_KIT.textures];
  const pinFile = path.join(ROOT, "tools/sources-fpm.sha256");
  const pins = new Map(
    (await fs.readFile(pinFile, "utf8"))
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .map((l) => l.trim().split(/\s+/).reverse()),
  );
  const unpinned = [...want, "LICENSE.txt"].filter((f) => !pins.has(f));
  if (unpinned.length) throw new Error(`${path.relative(ROOT, pinFile)} has no sha256 for ${unpinned.join(", ")} (FPM_KIT in tools/sources.mjs names them): add them`);
  const missing = [];
  for (const f of [...want, "LICENSE.txt"]) if (!(await exists(path.join(FPM, f)))) missing.push(f);
  if (missing.length) {
    const url = await itchSignedUrl(FPM_KIT.game, FPM_KIT.upload);
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const got = await zipExtract(url, new RegExp(`^${esc(FPM_KIT.dir)}(${want.map(esc).join("|")})$`), FPM, { strip: FPM_KIT.dir });
    const licence = await zipExtract(url, /^License_Standard\.txt$/, FPM, { rename: () => "LICENSE.txt" });
    if (!licence.includes("LICENSE.txt")) throw new Error(`the Fantasy Props MegaKit zip (itch upload ${FPM_KIT.upload}) has no License_Standard.txt at its root: its CC0 licence must be kept with the sources, so the kit is not extracted`);
    const lost = want.filter((f) => !got.includes(f));
    if (lost.length) throw new Error(`the Fantasy Props MegaKit zip (itch upload ${FPM_KIT.upload}) lacks ${lost.join(", ")}`);
    console.log("got", path.relative(ROOT, FPM), `(${got.length} files and the licence)`);
  }
  const bad = [];
  for (const f of [...want, "LICENSE.txt"]) {
    const h = sha256(await fs.readFile(path.join(FPM, f)));
    if (h !== pins.get(f)) bad.push(`${f} (sha256 ${h})`);
  }
  if (bad.length) throw new Error(`${path.relative(ROOT, FPM)}: not the pinned files (${path.relative(ROOT, pinFile)}): ${bad.join(", ")}; delete them and re-run`);
}

// ---------------------------------------------------------------- 0 A.D. horse (CC BY-SA 3.0)
// The glbs come from ZeroAD-Godot, a third-party mirror (no LICENSE file of its own) pinned to commit b56df28.
// If it disappears, the upstream Collada sources under `art` (below; the pinned 0ad commit; all 200 on
// 2026-10-06) are meshes/skeletal/horse.dae and animation/quadraped/horse_{walk,trot}.dae; converting them
// (assimpjs or Blender) gives new files, so their sha256 pins and the build's checks must be redone.
const H = path.join(SRC, "horse");
const zad = "https://raw.githubusercontent.com/PhantomMatthew/ZeroAD-Godot/b56df2818f9c535eed5f1ebddfd7c0e12b258017/godot/assets";
const art = "https://raw.githubusercontent.com/0ad/0ad/61a3b9507d974084e6badb88a0826bd89a6d5b8b/binaries/data/mods/public/art";
await download(`${zad}/animations/quadraped/horse_walk.glb`, path.join(H, "horse_walk.glb"), "6a9079dbdc83ebc80034adbdf94d621a48c13ca449c7aa9a4b43c38f8602ed3b");
await download(`${zad}/animations/quadraped/horse_trot.glb`, path.join(H, "horse_trot.glb"), "ab3449e31cae416eb5330377358aa49bb48e3c436bccdb63d6e5f3ed7a451f48");
await download(`${zad}/meshes/skeletal/horse.glb`, path.join(H, "horse.glb"), "ba5257036a89102d0877c678063c039bca7239667a1478dc4d6dcc380ff41dc0");
await download(`${art}/textures/skins/skeletal/horse_brown.png`, path.join(H, "horse_brown.png"), "3e6549478bfd81305dce532714808038a7341194150b4a80ba0d4301b7189c2a");
await download(`${art}/LICENSE.txt`, path.join(H, "LICENSE-0ad-art.txt"), "ef98babd771c206032e005f3d440a1e610df409d9a9191f03e64deaa4abefbd9");

// ---------------------------------------------------------------- creatures (design keep-exit-chapters.md §10.3; tools/gen/creatures.mjs)
// Cave spider: Quaternius "Easy Enemy Pack" (Jan 2019), CC0 1.0. Only FBX/Spider.fbx is pulled out of the
// itch.io zip (upload 1254673) with ranged requests, then checked against its pin. The zip carries no
// licence file (CC0 is stated on quaternius.com and the itch page), so the licence note is written here.
{
  const SP = path.join(SRC, "creatures/spider");
  const fbx = path.join(SP, "Spider.fbx");
  const game = "https://quaternius.itch.io/animated-easy-enemies";
  const pin = "4337f167f59ad5cf590e38c76176210f96a2c7eab62f743110f783694ee0d2c0";
  if (!(await exists(fbx))) {
    const dir = "Easy Animated Enemy Pack - Jan 2019/FBX/";
    const got = await zipExtract(await itchSignedUrl(game, 1254673), /^Easy Animated Enemy Pack - Jan 2019\/FBX\/Spider\.fbx$/, SP, { strip: dir });
    if (!got.includes("Spider.fbx")) throw new Error(`the Easy Enemy Pack zip (itch upload 1254673) has no ${dir}Spider.fbx`);
    console.log("got", path.relative(ROOT, fbx));
  }
  const have = sha256(await fs.readFile(fbx));
  if (have !== pin) throw new Error(`${path.relative(ROOT, fbx)} is not the pinned file (sha256 ${have}, expected ${pin}): delete it and re-run`);
  const licence = [
    "Easy Enemy Pack (January 2019), Spider model and animations, by Quaternius",
    "License: CC0 1.0 Universal (public domain dedication), https://creativecommons.org/publicdomain/zero/1.0/",
    "Stated on https://quaternius.com/packs/easyenemy.html (\"License CC0\") and https://quaternius.itch.io/animated-easy-enemies",
    "(\"FBX, OBJ and Blend formats and CC0 license\"). The pack's zip has no licence file; tools/fetch-extra.mjs wrote this note.",
    "Source: itch.io upload 1254673, zip entry \"Easy Animated Enemy Pack - Jan 2019/FBX/Spider.fbx\".",
    "",
  ].join("\n");
  await fs.writeFile(path.join(SP, "LICENSE.txt"), licence);
}
// Great wolf: the 0 A.D. wolf (Wildfire Games, CC BY-SA 3.0), from the same pinned mirrors as the horse.
// Each clip glb holds the full mesh and skeleton (tools/gen/creatures.mjs uses wolf_walk.glb as the base);
// animal_wolf_grey.png is the 0 A.D. "fur-grey" variant, animal_wolf.png its "fur-brown" one.
// Fallback if the ZeroAD-Godot mirror disappears (design §10.3): the upstream Collada sources at the pinned
// 0ad commit, `${art}/meshes/skeletal/wolf.dae` and `${art}/animation/quadraped/wolf_{walk,run,attack_01,
// attack_02,idle_01,idle_02,death_01}.dae` (all 200 on 2026-10-06; the textures and licence below already
// come from 0ad/0ad). Converted with assimpjs or Blender they are new files: re-pin their sha256 here and
// re-check the merge in tools/gen/creatures.mjs (it asserts one skeleton with identical inverse bind
// matrices across the clip files, and the 0.6 node scale × 1.667 root-bone scale it folds away).
{
  const W = path.join(SRC, "creatures/wolf");
  const clips = {
    walk: "b26d2c458ef1099a5f4dc5e28be639e38463dbe21ff3da4cc4a881ee46742c34",
    run: "d34472d16fb2009cdf71013ccf3840ed07f15db99ae93dcfa6410e608dd4c4d7",
    attack_01: "32fceefc430ef70afc5c56592dfc6ecf135e7fec45d05343f3a03e0c7191b468",
    attack_02: "76ed70100a9424a33c75c6fb4f60f4b4a7c38b3cbbacf5f577f52e2f355b8876",
    idle_01: "897f53529e9e8fb49b9eb9e027c663ff44d76335e543d613fa5b0c103ba5a4cf",
    idle_02: "44d469e1bd8f34c1146d7bf0c67c70fb826b4797250b00868c4f542433726019",
    death_01: "536879e9925331006c5d4ee7b243e966c129790b6495bc59d5a54790299db4f4",
  };
  for (const [c, hash] of Object.entries(clips)) await download(`${zad}/animations/quadraped/wolf_${c}.glb`, path.join(W, `wolf_${c}.glb`), hash);
  await download(`${art}/textures/skins/skeletal/animal_wolf_grey.png`, path.join(W, "animal_wolf_grey.png"), "cca1ea8133ae1b51f7e2767b4c68eb7d5cd1c46668774b3e0ce72fb1c989bbb1");
  await download(`${art}/textures/skins/skeletal/animal_wolf.png`, path.join(W, "animal_wolf.png"), "a9d6e547ae10a1a61b8fde1a6718c3b8c84ee9935d85f5d78421fabaf7150861");
  await download(`${art}/LICENSE.txt`, path.join(W, "LICENSE-0ad-art.txt"), "ef98babd771c206032e005f3d440a1e610df409d9a9191f03e64deaa4abefbd9");
}

// ---------------------------------------------------------------- audio (CC0, and Kevin MacLeod's CC BY 4.0 below)
// Every file must be the one pinned in tools/sources-audio.sha256: the shipped audio/* were built from these bytes,
// and its trims, loop points and loudness-derived gains depend on them (a re-encoded Freesound preview or a
// re-uploaded OpenGameArt file would change them silently).
const A = path.join(SRC, "audio");
const audioPins = new Map(
  (await fs.readFile(path.join(ROOT, "tools/sources-audio.sha256"), "utf8"))
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => l.trim().split(/\s+/).reverse()),
);
/** Downloads one audio source into assets-src/audio, checked against its pin. */
const audioSource = (url, f) => {
  const pin = audioPins.get(f);
  if (!pin) throw new Error(`tools/sources-audio.sha256 has no sha256 for ${f}: add it (sha256sum assets-src/audio/${f}) once the file is checked`);
  return download(url, path.join(A, f), pin);
};
const audio = {
  "01_frost_in_the_northern_winter.ogg": "https://opengameart.org/sites/default/files/01_frost_in_the_northern_winter.ogg",
  "Lament_for_a_Warriors_Soul_REUPLOAD.mp3": "https://opengameart.org/sites/default/files/Lament_for_a_Warriors_Soul_REUPLOAD.mp3",
  "fs_627064_13875907-hq.ogg": "https://cdn.freesound.org/previews/627/627064_13875907-hq.ogg",
  "fs_479790_2524442-hq.ogg": "https://cdn.freesound.org/previews/479/479790_2524442-hq.ogg",
  "fs_538438_11519060-hq.ogg": "https://cdn.freesound.org/previews/538/538438_11519060-hq.ogg",
  // RandomMind "Medieval: Exploration" (CC0, https://opengameart.org/content/medieval-exploration):
  // audio/music_explore (keep and exit chapters).
  "Exploration.mp3": "https://opengameart.org/sites/default/files/Exploration_0.mp3",
  // RandomMind "Medieval: Battle" (CC0, https://opengameart.org/content/medieval-battle): audio/music_fight.
  "oga_medieval_battle.mp3": "https://opengameart.org/sites/default/files/battle_8.mp3",
  // cinameng (James Gargette) "Descent" (CC0, https://opengameart.org/content/descent): audio/music_spider.
  "oga_descent.mp3": "https://opengameart.org/sites/default/files/descent.mp3",
};
for (const [f, url] of Object.entries(audio)) await audioSource(url, f);

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
// Keep and exit chapters (design keep-exit-chapters.md §10.4, research docs/design/research/audio.md; cues in
// tools/gen/audio.mjs). Every page was checked live for the CC0 licence, uploader id and HQ preview (2026-10-03,
// the wolf set 2026-10-06). 199282 (qubodup) is CC0 since 2026-07-30 (stated on its page); it is a slowed
// segment of miguelstar2's CC0 "DR05___0205_sandau_fähre". Rejected after checking (do not add): craigsmith
// 483228/483224, 336888 (mixes CC-BY sources), lendrick 77632–77637, 760636, 414167, 517126, 634775, 497193.
FS.push(
  // combat: swings, hits, blocks, draw, voices, body fall
  [840716, 18136826], [840717, 18136826], [840715, 18136826], [367182, 5065048],
  [547042, 7614679], [547036, 7614679], [547035, 7614679], [522091, 11537497], [452554, 612689],
  [616493, 702542], [616495, 702542], [616494, 702542], [326867, 4077311], [636102, 11705708], [372877, 6944346],
  [577619, 13023338], [547203, 129727], [547202, 129727], [547201, 129727], [547200, 129727],
  [547182, 129727], [547181, 129727], [547189, 129727], [474651, 9250976], [504626, 4437257],
  // footsteps: stone (Wdomino; 517126 is near-silent and skipped), chainmail (Ali_6868)
  [517122, 5026978], [517121, 5026978], [517125, 5026978], [517137, 5026978], [517136, 5026978],
  [517135, 5026978], [517134, 5026978], [517117, 5026978], [517124, 5026978], [517123, 5026978],
  [384881, 984733], [384882, 984733], [384887, 984733],
  // doors, gates, loot, mechanisms, collapses
  [452608, 612689], [734641, 13973196], [159552, 71257], [207137, 2568776], [771164, 789424], [347174, 6324381],
  [584891, 13194852], [381645, 5486695], [567249, 7108319], [506146, 1282624], [784229, 9813501], [199282, 71257],
  // beds: torch, dungeon air, cave, drips, stream, cave wind
  [637523, 612689], [530161, 2683450], [553080, 9250976], [609161, 938246], [552485, 9847211], [852822, 18763192],
  // spider
  [459476, 6232598], [758900, 15895934], [443723, 7262854], [202108, 3756348], [672710, 14685597], [672712, 14685597],
  [559621, 8216881], [515619, 6769489], [659428, 5287430],
  // wolf
  [122183, 71257], [434049, 181941], [342204, 3908740], [380156, 2940947], [734841, 14713973],
  // the §10.4 gaps, picked and checked 2026-10-06: low-health heartbeat (thenudo's stethoscope recording), potion gulp
  [146765, 1417288], [534336, 11867884],
);
for (const [id, uid] of FS) await audioSource(`https://cdn.freesound.org/previews/${Math.floor(id / 1000)}/${id}_${uid}-hq.ogg`, `fs_${id}_${uid}-hq.ogg`);
await audioSource("https://opengameart.org/sites/default/files/Juhani%20Junkala%20-%20Epic%20Boss%20Battle%20%5BSeamlessly%20Looping%5D.wav", "epic_boss_battle_loop.wav");
// Kevin MacLeod (incompetech.com), CC BY 4.0: credited in tools/credits-extra.mjs in incompetech's exact wording.
await audioSource("https://incompetech.com/music/royalty-free/mp3-royaltyfree/Gathering%20Darkness.mp3", "km_Gathering_Darkness.mp3");
await audioSource("https://incompetech.com/music/royalty-free/mp3-royaltyfree/Strength%20of%20the%20Titans.mp3", "km_Strength_of_the_Titans.mp3");

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
