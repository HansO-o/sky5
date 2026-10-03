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
];

async function encode(srcFile, a, codec) {
  const key = crypto.createHash("sha256").update(await fs.readFile(srcFile)).update(JSON.stringify({ a, codec, v: 2 })).digest("hex");
  const out = path.join(CACHE, `${key}.${codec === "opus" ? "ogg" : "m4a"}`);
  try {
    return await fs.readFile(out);
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
  const args = ["-y", "-loglevel", "error", "-i", srcFile, "-i", srcFile, "-filter_complex", filters.join(";"), "-map", "[o]", "-ac", a.stereo ? "2" : "1"];
  if (codec === "opus") args.push("-c:a", "libopus", "-b:a", `${a.kbps}k`, "-vbr", "on", out);
  else args.push("-c:a", "aac", "-b:a", `${Math.round(a.kbps * 1.5)}k`, "-movflags", "+faststart", out);
  await run("ffmpeg", args);
  const data = await fs.readFile(out);
  if (data.length < 1024) {
    await fs.rm(out);
    throw new Error(`ffmpeg produced an empty file for ${a.id}`);
  }
  return data;
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
