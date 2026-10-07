// The keep chapter's sound cues (design §10.4, §10.5) behind one module: a cue plays when the build
// ships its audio id and is silently skipped otherwise, so a missing sound never stops a beat. The
// ids are the content pipeline's (`tools/gen/audio.mjs`); swap or add them here.
import { assets } from "../../core/assets/AssetClient";
import { audio } from "../../core/audio";

/** The keep's one-shots by what they are (audio ids). */
export const KEEP_CUES = {
  wings: "audio/wings",
  rockfall: "audio/sfx_rockfall",
  rumble: "audio/sfx_rumble",
  door: "audio/sfx_door_wood",
  doorHeavy: "audio/sfx_door_wood_2",
  lock: "audio/sfx_lock",
  gateSlam: "audio/sfx_gate_slam",
  beam: "audio/sfx_beam_crash",
  rope: "audio/sfx_rope_cut",
  chest: "audio/sfx_chest",
  pickup: "audio/sfx_pickup",
  draw: "audio/sfx_draw",
} as const;

export type KeepCue = keyof typeof KEEP_CUES;

type XYZ = { x: number; y: number; z: number };

/**
 * Play a cue (positional when `at` is given). `ref`: the distance it is heard at full volume (m).
 * Nothing happens when the build lacks the sound or audio is not running.
 */
export function cue(name: KeepCue, at?: XYZ | null, o: { volume?: number; rate?: number; ref?: number } = {}) {
  const id = KEEP_CUES[name];
  if (!assets.has(id)) return;
  void audio.playOneShot(id, o.volume ?? 1, at ? { x: at.x, y: at.y, z: at.z } : undefined, "sfx", o.rate ?? 1, o.ref ?? 4).catch(() => {});
}

/** A music track or bed id when the build ships it, else null. */
export function shipped(id: string): string | null {
  return assets.has(id) ? id : null;
}
