// Audio: Opus (Ogg) primary, AAC (m4a) fallback for browsers without Opus decode (older Safari).
//
// Two level and encode paths, chosen by the entry's `norm`:
//   "loudnorm" (or absent): one ffmpeg graph ending in dynamic loudnorm (I -18 LUFS, TP -2 dBTP), encoded
//       straight from it. The earlier chapters' cues and the keep/exit music that does not loop use it; their
//       cache keys, filter chains and bytes are unchanged. Its loops cross-fade the tail into the head and loop
//       over the whole file (the codecs' edge effects can click at the wrap).
//   "peak" / "lufs" (every other keep/exit cue): the chain is rendered to 48 kHz float PCM, measured (EBU R128
//       integrated loudness and true peak), scaled by ONE constant gain (no gain drift, the source's dynamics
//       kept) and encoded from that PCM.
//       "peak": the true peak goes to -2 dBTP. One-shots: every one sits at the same peak.
//       "lufs": -18 LUFS integrated, capped so the true peak stays at or under -2 dBTP. Beds, loops, music.
//       A loop on this path is also wrapped: LOOP_PAD s of its tail are put before its head and LOOP_PAD s of its
//       head after its tail, and the manifest entry gives the loop's bounds in the file (`loopStart`, `loopEnd`,
//       seconds; for AudioBufferSourceNode.loopStart/loopEnd). The codecs' edge effects (Opus pre-skip, AAC
//       priming, the first and last frames) then fall in the padding instead of on the wrap, and a decoder that
//       is off by a constant offset shorter than the padding still loops seamlessly. The build decodes both
//       encodes and fails if the wrap step, per channel and per sample, is larger than every other step.
//
// Runtime level: every cue lands at a common reference, and its manifest `gain` restores relative loudness (absent
// = 1; the runtime multiplies its own per-call volume by it). The table's `gain` is the level wanted relative to that
// reference: a -2 dBTP peak for a one-shot, -18 LUFS for a bed or loop (footsteps 0.25, beds 0.3–0.4, design §10.4).
// One-shots keep the table gain. For loops the build folds in where the constant gain actually landed: a spiky bed
// (torch, drips, a heartbeat) cannot reach -18 LUFS under the -2 dBTP cap, so its gain is raised by the shortfall
// (at most x2, and the result at most 1 so its peaks stay under full scale; cueGain).
//
// Entry options (all in seconds of the source unless noted):
//   src        file in assets-src/audio (sources and licences: tools/fetch-extra.mjs, tools/credits-extra.mjs)
//   segment, priority, pos   manifest placement (pos: [x, z] world hint for "near the player" prefetching)
//   kbps, stereo             Opus bit rate (AAC gets 1.5x) and channel count
//   trim: [a, b]             cut the source
//   rate                     resample-pitch factor (0.8 = a major third lower and 25 % longer), after the trim
//   layers: [{ src, trim, db, at }]  more sources mixed onto the (trimmed) main one, each with its own trim,
//                            level offset in dB and start delay `at`; not with `loop`
//   loop: d                  seamless loop: the last d seconds (of the output) cross-fade into the head, so the
//                            period is the length minus d. Music keeps whole bars: d = 12/7 s is one 4/4 bar at 140 bpm
//   xfade                    the loop cross-fade's curve: "tri" (linear; the default) or "qsin" (equal power: no 3 dB
//                            dip mid-fade on uncorrelated material such as noise beds)
//   fade: d                  0.5 s fade-in and a d-second fade-out (music)
//   fadeIn, fadeOut          a head or tail fade alone (one-shots cut out of longer takes)
//   filter                   an extra ffmpeg audio filter before the level stage (e.g. "lowpass=f=500"); not on a
//                            "lufs" loop (it would start cold on the wrap)
//   norm                     "loudnorm", "peak" or "lufs" (above); the keep/exit sections default to "lufs" for loops
//                            and "peak" for one-shots (chapterCues)
//   gain                     runtime gain (manifest `gain`; not part of the encode); "peak"/"lufs" cues only
//   streamed                 not in the segment's start pack (tools/build-assets.mjs marks it optional)
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const run = promisify(execFile);
const CACHE = path.resolve(import.meta.dirname, "../../.cache/audio");
/** Sample rate of the "peak"/"lufs" path (Opus is 48 kHz; AAC gets the same). */
const SR = 48000;
/** Seconds of wrap-around padding on each side of a "lufs" loop (> AAC's 2048-sample overlap plus its priming). */
const LOOP_PAD = 0.1;
/**
 * Applied to every source of the "peak"/"lufs" path right after resampling (before the trim, so a loop's head and
 * body are filtered as one stream): 24 dB/octave below 25 Hz. Some beds are mostly subsonic (amb_dungeon's source
 * has 88 % of its energy under 20 Hz): inaudible, it eats the true-peak headroom, and Opus does not keep it (its
 * error on that bed was 0.044 RMS, 98 % of it under 20 Hz), so the two ends of a loop came back different.
 */
const HIGHPASS = "highpass=f=25,highpass=f=25";

/** A Freesound HQ preview as tools/fetch-extra.mjs names it. */
const fs_ = (id, uid) => `fs_${id}_${uid}-hq.ogg`;

/** The keep/exit cues: one constant gain ("lufs" for loops, "peak" for one-shots) unless an entry names its own norm. */
const chapterCues = (cues) => cues.map((a) => ({ norm: a.loop ? "lufs" : "peak", ...a }));

// Positions (x, z) for the manifest's prefetch hints (design keep-exit-chapters.md §10.6; cave/anchors).
const AT_KEEP = [60, -662]; // the keep (interior, dungeon)
const AT_GALLERY = [50, -715]; // cave zone A: the gallery, the stream, the camp
const AT_SPIDER = [18, -750]; // cave/anchors spider_c
const AT_WOLF = [-22, -718]; // cave/anchors wolf_bed
const AT_CLIMB = [-46, -681]; // cave/anchors climb_mid (where amb_cave_wind starts)

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

  // ---------------------------------------------------------------- keep (要塞), design §10.4–§10.5
  ...chapterCues([
    // Combat set (K3 onwards; the exit fights reuse it). Numbered cues are variants to pick from at random.
    ...[840716, 840717, 840715].map((id, i) => ({ id: `audio/sfx_swing_${i + 1}`, src: fs_(id, 18136826), segment: "keep", priority: 86, kbps: 48, stereo: false, gain: 0.5, pos: AT_KEEP })),
    { id: "audio/sfx_swing_heavy", src: fs_(367182, 5065048), segment: "keep", priority: 86, kbps: 48, stereo: false, gain: 0.55, pos: AT_KEEP },
    ...[547042, 547036, 547035].map((id, i) => ({ id: `audio/sfx_hit_flesh_${i + 1}`, src: fs_(id, 7614679), segment: "keep", priority: 86, kbps: 64, stereo: false, gain: 0.8, pos: AT_KEEP })),
    // Pound of Flesh with the axe-into-wood chop 3 dB under it
    { id: "audio/sfx_hit_axe", src: fs_(522091, 11537497), layers: [{ src: fs_(452554, 612689), db: -3 }], segment: "keep", priority: 86, kbps: 64, stereo: false, gain: 0.85, pos: AT_KEEP },
    ...[616493, 616495, 616494].map((id, i) => ({ id: `audio/sfx_block_${i + 1}`, src: fs_(id, 702542), segment: "keep", priority: 86, kbps: 64, stereo: false, gain: 0.75, pos: AT_KEEP })),
    { id: "audio/sfx_parry", src: fs_(326867, 4077311), segment: "keep", priority: 86, kbps: 64, stereo: false, gain: 0.8, pos: AT_KEEP },
    // two variants: sword on a shield; metal on a wooden plank (the iron-bossed wooden shield)
    { id: "audio/sfx_shield_hit", src: fs_(636102, 11705708), segment: "keep", priority: 86, kbps: 64, stereo: false, gain: 0.8, pos: AT_KEEP },
    { id: "audio/sfx_shield_hit_2", src: fs_(372877, 6944346), segment: "keep", priority: 86, kbps: 64, stereo: false, gain: 0.75, pos: AT_KEEP },
    { id: "audio/sfx_draw", src: fs_(577619, 13023338), segment: "keep", priority: 88, kbps: 64, stereo: false, gain: 0.5, pos: AT_KEEP },
    // K1: cutting the rope bonds: the scrape at the head of the sword draw
    { id: "audio/sfx_rope_cut", src: fs_(577619, 13023338), trim: [0.05, 0.65], fadeOut: 0.15, segment: "keep", priority: 88, kbps: 64, stereo: false, gain: 0.5, pos: AT_KEEP },
    ...[547203, 547202, 547201, 547200].map((id, i) => ({ id: `audio/vo_pain_${i + 1}`, src: fs_(id, 129727), segment: "keep", priority: 85, kbps: 48, stereo: false, gain: 0.6, pos: AT_KEEP })),
    ...[547182, 547181, 547189].map((id, i) => ({ id: `audio/vo_death_${i + 1}`, src: fs_(id, 129727), segment: "keep", priority: 85, kbps: 48, stereo: false, gain: 0.7, pos: AT_KEEP })),
    // Nox_Sound "Voice_Male_Attack": five takes, each padded 0.12 s before and 0.25 s after its -40 dB bounds
    ...[[0, 0.87], [1.17, 1.98], [2.29, 2.99], [3.38, 4.42], [4.54, 5.41]].map((trim, i) => ({ id: `audio/vo_attack_${i + 1}`, src: fs_(474651, 9250976), trim, fadeIn: 0.01, fadeOut: 0.1, segment: "keep", priority: 85, kbps: 48, stereo: false, gain: 0.55, pos: AT_KEEP })),
    { id: "audio/sfx_bodyfall", src: fs_(504626, 4437257), segment: "keep", priority: 85, kbps: 64, stereo: false, gain: 0.7, pos: AT_KEEP },
    // The §10.4 gaps (picked for this build): the low-health heartbeat, a loop of exactly 8 beats (onsets 10.54 and
    // 18.94 s, 57 bpm; the 0.15 s cross-fade sits in the quiet before a beat; setBedRate speeds it up), and the
    // potion gulp (heal, KeyQ)
    { id: "audio/sfx_heartbeat", src: fs_(146765, 1417288), trim: [10.34, 18.89], loop: 0.15, xfade: "qsin", segment: "keep", priority: 84, kbps: 40, stereo: false, gain: 0.6, pos: AT_KEEP },
    { id: "audio/sfx_potion", src: fs_(534336, 11867884), trim: [0.3, 0.95], fadeIn: 0.01, fadeOut: 0.1, segment: "keep", priority: 84, kbps: 48, stereo: false, gain: 0.6, pos: AT_KEEP },
    // Footsteps: Wdomino stone one-shots (517126 is near-silent, skipped), Ali_6868 chainmail steps (armoured NPCs)
    ...[517122, 517121, 517125, 517137, 517136, 517135, 517134, 517117, 517124, 517123].map((id, i) => ({ id: `audio/steps_stone_${i + 1}`, src: fs_(id, 5026978), segment: "keep", priority: 87, kbps: 40, stereo: false, gain: 0.25, pos: AT_KEEP })),
    ...[384881, 384882, 384887].map((id, i) => ({ id: `audio/steps_mail_${i + 1}`, src: fs_(id, 984733), segment: "keep", priority: 87, kbps: 40, stereo: false, gain: 0.25, pos: AT_KEEP })),
    // Doors, gates, loot (K1, K2, K4–K6)
    { id: "audio/sfx_door_wood", src: fs_(452608, 612689), trim: [0.38, 1.33], fadeIn: 0.01, fadeOut: 0.1, segment: "keep", priority: 88, kbps: 64, stereo: false, gain: 0.7, pos: AT_KEEP },
    { id: "audio/sfx_door_wood_2", src: fs_(452608, 612689), trim: [11.0, 12.08], fadeIn: 0.01, fadeOut: 0.1, segment: "keep", priority: 88, kbps: 64, stereo: false, gain: 0.7, pos: AT_KEEP },
    { id: "audio/sfx_lock", src: fs_(734641, 13973196), trim: [0.2, 1.65], segment: "keep", priority: 84, kbps: 64, stereo: false, gain: 0.6, pos: AT_KEEP },
    { id: "audio/sfx_gate_slam", src: fs_(159552, 71257), segment: "keep", priority: 84, kbps: 64, stereo: false, gain: 0.8, pos: AT_KEEP },
    { id: "audio/sfx_iron_gate", src: fs_(207137, 2568776), trim: [0.32, 1.9], fadeIn: 0.01, fadeOut: 0.2, segment: "keep", priority: 84, kbps: 64, stereo: false, gain: 0.7, pos: AT_KEEP },
    { id: "audio/sfx_chest", src: fs_(771164, 789424), segment: "keep", priority: 88, kbps: 64, stereo: false, gain: 0.6, pos: AT_KEEP },
    { id: "audio/sfx_pickup", src: fs_(347174, 6324381), segment: "keep", priority: 88, kbps: 48, stereo: false, gain: 0.4, pos: AT_KEEP },
    // Set pieces: the postern beam (K1), tremors (K4, K9; low-passed: heard through the rock), the collapse (K9,
    // K12), the gallery lever and winch (K11), the drawbridge crash (K12)
    { id: "audio/sfx_beam_crash", src: fs_(584891, 13194852), trim: [0.3, 1.5], fadeOut: 0.25, segment: "keep", priority: 88, kbps: 64, stereo: false, gain: 0.9, pos: AT_KEEP },
    { id: "audio/sfx_rumble", src: fs_(712918, 15139380), filter: "lowpass=f=420,lowpass=f=420", fadeOut: 0.5, segment: "keep", priority: 82, kbps: 48, stereo: false, gain: 0.8, pos: AT_KEEP },
    { id: "audio/sfx_rockfall", src: fs_(381645, 5486695), trim: [0.25, 4.1], layers: [{ src: fs_(567249, 7108319), db: -6, at: 0.15 }], fadeOut: 0.4, segment: "keep", priority: 82, kbps: 64, stereo: false, gain: 0.9, pos: AT_GALLERY },
    { id: "audio/sfx_lever", src: fs_(506146, 1282624), segment: "keep", priority: 78, kbps: 64, stereo: false, gain: 0.7, pos: AT_GALLERY },
    // 8 s of the running chain drive with qubodup's dragged chain under it (the chain source is ~29 dB louder:
    // -12.6 against -41 dB mean, so -35 dB puts it 6 dB under the mechanism)
    { id: "audio/sfx_chain_mech", src: fs_(784229, 9813501), trim: [5, 13], layers: [{ src: fs_(199282, 71257), trim: [10, 18], db: -35 }], fadeIn: 0.3, fadeOut: 1, segment: "keep", priority: 78, kbps: 64, stereo: false, gain: 0.7, pos: AT_GALLERY },
    { id: "audio/sfx_bridge_crash", src: fs_(508546, 5026978), trim: [0.45, 7.65], fadeOut: 0.4, segment: "keep", priority: 78, kbps: 64, stereo: false, gain: 1, pos: AT_GALLERY },
    // Beds (src/prologue/keep/underground.ts levels: gf torch; bs dungeon + drips; cave cave + stream)
    { id: "audio/amb_torch", src: fs_(637523, 612689), trim: [2, 22], loop: 1.5, xfade: "qsin", segment: "keep", priority: 90, kbps: 40, stereo: false, gain: 0.4, pos: AT_KEEP },
    { id: "audio/amb_dungeon", src: fs_(530161, 2683450), trim: [45, 105], loop: 3, xfade: "qsin", segment: "keep", priority: 80, kbps: 48, stereo: true, gain: 0.35, pos: AT_KEEP },
    // drips: the recording fades in over its first ~4 s (its floor at 2–4 s is 3.4 dB under the rest), so the loop
    // starts at 5 s and its cross-fade blends two stretches at the body's level
    { id: "audio/amb_drips", src: fs_(609161, 938246), trim: [5, 45], loop: 2, xfade: "qsin", segment: "keep", priority: 80, kbps: 48, stereo: true, gain: 0.3, pos: AT_KEEP },
    { id: "audio/amb_cave", src: fs_(553080, 9250976), loop: 2, xfade: "qsin", segment: "keep", priority: 76, kbps: 48, stereo: true, gain: 0.35, pos: AT_GALLERY },
    { id: "audio/amb_stream", src: fs_(552485, 9847211), loop: 2, xfade: "qsin", segment: "keep", priority: 76, kbps: 48, stereo: true, gain: 0.35, pos: AT_GALLERY },
    // Music: the fights (K3 onwards, also the exit fights); the gallery and the exit's calm stretches (K11, X0, X3).
    // Neither loops, so both keep dynamic loudnorm (Exploration cannot reach -18 LUFS under -2 dBTP with one gain).
    { id: "audio/music_fight", src: "oga_medieval_battle.mp3", trim: [0, 71.6], fadeOut: 1, norm: "loudnorm", segment: "keep", priority: 80, kbps: 80, stereo: true, pos: AT_KEEP },
    { id: "audio/music_explore", src: "Exploration.mp3", trim: [1, 234], fadeOut: 2, norm: "loudnorm", segment: "keep", priority: 60, kbps: 80, stereo: true, pos: AT_GALLERY, streamed: true },

    // ---------------------------------------------------------------- exit (出洞)
    // Spider nest (X1): hisses (two takes of a hissing cockroach and a short hiss), skitter (loop, movement),
    // chatter (loop, the nest bed), attacks, death (monster death with a squish 2 dB under it), web tearing
    { id: "audio/spider_hiss", src: fs_(459476, 6232598), trim: [4.25, 5.25], fadeIn: 0.01, fadeOut: 0.15, segment: "exit", priority: 85, kbps: 48, stereo: false, gain: 0.7, pos: AT_SPIDER },
    { id: "audio/spider_hiss_2", src: fs_(459476, 6232598), trim: [8.28, 9.6], fadeIn: 0.01, fadeOut: 0.15, segment: "exit", priority: 85, kbps: 48, stereo: false, gain: 0.7, pos: AT_SPIDER },
    { id: "audio/spider_hiss_3", src: fs_(758900, 15895934), segment: "exit", priority: 85, kbps: 48, stereo: false, gain: 0.7, pos: AT_SPIDER },
    { id: "audio/spider_skitter", src: fs_(443723, 7262854), trim: [0.3, 8.4], loop: 1, xfade: "qsin", segment: "exit", priority: 85, kbps: 48, stereo: false, gain: 0.4, pos: AT_SPIDER },
    { id: "audio/spider_chatter", src: fs_(202108, 3756348), trim: [0.5, 12.6], loop: 1.5, xfade: "qsin", segment: "exit", priority: 82, kbps: 48, stereo: true, gain: 0.35, pos: AT_SPIDER },
    { id: "audio/spider_attack", src: fs_(672710, 14685597), segment: "exit", priority: 85, kbps: 48, stereo: false, gain: 0.8, pos: AT_SPIDER },
    { id: "audio/spider_attack_2", src: fs_(672712, 14685597), segment: "exit", priority: 85, kbps: 48, stereo: false, gain: 0.8, pos: AT_SPIDER },
    { id: "audio/spider_death", src: fs_(559621, 8216881), layers: [{ src: fs_(515619, 6769489), db: -2 }], segment: "exit", priority: 84, kbps: 48, stereo: false, gain: 0.8, pos: AT_SPIDER },
    { id: "audio/sfx_web", src: fs_(659428, 5287430), segment: "exit", priority: 84, kbps: 48, stereo: false, gain: 0.5, pos: AT_SPIDER },
    // Wolf den (X2): sleeping breath (a quiet grumble pitched down to 0.8, loop), stir growls (two takes of a
    // German Shepherd; the barks at the end of the take are left out), snarl, waking howl, death (an addition to
    // §10.4: the bear research's verified CC0 "dyingBeast")
    { id: "audio/wolf_breath", src: fs_(122183, 71257), trim: [0.4, 4.15], rate: 0.8, loop: 0.8, xfade: "qsin", segment: "exit", priority: 82, kbps: 48, stereo: false, gain: 0.35, pos: AT_WOLF },
    { id: "audio/wolf_growl", src: fs_(434049, 181941), trim: [1.7, 4.1], fadeIn: 0.05, fadeOut: 0.3, segment: "exit", priority: 82, kbps: 48, stereo: false, gain: 0.8, pos: AT_WOLF },
    { id: "audio/wolf_growl_2", src: fs_(434049, 181941), trim: [4.2, 8.6], fadeIn: 0.05, fadeOut: 0.3, segment: "exit", priority: 82, kbps: 48, stereo: false, gain: 0.8, pos: AT_WOLF },
    { id: "audio/wolf_snarl", src: fs_(342204, 3908740), segment: "exit", priority: 82, kbps: 48, stereo: false, gain: 0.85, pos: AT_WOLF },
    { id: "audio/wolf_howl", src: fs_(380156, 2940947), trim: [2.0, 7.9], fadeOut: 0.8, segment: "exit", priority: 82, kbps: 48, stereo: false, gain: 0.9, pos: AT_WOLF },
    { id: "audio/wolf_death", src: fs_(734841, 14713973), segment: "exit", priority: 80, kbps: 48, stereo: false, gain: 0.85, pos: AT_WOLF },
    // The climb's wind (X3, from climb_mid)
    { id: "audio/amb_cave_wind", src: fs_(852822, 18763192), trim: [20, 80], loop: 3, xfade: "qsin", segment: "exit", priority: 75, kbps: 48, stereo: true, gain: 0.35, pos: AT_CLIMB },
    // Music, streamed while the exit plays: the spider nest; the wolf fight (Kevin MacLeod, CC BY 4.0).
    // "Descent" is 160 beats (40 bars) at 140 bpm: 3,024,000 samples at 44.1 kHz = 480/7 s, of which the first ~1100
    // are the MP3 encoder delay (silence) and the last bar ends on a hard cut, so it does not loop as-is. Its last bar
    // cross-fades into the first (12/7 s, equal power), beat on beat: a 39-bar loop (156 beats, 66.857 s) that keeps
    // the bar grid. Constant gain to -18 LUFS (it reaches it at -5.4 dBTP).
    { id: "audio/music_spider", src: "oga_descent.mp3", loop: 12 / 7, xfade: "qsin", segment: "exit", priority: 60, kbps: 80, stereo: true, pos: AT_SPIDER, streamed: true },
    { id: "audio/music_beast", src: "km_Strength_of_the_Titans.mp3", trim: [0.3, 59], fadeOut: 0.5, norm: "loudnorm", segment: "exit", priority: 60, kbps: 80, stereo: true, pos: AT_WOLF, streamed: true },
  ]),
];

/** Ids of the cues that stream in while their segment plays (not part of its start pack). */
export const AUDIO_STREAMED = AUDIO.filter((a) => a.streamed).map((a) => a.id);

/** Credit ids (tools/credits-extra.mjs) of the sources that are not Freesound previews (those are `fs-<id>`). */
const CREDIT_OF = {
  "01_frost_in_the_northern_winter.ogg": "music-frost",
  "Lament_for_a_Warriors_Soul_REUPLOAD.mp3": "music-lament",
  "km_Gathering_Darkness.mp3": "music-gathering",
  "epic_boss_battle_loop.wav": "music-battle",
  "oga_medieval_battle.mp3": "music-medieval-battle",
  "Exploration.mp3": "music-medieval-exploration",
  "oga_descent.mp3": "music-descent",
  "km_Strength_of_the_Titans.mp3": "music-strength-titans",
};

/** Every (cue, source) pair with the credit id the source needs, for the build's credits coverage gate. */
export function audioCredits() {
  const credit = (f) => {
    const id = /^fs_(\d+)_\d+-hq\.ogg$/.exec(f)?.[1];
    if (id) return `fs-${id}`;
    if (CREDIT_OF[f]) return CREDIT_OF[f];
    throw new Error(`audio: ${f} has no credit id (add it to CREDIT_OF in tools/gen/audio.mjs)`);
  };
  return AUDIO.flatMap((a) => [a.src, ...(a.layers ?? []).map((l) => l.src)].map((src) => ({ asset: a.id, src, credit: credit(src) })));
}


// Table checks: unique ids and options that go together (buildAudio checks that every named source exists).
{
  const seen = new Set();
  for (const a of AUDIO) {
    if (seen.has(a.id)) throw new Error(`audio: duplicate id ${a.id}`);
    seen.add(a.id);
    const constant = a.norm === "peak" || a.norm === "lufs";
    if (a.norm !== undefined && !constant && a.norm !== "loudnorm") throw new Error(`audio: ${a.id}: norm "${a.norm}" is not "loudnorm", "peak" or "lufs"`);
    if (a.xfade !== undefined && a.xfade !== "tri" && a.xfade !== "qsin") throw new Error(`audio: ${a.id}: xfade "${a.xfade}" is not "tri" or "qsin"`);
    if (a.xfade && !a.loop) throw new Error(`audio: ${a.id}: xfade without loop`);
    if (a.xfade && !constant) throw new Error(`audio: ${a.id}: xfade needs norm "lufs" (the "loudnorm" path always cross-fades linearly)`);
    if (a.layers && a.loop) throw new Error(`audio: ${a.id}: layers and loop do not combine (the loop head is cut from the main source only)`);
    if (a.loop && a.norm === "peak") throw new Error(`audio: ${a.id}: a loop is levelled by loudness (norm "lufs"), not by its peak`);
    if (a.loop && a.norm === "lufs" && a.filter) throw new Error(`audio: ${a.id}: a filter on a "lufs" loop would start cold on the wrap; filter the source instead`);
    if (a.gain !== undefined && !constant) throw new Error(`audio: ${a.id}: a manifest gain needs norm "peak" or "lufs" (its reference level)`);
    if (a.gain !== undefined && !(a.gain > 0 && a.gain <= 2)) throw new Error(`audio: ${a.id}: gain ${a.gain} is outside (0, 2]`);
    if (a.trim && !(a.trim[1] > a.trim[0])) throw new Error(`audio: ${a.id}: empty trim ${a.trim}`);
    if (a.loop && a.trim && (a.trim[1] - a.trim[0]) / (a.rate ?? 1) <= 2 * a.loop) throw new Error(`audio: ${a.id}: a ${a.loop} s loop cross-fade needs more than ${2 * a.loop} s of audio`);
  }
}

let ffmpegVersion;

/** The resample-pitch filter for `rate` (48 kHz in and out), with a trailing comma; "" without one. */
const rateFilter = (rate) => (rate ? `aresample=48000,asetrate=${Math.round(48000 * rate)},aresample=48000,` : "");

/** The "loudnorm" path: one ffmpeg graph from the source(s) to the encoded file (the earlier chapters' cues). */
async function encode(srcFile, a, codec, layerFiles = []) {
  // Key on what changes the bytes only (not id/segment/priority/gain/pos), so editing those doesn't re-encode.
  // The options added for the keep/exit cues are undefined (left out of the JSON) on the older entries, whose
  // keys and filter chains are unchanged.
  ffmpegVersion ??= run("ffmpeg", ["-version"]).then((r) => r.stdout.split("\n")[0]);
  const { trim, loop, fade, kbps, stereo, rate, filter, fadeIn, fadeOut } = a;
  const layers = a.layers?.map(({ trim, db, at }) => ({ trim, db, at }));
  const h = crypto.createHash("sha256").update(await fs.readFile(srcFile));
  for (const f of layerFiles) h.update(await fs.readFile(f));
  const key = h.update(JSON.stringify({ trim, loop, fade, kbps, stereo, codec, ffmpeg: await ffmpegVersion, v: 3, rate, layers, filter, fadeIn, fadeOut })).digest("hex");
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
  if (a.rate) {
    filters.push(`${pre}${rateFilter(a.rate).slice(0, -1)}[r]`);
    pre = "[r]";
  }
  if (a.layers) {
    // inputs 0 and 1 are the main source (1 feeds the loop head); the layers follow from input 2
    const fmt = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
    filters.push(`${pre}${fmt}[m0]`);
    const mix = ["[m0]"];
    a.layers.forEach((l, i) => {
      const parts = [];
      if (l.trim) parts.push(`atrim=${l.trim[0]}:${l.trim[1]}`, "asetpts=PTS-STARTPTS");
      parts.push(fmt, `volume=${l.db ?? 0}dB`);
      if (l.at) parts.push(`adelay=${Math.round(l.at * 1000)}:all=1`);
      filters.push(`[${i + 2}:a]${parts.join(",")}[m${i + 1}]`);
      mix.push(`[m${i + 1}]`);
    });
    filters.push(`${mix.join("")}amix=inputs=${mix.length}:duration=longest:normalize=0[mx]`);
    pre = "[mx]";
  }
  if (a.loop) {
    const d = a.loop;
    // second copy of the input (asplit + acrossfade stalls in ffmpeg)
    const t0 = (a.trim ? `atrim=${a.trim[0]}:${a.trim[1]},asetpts=PTS-STARTPTS,` : "") + rateFilter(a.rate);
    filters.push(`${pre}atrim=start=${d},asetpts=PTS-STARTPTS[body]`);
    filters.push(`[1:a]${t0}atrim=end=${d},asetpts=PTS-STARTPTS[head]`);
    filters.push(`[body][head]acrossfade=d=${d}:c1=tri:c2=tri[l]`);
    pre = "[l]";
  }
  if (a.fade) {
    filters.push(`${pre}afade=t=in:d=0.5,areverse,afade=t=in:d=${a.fade},areverse[f]`);
    pre = "[f]";
  }
  if (a.fadeIn) {
    filters.push(`${pre}afade=t=in:d=${a.fadeIn}[fi]`);
    pre = "[fi]";
  }
  if (a.fadeOut) {
    filters.push(`${pre}areverse,afade=t=in:d=${a.fadeOut},areverse[fo]`);
    pre = "[fo]";
  }
  if (a.filter) {
    filters.push(`${pre}${a.filter}[x]`);
    pre = "[x]";
  }
  const inputs = ["-i", srcFile, "-i", srcFile, ...layerFiles.flatMap((f) => ["-i", f])];
  filters.push(`${pre}aresample=48000,loudnorm=I=-18:TP=-2[o]`);
  // Encode next to the cache entry and rename it into place only once ffmpeg succeeded: an interrupted
  // encode (Ctrl-C makes ffmpeg finalise a shortened file) must never become a cache hit.
  const tmp = path.join(CACHE, `${key}.tmp-${process.pid}-${crypto.randomUUID()}.${ext}`);
  const args = ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filters.join(";"), "-map", "[o]", "-ac", a.stereo ? "2" : "1"];
  args.push(...codecArgs(codec, a.kbps), tmp);
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

/** Encoder arguments; reproducible bytes: fixed Ogg stream serial, no encoder/muxer version tags, no source metadata. */
const codecArgs = (codec, kbps) => [
  ...(codec === "opus" ? ["-c:a", "libopus", "-b:a", `${kbps}k`, "-vbr", "on"] : ["-c:a", "aac", "-b:a", `${Math.round(kbps * 1.5)}k`, "-movflags", "+faststart"]),
  ...["-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact"],
];

/** ffmpeg's loudnorm measurement (integrated loudness LUFS, true peak dBTP) of raw 48 kHz float PCM. */
async function measure(rawFile, channels) {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-f", "f32le", "-ar", String(SR), "-ac", String(channels), "-i", rawFile, "-af", "loudnorm=I=-18:TP=-2:print_format=json", "-f", "null", "-"], { maxBuffer: 1 << 26 });
  const m = JSON.parse(stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1));
  return { i: Number(m.input_i), tp: Number(m.input_tp) };
}

/** Decodes an encoded file to interleaved 48 kHz float PCM (ffmpeg applies Opus pre-skip and the m4a edit list). */
async function decode(file) {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", file, "-f", "f32le", "-ar", String(SR), "-"], { encoding: "buffer", maxBuffer: 1 << 28 });
  return new Float32Array(stdout.buffer, stdout.byteOffset, stdout.length / 4);
}

/**
 * The wrap of a loop in decoded PCM, per channel: the step from the loop's last sample to its first against every
 * other sample-to-sample step inside the loop (`max`, and the 99.9th percentile). A click is a step larger than
 * all the others.
 */
function seamStats(pcm, channels, start, frames) {
  const out = [];
  for (let c = 0; c < channels; c++) {
    const steps = new Float32Array(frames - 1);
    for (let i = 0; i < frames - 1; i++) steps[i] = Math.abs(pcm[(start + i + 1) * channels + c] - pcm[(start + i) * channels + c]);
    const wrap = Math.abs(pcm[start * channels + c] - pcm[(start + frames - 1) * channels + c]);
    steps.sort();
    out.push({ wrap: +wrap.toFixed(5), max: +steps[steps.length - 1].toFixed(5), p999: +steps[Math.floor(steps.length * 0.999)].toFixed(5) });
  }
  return out;
}

/**
 * The cross-fade's level against the rest of a loop: RMS of a window centred on the middle of the fade (the loop's
 * last d seconds), in dB against the median of all windows of that size, and its percentile among them.
 */
function fadeDip(pcm, channels, frames, fadeFrames) {
  const w = Math.max(1, Math.round(Math.min(1, fadeFrames / SR) * SR));
  const rms = (s) => {
    let e = 0;
    for (let i = s * channels; i < (s + w) * channels; i++) e += pcm[i] * pcm[i];
    return 10 * Math.log10(e / (w * channels) + 1e-20);
  };
  const all = [];
  for (let s = 0; s + w <= frames; s += w) all.push(rms(s));
  const mid = rms(Math.max(0, frames - Math.round(fadeFrames / 2) - Math.round(w / 2)));
  const sorted = [...all].sort((x, y) => x - y);
  return { db: +(mid - sorted[sorted.length >> 1]).toFixed(1), pct: Math.round((100 * all.filter((v) => v < mid).length) / all.length) };
}

/**
 * The "peak"/"lufs" path: render the chain to 48 kHz float PCM, measure it, scale it by one constant gain, wrap a
 * loop in LOOP_PAD s of its own tail and head, encode both codecs from that PCM and, for a loop, check the wrap of
 * both decoded files. Returns { opus, aac, meta }; everything is cached under one key.
 */
async function encodeConstant(srcFile, a, layerFiles = []) {
  ffmpegVersion ??= run("ffmpeg", ["-version"]).then((r) => r.stdout.split("\n")[0]);
  const { trim, loop, xfade, fade, kbps, stereo, rate, filter, fadeIn, fadeOut, norm } = a;
  const layers = a.layers?.map(({ trim, db, at }) => ({ trim, db, at }));
  const h = crypto.createHash("sha256").update(await fs.readFile(srcFile));
  for (const f of layerFiles) h.update(await fs.readFile(f));
  const pad = loop ? LOOP_PAD : undefined;
  const key = h.update(JSON.stringify({ path: "constant", v: 2, trim, loop, xfade, fade, kbps, stereo, rate, layers, filter, fadeIn, fadeOut, norm, pad, sr: SR, highpass: HIGHPASS, ffmpeg: await ffmpegVersion })).digest("hex");
  const files = { meta: path.join(CACHE, `${key}.json`), opus: path.join(CACHE, `${key}.ogg`), aac: path.join(CACHE, `${key}.m4a`) };
  try {
    const [meta, opus, aac] = await Promise.all([fs.readFile(files.meta, "utf8").then(JSON.parse), fs.readFile(files.opus), fs.readFile(files.aac)]);
    if (opus.length >= 1024 && aac.length >= 1024 && meta.key === key) return { opus, aac, meta };
  } catch {}
  await fs.mkdir(CACHE, { recursive: true });
  // a stale or partial entry is never a hit again: the metadata goes first, and comes back last
  await fs.rm(files.meta, { force: true });
  if (os.endianness() !== "LE") throw new Error("audio: the PCM path assumes a little-endian host (f32le)");
  const channels = stereo ? 2 : 1;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "np-audio-"));
  try {
    // 1. the chain, at 48 kHz from the start (a loop's head and body are then cut from the same resampled stream)
    const prep = (i) => `[${i}:a]aresample=${SR},${HIGHPASS}` + (trim ? `,atrim=${trim[0]}:${trim[1]},asetpts=PTS-STARTPTS` : "") + (rate ? `,asetrate=${Math.round(SR * rate)},aresample=${SR}` : "");
    const filters = [`${prep(0)}[s]`];
    let pre = "[s]";
    if (a.layers) {
      const fmt = `aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo`;
      filters.push(`${pre}${fmt}[m0]`);
      const lfmt = `aresample=${SR},${HIGHPASS},aformat=sample_fmts=fltp:channel_layouts=stereo`;
      const mix = ["[m0]"];
      a.layers.forEach((l, i) => {
        const parts = [];
        if (l.trim) parts.push(`atrim=${l.trim[0]}:${l.trim[1]}`, "asetpts=PTS-STARTPTS");
        parts.push(lfmt, `volume=${l.db ?? 0}dB`);
        if (l.at) parts.push(`adelay=${Math.round(l.at * 1000)}:all=1`);
        filters.push(`[${i + 2}:a]${parts.join(",")}[m${i + 1}]`);
        mix.push(`[m${i + 1}]`);
      });
      filters.push(`${mix.join("")}amix=inputs=${mix.length}:duration=longest:normalize=0[mx]`);
      pre = "[mx]";
    }
    const fadeFrames = loop ? Math.round(loop * SR) : 0;
    if (loop) {
      // the body without its first d seconds; the last d seconds of the body cross-fade into those (input 1)
      const curve = xfade ?? "tri";
      filters.push(`${pre}atrim=start_sample=${fadeFrames},asetpts=PTS-STARTPTS[body]`);
      filters.push(`${prep(1)},atrim=end_sample=${fadeFrames},asetpts=PTS-STARTPTS[head]`);
      filters.push(`[body][head]acrossfade=ns=${fadeFrames}:c1=${curve}:c2=${curve}[l]`);
      pre = "[l]";
    }
    if (fade) {
      filters.push(`${pre}afade=t=in:d=0.5,areverse,afade=t=in:d=${fade},areverse[f]`);
      pre = "[f]";
    }
    if (fadeIn) {
      filters.push(`${pre}afade=t=in:d=${fadeIn}[fi]`);
      pre = "[fi]";
    }
    if (fadeOut) {
      filters.push(`${pre}areverse,afade=t=in:d=${fadeOut},areverse[fo]`);
      pre = "[fo]";
    }
    if (filter) {
      filters.push(`${pre}${filter}[x]`);
      pre = "[x]";
    }
    filters.push(`${pre}aformat=sample_fmts=flt:sample_rates=${SR}[o]`);
    const raw = path.join(tmp, "chain.f32");
    const inputs = ["-i", srcFile, "-i", srcFile, ...layerFiles.flatMap((f) => ["-i", f])];
    await run("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filters.join(";"), "-map", "[o]", "-ac", String(channels), "-ar", String(SR), "-f", "f32le", raw]);
    const buf = await fs.readFile(raw);
    const pcm = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
    const frames = pcm.length / channels;
    // 2. one constant gain
    const m = await measure(raw, channels);
    if (!Number.isFinite(m.tp)) throw new Error(`audio: ${a.id}: no true peak measured (silent?)`);
    if (norm === "lufs" && !Number.isFinite(m.i)) throw new Error(`audio: ${a.id}: no integrated loudness measured (too short or silent for "lufs")`);
    const gainDb = norm === "peak" ? -2 - m.tp : Math.min(-18 - m.i, -2 - m.tp);
    const k = 10 ** (gainDb / 20);
    // 3. a loop's wrap-around padding
    const padFrames = loop ? Math.round(LOOP_PAD * SR) : 0;
    if (loop && frames <= 2 * padFrames) throw new Error(`audio: ${a.id}: a ${frames / SR} s loop is too short for ${LOOP_PAD} s of padding`);
    const outPcm = new Float32Array((frames + 2 * padFrames) * channels);
    outPcm.set(pcm.subarray((frames - padFrames) * channels), 0);
    outPcm.set(pcm, padFrames * channels);
    outPcm.set(pcm.subarray(0, padFrames * channels), (padFrames + frames) * channels);
    for (let i = 0; i < outPcm.length; i++) outPcm[i] *= k;
    const scaled = path.join(tmp, "scaled.f32");
    await fs.writeFile(scaled, Buffer.from(outPcm.buffer));
    // 4. both codecs
    const enc = {};
    for (const [codec, ext] of [["opus", "ogg"], ["aac", "m4a"]]) {
      enc[codec] = path.join(tmp, `out.${ext}`);
      await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "f32le", "-ar", String(SR), "-ac", String(channels), "-i", scaled, ...codecArgs(codec, kbps), enc[codec]]);
    }
    const meta = {
      key,
      frames,
      dur: +(frames / SR).toFixed(4),
      measured: { lufs: m.i, tp: m.tp },
      gainDb: +gainDb.toFixed(2),
      lufs: Number.isFinite(m.i) ? +(m.i + gainDb).toFixed(2) : null,
      tp: +(m.tp + gainDb).toFixed(2),
    };
    if (loop) {
      // The padded file is periodic throughout (period `frames`), so any start in the padding gives a loop of the
      // same content. Each codec gets the start, within the middle half of the padding (at least LOOP_PAD/2 from
      // either end of the file), where its two decoded copies agree best: the codec's error is then about the
      // same on both sides of the wrap. Bounds in seconds of the file (whole 48 kHz samples).
      meta.fade = fadeDip(pcm, channels, frames, fadeFrames);
      meta.seam = { pcm: seamStats(outPcm, channels, padFrames, frames) };
      meta.loops = {};
      for (const codec of ["opus", "aac"]) {
        const dec = await decode(enc[codec]);
        const extra = dec.length / channels - (frames + 2 * padFrames);
        if (extra < 0) throw new Error(`audio: ${a.id}: the decoded ${codec} is ${-extra} samples short of the padded loop`);
        let best = padFrames, bestErr = Infinity;
        for (let s = padFrames >> 1; s <= padFrames + (padFrames >> 1); s++) {
          let err = 0;
          for (let c = 0; c < channels; c++) err = Math.max(err, Math.abs(dec[(s + frames) * channels + c] - dec[s * channels + c]));
          if (err < bestErr) [best, bestErr] = [s, err];
        }
        meta.loops[codec] = { loopStart: best / SR, loopEnd: (best + frames) / SR };
        meta.seam[codec] = seamStats(dec, channels, best, frames);
        meta.seam[`${codec}Extra`] = extra;
      }
    }
    const [opus, aac] = await Promise.all([fs.readFile(enc.opus), fs.readFile(enc.aac)]);
    if (opus.length < 1024 || aac.length < 1024) throw new Error(`ffmpeg produced an empty file for ${a.id}`);
    // into the cache, each file renamed into place whole: the encodes first, the metadata (which marks the entry
    // complete) last
    const place = async (data, dest) => {
      const t = `${dest}.tmp-${process.pid}-${crypto.randomUUID()}`;
      await fs.writeFile(t, data);
      await fs.rename(t, dest);
    };
    await place(opus, files.opus);
    await place(aac, files.aac);
    await place(JSON.stringify(meta), files.meta);
    return { opus, aac, meta };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** Runs `fn` over `items` with at most `n` at a time, keeping the results in order. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/**
 * The manifest gain of a "peak"/"lufs" cue. One-shots keep the table gain (their reference is the -2 dBTP peak
 * they all sit at). A loop's gain is corrected by where its constant gain landed against -18 LUFS (a spiky bed is
 * held back by the -2 dBTP cap): at most x2, and the result at most 1 so its peaks stay under full scale.
 */
const cueGain = (a, meta) => {
  if (!a.loop) return a.gain;
  const correction = Math.min(2, Math.max(0.5, 10 ** ((-18 - meta.lufs) / 20)));
  return +Math.min(1, a.gain * correction).toFixed(3);
};

export async function buildAudio({ emit, SRC }) {
  const file = (f) => path.join(SRC, "audio", f);
  const missing = [];
  for (const a of AUDIO)
    for (const f of [a.src, ...(a.layers ?? []).map((l) => l.src)])
      await fs.access(file(f)).catch(() => missing.push(`${f} (${a.id})`));
  if (missing.length) throw new Error(`audio: missing sources in assets-src/audio (run node tools/fetch-extra.mjs): ${missing.join(", ")}`);
  // encode in parallel (ffmpeg is single-threaded per file), emit in table order (stable manifest and log)
  const encoded = await pool(AUDIO, Math.max(2, Math.min(8, os.cpus().length)), async (a) => {
    const layerFiles = (a.layers ?? []).map((l) => file(l.src));
    if (a.norm === "peak" || a.norm === "lufs") return encodeConstant(file(a.src), a, layerFiles);
    const [opus, aac] = await Promise.all([encode(file(a.src), a, "opus", layerFiles), encode(file(a.src), a, "aac", layerFiles)]);
    return { opus, aac };
  });
  // The wrap of every padded loop, decoded from both codecs: no step larger than every other step in the loop.
  const clicks = [];
  for (const [k, a] of AUDIO.entries()) {
    const s = encoded[k].meta?.seam;
    if (!s) continue;
    const ch = (st) => st.map((c) => `${c.wrap.toFixed(4)}/${c.max.toFixed(4)}`).join(" ");
    const f = encoded[k].meta.fade;
    console.log(`  seam ${a.id.padEnd(26)} wrap/max step: pcm ${ch(s.pcm)}  opus ${ch(s.opus)}  aac ${ch(s.aac)}  mid-fade ${f.db >= 0 ? "+" : ""}${f.db} dB (p${f.pct})`);
    for (const codec of ["opus", "aac"]) if (s[codec].some((c) => c.wrap > c.max)) clicks.push(`${a.id} (${codec}: ${ch(s[codec])})`);
  }
  if (clicks.length) throw new Error(`audio: loops that click at the wrap (the step across it is the largest in the loop): ${clicks.join("; ")}`);
  // the levels, loop bounds and seams of the "peak"/"lufs" cues, for the design appendix and for debugging (not shipped)
  const report = AUDIO.flatMap((a, k) => {
    const m = encoded[k].meta;
    return m ? [{ id: a.id, norm: a.norm, dur: m.dur, gainDb: m.gainDb, lufs: m.lufs, tp: m.tp, gain: a.gain, manifestGain: a.gain === undefined ? undefined : cueGain(a, m), loops: m.loops, fade: m.fade, seam: m.seam }] : [];
  });
  await fs.writeFile(path.join(CACHE, "report.json"), JSON.stringify(report, null, 1));
  for (const [k, a] of AUDIO.entries()) {
    const { opus, aac, meta } = encoded[k];
    // Register the AAC variant as its own file, and the Opus file as the main entry.
    const aacEntry = await emit(a.id + "#aac", { segment: a.segment, priority: a.priority, type: "audio", ext: "m4a", data: aac });
    const e = await emit(a.id, {
      segment: a.segment,
      priority: a.priority,
      type: "audio",
      ext: "ogg",
      data: opus,
      pos: a.pos,
    });
    e.variants = {
      opus: { url: e.url, hash: e.hash, size: e.size },
      aac: { url: aacEntry.url, hash: aacEntry.hash, size: aacEntry.size },
    };
    e.loop = !!a.loop;
    if (meta?.loops) {
      // the Opus file's bounds at the top level; each variant carries its own (resolveManifest spreads the AAC one)
      Object.assign(e, meta.loops.opus);
      Object.assign(e.variants.opus, meta.loops.opus);
      Object.assign(e.variants.aac, meta.loops.aac);
    }
    if (a.gain !== undefined) e.gain = cueGain(a, meta);
  }
}
