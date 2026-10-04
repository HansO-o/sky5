/**
 * The UE-mannequin-style skeleton (glTF joint names) the Universal Animation Library clips and the
 * Quaternius characters share, and the UAL clips' equipment timings. Joint axes, as exported: every
 * bone points along its local +Y; on the hands +Z is the handle axis of a held weapon.
 */

export type Side = "l" | "r";

const DIGITS = ["thumb", "index", "middle", "ring", "pinky"] as const;

/** The 15 finger joints of one hand (three per digit; the `_04_leaf` ends are not animated). */
export function fingerBones(side: Side): string[] {
  return DIGITS.flatMap((d) => [1, 2, 3].map((i) => `${d}_0${i}_${side}`));
}

export const HAND = { l: "hand_l", r: "hand_r" } as const;
export const SPINE_03 = "spine_03";

/** Where a held handle's centre sits in the hand's frame (m): between the closed fingers and the palm. */
export function gripCentre(side: Side): [number, number, number] {
  return [side === "r" ? -0.03 : 0.03, 0.095, 0];
}

/**
 * Draw and sheathe clips (UAL1 `Sword_Enter` / `Sword_Exit`, 1.3 s each). `at`: when the weapon
 * changes hands (clip seconds); `release`: when the body may go back to its locomotion.
 */
export const UAL_DRAW = { clip: "Sword_Enter", at: 0.72, length: 1.3, release: 1.05 } as const;
export const UAL_SHEATHE = { clip: "Sword_Exit", at: 0.47, length: 1.3, release: 0.95 } as const;

/** The armed hand's grip: the frame-0 finger pose of this clip (UAL2 `Sword_Idle`). */
export const UAL_GRIP_CLIP = "Sword_Idle";
