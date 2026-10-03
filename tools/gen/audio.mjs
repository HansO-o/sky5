// Audio: Opus (Ogg) primary, AAC (m4a) fallback for browsers without Opus decode (older Safari).
// Loops are made seamless by cross-fading the tail into the head.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const run = promisify(execFile);
const CACHE = path.resolve(import.meta.dirname, "../../.cache/audio");

export const AUDIO = [
  // id, source, options
  { id: "audio/music_menu", src: "01_frost_in_the_northern_winter.ogg", segment: "menu", priority: 40, kbps: 80, stereo: true, trim: [0, 170], fade: 4 },
  { id: "audio/music_cart", src: "Lament_for_a_Warriors_Soul_REUPLOAD.mp3", segment: "cart", priority: 70, kbps: 80, stereo: true, fade: 3 },
  { id: "audio/amb_forest", src: "fs_627064_13875907-hq.ogg", segment: "cart", priority: 93, kbps: 64, stereo: true, loop: 3 },
  { id: "audio/sfx_hooves", src: "fs_479790_2524442-hq.ogg", segment: "cart", priority: 93, kbps: 48, stereo: false, loop: 1.5 },
  { id: "audio/sfx_cart", src: "fs_538438_11519060-hq.ogg", segment: "cart", priority: 93, kbps: 48, stereo: false, loop: 1.5 },
  // muster / execution
  { id: "audio/sfx_bow", src: "fs_263675_4946670-hq.ogg", segment: "muster", priority: 70, kbps: 64, stereo: false },
  { id: "audio/sfx_arrow", src: "fs_675821_2524442-hq.ogg", segment: "muster", priority: 70, kbps: 64, stereo: false, trim: [0, 1.4] },
  { id: "audio/sfx_arrow_hit", src: "fs_464839_9159316-hq.ogg", segment: "muster", priority: 70, kbps: 64, stereo: false },
  { id: "audio/music_tense", src: "km_Gathering_Darkness.mp3", segment: "execution", priority: 80, kbps: 80, stereo: true, fade: 3 },
  // dragon attack
  { id: "audio/roar_a", src: "fs_546391_6174371-hq.ogg", segment: "dragon", priority: 95, kbps: 80, stereo: false },
  { id: "audio/roar_b", src: "fs_651817_12852018-hq.ogg", segment: "dragon", priority: 95, kbps: 80, stereo: false },
  { id: "audio/roar_c", src: "fs_479380_9159316-hq.ogg", segment: "dragon", priority: 90, kbps: 80, stereo: false, trim: [0, 14] },
  { id: "audio/wings", src: "fs_670509_621042-hq.ogg", segment: "dragon", priority: 92, kbps: 64, stereo: false },
  { id: "audio/breath", src: "fs_867029_15638039-hq.ogg", segment: "dragon", priority: 92, kbps: 64, stereo: false, loop: 1 },
  { id: "audio/fire_loop", src: "fs_564621_9250976-hq.ogg", segment: "dragon", priority: 90, kbps: 64, stereo: false, loop: 1 },
  { id: "audio/burning", src: "fs_636178_4980667-hq.ogg", segment: "dragon", priority: 85, kbps: 64, stereo: true, trim: [10, 100], loop: 3 },
  { id: "audio/collapse", src: "fs_508546_5026978-hq.ogg", segment: "dragon", priority: 88, kbps: 64, stereo: false, trim: [0.7, 7.3] },
  { id: "audio/collapse_small", src: "fs_712918_15139380-hq.ogg", segment: "dragon", priority: 85, kbps: 64, stereo: false },
  { id: "audio/rubble", src: "fs_569510_3248005-hq.ogg", segment: "dragon", priority: 85, kbps: 64, stereo: false },
  { id: "audio/panic", src: "fs_435716_3140040-hq.ogg", segment: "dragon", priority: 84, kbps: 64, stereo: true, trim: [0, 70], loop: 3 },
  { id: "audio/bell", src: "fs_770122_13973196-hq.ogg", segment: "execution", priority: 80, kbps: 64, stereo: false, trim: [0, 30] },
  { id: "audio/wind", src: "fs_546871_4803028-hq.ogg", segment: "dragon", priority: 70, kbps: 48, stereo: true, loop: 3 },
  { id: "audio/music_battle", src: "epic_boss_battle_loop.wav", segment: "dragon", priority: 93, kbps: 96, stereo: true },
];

let ffmpegVersion;

async function encode(srcFile, a, codec) {
  // Key on what changes the bytes only (not id/segment/priority), so editing those doesn't re-encode.
  ffmpegVersion ??= run("ffmpeg", ["-version"]).then((r) => r.stdout.split("\n")[0]);
  const { trim, loop, fade, kbps, stereo } = a;
  const key = crypto
    .createHash("sha256")
    .update(await fs.readFile(srcFile))
    .update(JSON.stringify({ trim, loop, fade, kbps, stereo, codec, ffmpeg: await ffmpegVersion, v: 3 }))
    .digest("hex");
  const ext = codec === "opus" ? "ogg" : "m4a";
  const out = path.join(CACHE, `${key}.${ext}`);
  try {
    const hit = await fs.readFile(out);
    if (hit.length >= 1024) return hit;
  } catch {}
  await fs.mkdir(CACHE, { recursive: true });
  const filters = [];
  let pre = "[0:a]";
  if (a.trim) {
    filters.push(`${pre}atrim=${a.trim[0]}:${a.trim[1]},asetpts=PTS-STARTPTS[t]`);
    pre = "[t]";
  }
  if (a.loop) {
    const d = a.loop;
    // second copy of the input (asplit + acrossfade stalls in ffmpeg)
    const t0 = a.trim ? `atrim=${a.trim[0]}:${a.trim[1]},asetpts=PTS-STARTPTS,` : "";
    filters.push(`${pre}atrim=start=${d},asetpts=PTS-STARTPTS[body]`);
    filters.push(`[1:a]${t0}atrim=end=${d},asetpts=PTS-STARTPTS[head]`);
    filters.push(`[body][head]acrossfade=d=${d}:c1=tri:c2=tri[l]`);
    pre = "[l]";
  }
  if (a.fade) {
    filters.push(`${pre}afade=t=in:d=0.5,areverse,afade=t=in:d=${a.fade},areverse[f]`);
    pre = "[f]";
  }
  filters.push(`${pre}aresample=48000,loudnorm=I=-18:TP=-2[o]`);
  // Encode next to the cache entry and rename it into place only once ffmpeg succeeded: an interrupted
  // encode (Ctrl-C makes ffmpeg finalise a shortened file) must never become a cache hit.
  const tmp = path.join(CACHE, `${key}.tmp-${process.pid}-${crypto.randomUUID()}.${ext}`);
  const args = ["-y", "-loglevel", "error", "-i", srcFile, "-i", srcFile, "-filter_complex", filters.join(";"), "-map", "[o]", "-ac", a.stereo ? "2" : "1"];
  if (codec === "opus") args.push("-c:a", "libopus", "-b:a", `${a.kbps}k`, "-vbr", "on");
  else args.push("-c:a", "aac", "-b:a", `${Math.round(a.kbps * 1.5)}k`, "-movflags", "+faststart");
  // Reproducible bytes: fixed Ogg stream serial, no encoder/muxer version tags, no source metadata.
  args.push("-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", tmp);
  try {
    await run("ffmpeg", args);
    const data = await fs.readFile(tmp);
    if (data.length < 1024) throw new Error(`ffmpeg produced an empty file for ${a.id}`);
    await fs.rename(tmp, out);
    return data;
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

export async function buildAudio({ emit, SRC }) {
  for (const a of AUDIO) {
    const src = path.join(SRC, "audio", a.src);
    const [opus, aac] = await Promise.all([encode(src, a, "opus"), encode(src, a, "aac")]);
    // Register the AAC variant as its own file, and the Opus file as the main entry.
    const aacEntry = await emit(a.id + "#aac", { segment: a.segment, priority: a.priority, type: "audio", ext: "m4a", data: aac });
    const e = await emit(a.id, {
      segment: a.segment,
      priority: a.priority,
      type: "audio",
      ext: "ogg",
      data: opus,
    });
    e.variants = {
      opus: { url: e.url, hash: e.hash, size: e.size },
      aac: { url: aacEntry.url, hash: aacEntry.hash, size: aacEntry.size },
    };
    e.loop = !!a.loop;
  }
}
