## Universal Animation Library: clip inventory, combat and interaction clip plan, weapon attachment

Every number below was measured from the GLB files with forward kinematics (FK) and frame-by-frame sampling, not from file names. Nothing under the project directory was modified.

**Sources (read-only):**
- `/home/user/northern-prologue/assets-src/chars/anim_full/UAL1.glb`: 127 clips.
- `/home/user/northern-prologue/assets-src/chars/anim_full/UAL2.glb`: 135 clips.
- Both are full sets from cdn.cinevva.com via `tools/fetch-extra.mjs`, made with Blender glTF I/O 4.3, 30 fps, LINEAR interpolation.
- Every clip has 195 channels (65 joints × translation/rotation/scale).
- The free packs `assets-src/chars/anim/UAL1_Standard.glb` and `UAL2_Standard.glb` have 43 clips each.
- License: CC0 (`assets-src/chars/anim/LICENSE.txt`), already credited as `quaternius-ual` in `tools/credits-extra.mjs`.

**Scripts I wrote, reusable:**
- `/tmp/claude-0/research/glb.mjs`: GLB parser plus FK.
- `ual.mjs`, `meta.mjs`, `grip.mjs`, `fist.mjs`, `fist2.mjs`, `traj.mjs`, `traj2.mjs`, `speed.mjs`, `stride.mjs`, `mid.mjs`, `chain.mjs`, `hits.mjs`, `block.mjs`, `rootrot.mjs`, `sheath.mjs`, `sum.mjs`.
- Full tables with exact durations and root/pelvis deltas: `/tmp/claude-0/research/ual1.tsv` and `ual2.tsv`.

### How to read the axes
- The `root` bone has a rest rotation of -90° about X (Z-up to Y-up). Its translation channel is in glTF model space.
- In model space, **+Z = the character's forward, +X = the character's left, +Y = up**. Characters face +Z.
- `[RM x,y,z]` below means the net root displacement over the clip.

### 1. Full inventory (name, duration in s truncated to 0.01, root motion)

**UAL1 (127):** A_TPose 2.50; BackFlip 1.93; Celebration 4.00; Climb_Down_Loop 1.27; Climb_Enter 1.47; Climb_Exit 1.47; Climb_Idle_Loop 2.93; Climb_Left_Loop 0.87; Climb_Left_RM_Loop 0.87 [RM +0.86 X]; Climb_Right_Loop 0.87; Climb_Right_RM_Loop 0.87 [RM -0.86 X]; Climb_Up_Loop 1.27; ClimbLedge 0.63; ClimbLedge_RM 0.63 [RM +2.47 Y]; Counter_Angry 2.00; Counter_Enter 1.17; Counter_Exit 1.17; Counter_Give 4.37; Counter_Idle_Loop 2.67; Counter_Show 4.67; Crawl_Bwd_Loop 2.50; Crawl_Enter 2.13; Crawl_Exit 2.00; Crawl_Fwd_Loop 2.17; Crawl_Idle_Loop 2.33; Crawl_Left_Loop 1.27; Crawl_Right_Loop 1.27; Crouch_Bwd_L_Loop 2.00; Crouch_Bwd_Loop 2.00; Crouch_Bwd_R_Loop 2.00; Crouch_Enter 0.83; Crouch_Exit 0.83; Crouch_Fwd_L_Loop 2.00; Crouch_Fwd_Loop 2.00; Crouch_Fwd_R_Loop 2.00; Crouch_Idle_Loop 2.93; Crouch_Left_Loop 2.00; Crouch_Right_Loop 2.00; Crying 4.83; Dance_Loop 1.00; Death01 2.40; Death02 2.47; Dodge_Left 1.30; Dodge_Left_RM 1.30 [RM +2.01 X]; Dodge_Right 1.30; Dodge_Right_RM 1.30 [RM -2.01 X]; Drink 3.00; Driving_Loop 1.67; Fixing_Kneeling 5.20; GroundSit_Enter 2.50; GroundSit_Exit 2.17; GroundSit_Idle_Loop 1.33; Hit_Chest 0.33; Hit_Head 0.43; Hit_Shoulder_L 0.53; Hit_Shoulder_R 0.50; Hit_Stomach 0.67; Idle_LookAround_Loop 4.60; Idle_Loop 2.50; Idle_Paper 3.13; Idle_Rock 3.13; Idle_Scissors 3.13; Idle_Talking_Loop 2.93; Idle_Tired_Loop 2.30; Idle_Torch_Loop 1.27; Interact 2.00; Jog_Bwd_L_Loop 0.93; Jog_Bwd_Loop 0.93; Jog_Bwd_R_Loop 0.93; Jog_Fwd_L_Loop 0.93; Jog_Fwd_LeanL_Loop 0.93; Jog_Fwd_LeanR_Loop 0.93; Jog_Fwd_Loop 0.93; Jog_Fwd_R_Loop 0.93; Jog_Left_Loop 0.93; Jog_Right_Loop 0.93; Jump_Land 1.27; Jump_Loop 2.50; Jump_Start 1.33; Kick 1.10; PickUp_Kneeling 1.93; PickUp_Table 0.83; Pistol_Aim_Down/Neutral/Up 0.17; Pistol_Idle_Loop 1.67; Pistol_Reload 1.67; Pistol_Shoot 0.63; Punch_Cross 1.00; Punch_Jab 0.87; PunchKick_Enter 0.67; PunchKick_Exit 0.67; Push_Enter 0.67; Push_Exit 1.20; Push_Loop 2.67; Roll 1.47; Roll_RM 1.47 [RM +4.99 Z]; Sitting_Enter 1.30; Sitting_Exit 1.03; Sitting_Idle02_Loop 2.50; Sitting_Idle03_Loop 4.17; Sitting_Idle_Loop 1.67; Sitting_Nodding_Loop 2.93; Sitting_Talking_Loop 2.93; Spell_Double_Enter 0.63; Spell_Double_Exit 0.63; Spell_Double_Idle_Loop 2.10; Spell_Double_Shoot_Loop 0.27; Spell_Simple_Enter 0.53; Spell_Simple_Exit 0.43; Spell_Simple_Idle_Loop 2.10; Spell_Simple_Shoot 0.50; Sprint_Enter 0.87; Sprint_Exit 1.67; Sprint_Loop 0.67; Swim_Fwd_Loop 1.33; Swim_Idle_Loop 3.33; Sword_Attack 1.53; Sword_Attack_RM 1.53 [RM +1.50 Z]; Sword_Attack_Standing 1.53; Sword_Enter 1.30; Sword_Exit 1.30; Sword_Idle 1.67; **Turn90_L 2.00 [root yaw +90°]**; **Turn90_R 2.00 [root yaw -90°]**; Walk_Formal_Loop 1.33; Walk_Loop 1.33.

**UAL2 (135):** A_TPose 2.50; Bandage_Loop 0.67; Bow_Aim_Down 1.33; Bow_Aim_Neutral 2.50; Bow_Aim_Up 1.33; Bow_Notch 2.50; Bow_RapidShoot_Loop 0.43; Bow_Shoot 0.67; Chest_Open 1.37; ClimbUp_1m_RM 0.67 [RM +1.00 Y, +1.68 Z]; ClimbUp_2m_RM 1.30 [RM +2.00 Y, +1.68 Z]; Consume 1.33; DoubleJump 0.90; Farm_Harvest 2.50; Farm_PickingTree 2.23; Farm_PlantSeed 2.77; Farm_ScatteringSeeds 1.57; Farm_Watering 3.80; Fish_Cast 1.83; Fish_Cast_Idle_Loop 2.33; Fish_OH_Idle_Loop 2.33; Fish_Reel 2.30; Fish_Reel_Failed 2.77; GetOffWall_2m_RM 0.63 [RM -0.45 Y, +1.46 Z; root starts at (0, 1.04, 0.87)]; Hit_Knockback 0.83; Hit_Knockback_RM 0.83 [RM -3.00 Z]; Idle_FoldArms_Loop 2.50; Idle_Lantern_Loop 2.50; Idle_No_Loop 2.50; Idle_Rail_Call 2.50; Idle_Rail_Loop 2.50; Idle_Shield_Break 1.07; Idle_Shield_Loop 2.50; Idle_TalkingPhone_Loop 2.93; IdleToLay 3.00; JogToFlip 1.20; KipUp 1.17; LayToIdle 1.53; LiftAir_Fall_Impact 0.67; LiftAir_Fall_Loop 1.30; LiftAir_Fall_RM 0.93 [RM -1.76 Y]; LiftAir_Hit_L 0.50; LiftAir_Hit_R 0.50; LiftAir_Idle_Loop 2.00; LiftAir_RM 0.47 [RM +1.76 Y]; Melee_Combo 2.27; Melee_Hook 0.47; Melee_Hook_Rec 0.60; Melee_Knee 0.87; Melee_Knee_Rec 0.23; Melee_Uppercut 1.07; Mining_Loop 0.90; MonsterTransformation 2.23; NinjaJump_Double 0.90; NinjaJump_Idle_Loop 2.00; NinjaJump_Land 1.27; NinjaJump_Start 0.97; OverhandThrow 1.33; SafetyVault_RM 0.73 [RM +2.90 Z]; Shield_Dash_RM 1.10 [RM +1.00 Z]; Shield_OneShot 0.83; Slide_Exit 0.50; Slide_Loop 2.00; Slide_Start 0.83; Sprint_Shield_Loop 0.67; StepUp_RM 0.67 [RM +0.50 Y, +2.18 Z]; Surprise 2.47; Sword_Aerial_A 0.40; Sword_Aerial_A_Rec 0.43; Sword_Aerial_B 0.57; Sword_Aerial_Combo_Loop 1.00; Sword_Aerial_Idle_Loop 1.07 (all Aerial clips hold root y = 1.76); Sword_Block 1.23 (constant root z -0.08); Sword_Dash_RM 1.57 [+3.69 Z]; Sword_GroundPound_RM 1.17 [-2.00 Y]; Sword_Heavy_A 0.73 [+1.39 Z]; Sword_Heavy_A_Rec 1.00 [+0.34 Z]; Sword_Heavy_B 0.50 [+0.75 Z]; Sword_Heavy_B_Rec 0.77 [+0.12 Z]; Sword_Heavy_C 0.70 [+1.71 Z]; Sword_Heavy_C_Rec 0.57 (constant root z 3.84); Sword_Heavy_Combo 4.33 [+5.32 Z]; Sword_Heavy_D 2.33 [+1.41 Z]; Sword_Light_A 0.37 [+0.31 Z]; Sword_Light_A_Rec 0.50; Sword_Light_B 0.43 [+0.36 Z]; Sword_Light_B_Rec 0.57; Sword_Light_C 0.87 [+1.42 Z]; Sword_Light_Combo 3.40 [+3.79 Z]; Sword_Light_D 1.67 [+1.70 Z]; Sword_Regular_A 0.43 [+0.82 Z]; Sword_Regular_A_Rec 0.97 [+0.31 Z]; Sword_Regular_B 0.53 [-0.05 Z]; Sword_Regular_B_Rec 1.03 [+0.37 Z]; Sword_Regular_C 2.00 [+1.56 Z]; Sword_Regular_Combo 3.00 [+2.34 Z]; Sword_UpperCut_RM 0.70 [+2.00 Y]; SwordLight_C_Rec 0.70 (note the spelling); TreeChopping_Loop 0.97; Turn180_L_RM / Turn180_R_RM 1.67 [root yaw ±180°]; Walk_Bwd_L_Loop / Walk_Bwd_Loop / Walk_Bwd_R_Loop / Walk_Carry_Loop(2.00) / Walk_Fwd_L / Walk_Fwd_Loop / Walk_Fwd_R_Loop / Walk_L_Loop / Walk_R_Loop 1.33; WallRun_Jump_L/R, WallRun_L/R_Loop 0.73; Yes 2.50; Zombie_Bite 1.50; Zombie_Idle_Loop 1.33; Zombie_Run_{Fwd,Bwd,L,R,Fwd_L,Fwd_R,Bwd_L,Bwd_R}_Loop 0.73; Zombie_Scratch 1.80; Zombie_Spawn 2.83; Zombie_Walk_{Fwd,Bwd,L,R,Fwd_L,Fwd_R,Bwd_L,Bwd_R}_Loop 1.33.

**Root-motion problem.** The UAL2 `Sword_*` segments are cut from the baked combos and keep **absolute** root offsets. Their starting root z values are:
- Light_B 0.25, Light_C 0.62, Light_D 2.02
- Regular_A_Rec 0.76, Regular_B 0.75, Regular_B_Rec 0.70, Regular_C 0.72
- Heavy_B 1.31, Heavy_C 2.13, Heavy_C_Rec / Heavy_D 3.84
- The A segments and the combos start at -0.07 / -0.08.

`characters.mjs` keeps root translation and `Character.play` applies it unchanged. Shipping these clips as-is would teleport the mesh up to 3.84 m away from its controller. They must be rebased to their first key and extracted (see recommendations).

### 2. What currently ships (KEEP_CLIPS)
- `tools/gen/characters.mjs` ships 50 unique clips: KEEP_CLIPS lists 33 entries (`Walk_Formal_Loop` twice) and KEEP_CLIPS_2 lists 18.
- Shipped: 99.5 s of animation in `public/data/e6f80c72432c9fd9.glb`, 1.58 MB raw / 683 KB brotli. That is about **15.9 KB raw / 6.9 KB brotli per second of clip**.
- Each clip keeps root translation+rotation, pelvis translation+rotation, and 63 bone rotations.
- The file also carries **63 orphan duplicate joints** left over from the UAL2 merge. They are harmless and not animated.
- 16 of the shipped clips exist **only** in the full files: Death02, Crying, GroundSit_Idle_Loop, PickUp_Kneeling, Idle_LookAround_Loop, Idle_Tired_Loop, Hit_Stomach, Turn90_L/R, IdleToLay, Bow_Notch, Bow_Aim_Neutral, Bow_Shoot, Surprise, KipUp, LiftAir_Fall_Impact.

### 3. Measured properties that drive the design

**Fist pose.** The right-hand finger rotations of Sword_Idle frame 0 are **identical (0° difference)** in Idle_Loop, Walk_Loop, Walk_Fwd_Loop, Walk_L_Loop, Jog_Fwd_Loop, Jog_Left_Loop, Sprint_Loop, Interact, Idle_Torch_Loop, Idle_Shield_Loop and every Sword_* attack. So a weapon held through ordinary locomotion looks right.

These clips open the hand, so a held weapon needs a finger override:
- Crouch_* (83°), Dodge_* (73°), Roll (up to 98°), Jump_* (about 90°), Death01/02 (up to 90°)
- Hit_Knockback (64°), OverhandThrow (80°), Sword_Enter/Exit (79°, intentional)
- Climb*, Crawl*, Push*, Spell*, Zombie*

**Stance chains.** Pose continuity between clips:
- UAL2 Sword_Light/Regular/Heavy A, the combos, the _Rec ends, Shield_OneShot, Hit_* ends and Death starts all match the **plain Idle_Loop pose** (0–5°). They do **not** match Sword_Idle, which is 56° away.
- UAL1 Sword_Attack starts and ends in the Sword_Idle pose (5°).
- Sword_Enter goes from Idle_Loop (1°) to the Sword_Attack_Standing start pose (0°), which is 17° from Sword_Idle. Sword_Exit is its exact time reverse.

Chains with end-to-start error:
- Light: A → B (11°) → C (10°); every piece has an `_Rec` exit back to Idle (0°).
- Regular: A → B (13°) → C (14°); C ends 21° from Idle.
- Heavy: A → B (8°) → C (22°) → C_Rec (0°) or D (0°); D ends 44° from Idle, so blend it.
- Hit_Chest/Head/Stomach/Shoulder_* all end at 1° from Idle_Loop and start 14–49° away.
- Dodge and Roll start 103–114° from Idle (blend into them) and end about 11° from Idle.

**Hit windows.** Measured as sword-tip speed above 50% of peak, with a 0.85 m blade on the grip axis. Swings are snappy (tip peaks of 47–88 m/s), so use swept or segment collision checks, not per-frame point tests.

| Clip | Duration (s) | Hit window (s) |
|---|---|---|
| Sword_Attack (UAL1, in-place) | 1.533 | 0.37–0.47 |
| Sword_Attack_Standing | 1.533 | 0.37–0.47 |
| Light_A | 0.367 | 0.13–0.30 |
| Light_B | 0.433 | 0.20–0.27 |
| Light_C | 0.867 | 0.42–0.50 |
| Light_D | 1.667 | 0.20–0.33 |
| Regular_A | 0.433 | 0.20–0.30 |
| Regular_B | 0.533 | 0.20–0.30 |
| Regular_C | 2.000 | 0.60–0.67 |
| Heavy_A | 0.733 | 0.43–0.53 |
| Heavy_B | 0.500 | 0.35–0.43 |
| Heavy_C | 0.700 | 0.45–0.60 |
| Heavy_D | 2.333 | 0.60–0.63 |
| Sword_Dash_RM | 1.567 | 0.27–0.37 |
| OverhandThrow | 1.333 | 0.33–0.43 |
| Zombie_Scratch | 1.800 | 0.52–0.67 |
| Zombie_Bite | 1.500 | 0.33–0.43 |

**Block clips.**
- Sword_Block 1.233 s: raise 0–0.17 s, **hold still 0.27–0.57 s**, lower 0.60–1.23 s. In the hold, the right hand is about 0.45 m forward, the left hand is back, and the pelvis drops to 0.66 m. To hold the guard, freeze at about 0.40 s.
- Shield_OneShot 0.833 s: quick shield raise from Idle_Loop; the left hand comes up to chest height (1.26 m) by 0.17 s, holds about 0.17–0.5 s, then lowers.
- Idle_Shield_Loop 2.5 s: static shield guard.
- Idle_Shield_Break 1.067 s: the shield is knocked out to the left at 0.1–0.2 s and the guard recovers by about 0.67 s. It starts and ends in the Idle_Shield_Loop pose, so it is the natural **shield block-hit / guard-break**.
- There is no sword-only block-impact clip.

**Knockdown.** Hit_Knockback (in place, already used in `execution.ts`) ends **lying flat** (pelvis about 0.06 m). Stand back up with LayToIdle 1.533 or KipUp 1.167.

**Deaths.**
- Death01 falls backward, moving the pelvis 0.46 m.
- Death02 falls forward, moving the pelvis 0.97 m.
- Other death-like endings: Hit_Knockback (flat on the back), IdleToLay 3.0 (slow collapse), LiftAir_Fall_Impact 0.667, plus the existing Jolt ragdoll.

**Draw/sheathe (Sword_Enter / Sword_Exit, no root motion).** This is a **back / over-the-right-shoulder draw**, not a hip draw:
- The hand reaches about (-0.07, 1.61, -0.17) in character space, behind the neck, at 0.6–0.8 s.
- Sword_Enter: fingers open from 0.10 s, peak open 0.50–0.57 s, fully closed again at **0.80 s**. Attach the weapon to the hand at about 0.70–0.77 s.
- Sword_Exit: fingers start opening at 0.43 s. Release the weapon to the back at about 0.45–0.50 s.
- There is no hip-draw clip.

**Lever / interact / loot hand paths** (character space):
- Farm_PickingTree 2.233 s: the right hand reaches to about (-0.07, 1.66, 0.33), head-high and 0.3 m forward, at 0.56–1.12 s, then **pulls down** to about 1.0 m by 1.68 s. This is the best wall-lever pull.
- Interact 2.0 s: left hand forward to about 1.3 m height, 0.5 m forward, held 0.6–1.0 s (a press or touch).
- Chest_Open 1.367 s: left hand to 0.69 m height at 0.51 s, then lifts to about 0.96 m (lifting a lid).
- PickUp_Table 0.833 s: left-hand grab at about 0.86 m height, 0.46 m forward, at 0.21 s.
- PickUp_Kneeling 1.933 s: kneel (pelvis 0.41 m); the right hand reaches the ground about 0.55 m forward at 0.72 s.
- Fixing_Kneeling 5.2 s: kneel by 0.65 s, two-handed work at about 0.35 m height and 0.5 m forward from 0.65–3.9 s (loopable middle), stand up 3.9–5.2 s.
- Bandage_Loop 0.667 s: both hands together at chest height (1.0–1.1 m), 0.25–0.3 m forward. Use it for the companion cutting the bonds or the player rubbing their wrists.
- Push_Enter / Loop / Exit (0.667 / 2.667 / 1.2 s): both hands at 1.17 m, 0.58 m forward, leaning with the pelvis at 0.72 m. Use it for heavy doors, gates and carts.

**Climbing.**
- Climb_Up_Loop and Climb_Down_Loop (1.267 s each) are **in place**. The gripping hand moves 0.58 m per half cycle, so script the vertical speed at about **0.9 m/s × speedRatio**.
- In those loops the hands are 1.29–1.88 m high, the feet 0.11–0.62 m, and the wall is about 0.32 m in front of the root.
- Climb_Enter 1.467 s goes from standing to the climb pose. Climb_Exit 1.467 s goes from the climb pose to standing at the bottom, facing the wall. Neither has root motion.
- ClimbLedge_RM is a 2.47 m upward leap, not a ledge mantle.
- GetOffWall_2m_RM hops forward 1.46 m off a ledge about 2.1 m high. It starts with the root at (0, 1.04, 0.87) and **ends in mid-air** about 0.8 m up, so chain LiftAir_Fall_Impact or Jump_Land after it.

**Native locomotion speeds** (median mid-stance foot speed, ±20%):

| Clip | Speed (m/s) |
|---|---|
| Walk_Loop / Walk_Fwd_Loop / Walk_Formal_Loop | about 0.95 |
| Walk_Bwd_Loop | about 1.0–1.2 |
| Walk_L_Loop / Walk_R_Loop | about 0.4–0.6 |
| Jog_Left_Loop | about 1.8–2.2 |
| Jog_Fwd_Loop | about 3.6 (estimates 3.6–6) |
| Sprint_Loop | about 6 |
| Crouch_Fwd_Loop / Crouch_Bwd_Loop | about 0.5–0.7 |
| Crouch_Left/Right_Loop | about 0.45 |
| Crawl_Fwd_Loop | about 0.3 |
| Zombie_Walk_Fwd_Loop | about 0.95 |
| Zombie_Run_Fwd_Loop | about 3.9 |
| Walk_Carry_Loop | about 0.6 |

`src/prologue/player.ts` normalizes Walk_Loop at 1.6 m/s and crouch at 1.3 m/s, which roughly doubles the native speeds, so feet slide.

### 4. Skeleton bones for attaching weapons and props
- All 65 joints:
  - Body: root, pelvis, spine_01, spine_02, spine_03, neck_01, Head
  - Arms: clavicle_l/r, upperarm_l/r, lowerarm_l/r, hand_l/r
  - Fingers: thumb/index/middle/ring/pinky _01/_02/_03/_04_leaf for _l and _r
  - Legs: thigh_l/r, calf_l/r, foot_l/r, ball_l/r, ball_leaf_l/r
- **There are no weapon, prop, IK or twist bones.** Attach to `hand_r` / `hand_l` (`Character.bone()` returns the glTF joint TransformNode; `execution.ts` already parents the axe this way).
  - Back sheath / quiver / shield on the back: `spine_03`.
  - Hip: `pelvis` or `thigh_l`.
  - Helmet: `Head` (note that Head is scaled by appearance).

**Hand bone local frame** (same convention on both sides, palm side mirrored):
- **+Y** = wrist toward knuckles (the bone axis; a sword's true edge faces this way).
- Fingers curl toward **-X** on the right hand and **+X** on the left (the palm normal).
- **+Z** = from pinky to index/thumb, which is the axis of the hole through the fist.
- Rest offsets in hand_r space: index_01 (-0.002, 0.120, 0.031), pinky_01 (-0.002, 0.108, -0.041), closed-fist middle fingertip (-0.028, 0.079, 0.007).

**Grip:**
- Grip centre ≈ **(-0.03, 0.095, 0.00)** in hand_r space and **(+0.03, 0.095, 0.00)** in hand_l space.
- Handle axis = normalize(-0.006, 0.168, 0.986), essentially +Z. The weapon's tip or head points toward +Z.
- This was checked against real poses:
  - Idle_Shield_Loop: the left-hand axis is vertical in world space, (-0.15, 0.99, 0.04).
  - Bow_Aim_Neutral: the left-hand axis is vertical, (-0.04, 0.98, 0.18).
  - Sword_Block: the blade is raised diagonally across the body.

**Orientation recipes** (Babylon `rotationQuaternion`, x, y, z, w; right-handed scene, no handedness conversion):
- Model with the handle along +Y and the edge along +X → **(0.5, 0.5, 0.5, 0.5)**.
- `ph/wooden_axe_03` (handle +Y from -0.224 to 0.408, bit toward +Z, thickness along X) → **(0, 0.7071, 0.7071, 0)**. To grip about 10 cm from the butt at scale 1.25, use position ≈ (-0.03, 0.095, 0.15) on hand_r.
- Kite shield (face in the model's XY plane): map model +Y to hand +Z and the outward face to hand -X → (0.5, -0.5, -0.5, 0.5). Flip 180° about hand Z if the face turns out to be on the other side. Tune the offset visually.

**Back-sheath handoff** (Sword_Enter at t = 0.70 s; Sword_Exit is the time reverse, so the same frame works for sheathing):
- In `spine_03` local space: grip centre (-0.138, 0.347, -0.216), blade direction (0.559, -0.827, -0.062), edge (0.840, 0.393, -0.374), and hand_r rotation relative to spine_03 = (0.260, 0.659, -0.486, 0.512).
- The sheathed sword sits diagonally, hilt above the right shoulder and blade toward the left hip.
- At the swap frame, re-parent with `setParent()`, which keeps the world transform.

### 5. Recommended clips to add to KEEP_CLIPS_2 / KEEP_CLIPS
All names were verified to exist; durations are exact.

**Melee core** (31 clips, 29.3 s ≈ 197 KB brotli):
- Draw/sheathe: Sword_Enter 1.300, Sword_Exit 1.300
- Light: Sword_Light_A 0.367 (RM), Sword_Light_A_Rec 0.500, Sword_Light_B 0.433 (RM), Sword_Light_B_Rec 0.567, Sword_Light_C 0.867 (RM), SwordLight_C_Rec 0.700
- Regular: Sword_Regular_A 0.433 (RM), _A_Rec 0.967 (RM), _B 0.533 (RM), _B_Rec 1.033 (RM), _C 2.000 (RM)
- Heavy: Sword_Heavy_A 0.733 (RM), _A_Rec 1.000 (RM), _B 0.500 (RM), _B_Rec 0.767 (RM)
- Simple in-place attack: Sword_Attack 1.533 (UAL1, no RM)
- Shield and hits: Shield_OneShot 0.833, Idle_Shield_Break 1.067, Hit_Shoulder_L 0.533, Hit_Shoulder_R 0.500
- Evasion (all no RM): Dodge_Left 1.300, Dodge_Right 1.300, Roll 1.467
- Strafes (all no RM): Walk_L_Loop, Walk_R_Loop, Walk_Bwd_Loop 1.333 each; Jog_Left_Loop, Jog_Right_Loop, Jog_Bwd_Loop 0.933 each

**Sneak** (5 clips, 51 KB): Crouch_Enter 0.833, Crouch_Exit 0.833, Crouch_Bwd_Loop 2.0, Crouch_Left_Loop 2.0, Crouch_Right_Loop 2.0.

**Climb down** (6 clips, 61 KB): Climb_Enter 1.467, Climb_Idle_Loop 2.933, Climb_Down_Loop 1.267, Climb_Up_Loop 1.267, Climb_Exit 1.467, GetOffWall_2m_RM 0.633 (RM).

**Interact** (8 clips, 74 KB): Chest_Open 1.367, PickUp_Table 0.833, Bandage_Loop 0.667, Farm_PickingTree 2.233, Push_Enter 0.667, Push_Loop 2.667, Push_Exit 1.200, Consume 1.333.

**Enemies and companions** (12 clips, 87 KB): Bow_Aim_Up 1.333, Bow_Aim_Down 1.333, Spell_Simple_Enter 0.533, Spell_Simple_Shoot 0.500, Spell_Simple_Exit 0.433, Sword_Dash_RM 1.567 (RM 3.69 m), Shield_Dash_RM 1.100 (RM 1.0 m), Sprint_Shield_Loop 0.667, Idle_Lantern_Loop 2.5, Punch_Jab 0.867, Punch_Cross 1.0, Kick 1.1.

**Required total ≈ 70 s ≈ 470 KB brotli.**

**Optional** (38 clips, about 374 KB):
- More sword: Sword_Light_D, Sword_Heavy_C, Sword_Heavy_C_Rec, Sword_Heavy_D, Sword_Attack_Standing
- Crouch diagonals; Crawl_Enter / Idle_Loop / Fwd_Loop / Exit
- Bow_RapidShoot_Loop; Spell_Double_*
- Undead: Zombie_Spawn, Zombie_Idle_Loop, Zombie_Walk_Fwd_Loop, Zombie_Run_Fwd_Loop, Zombie_Scratch, Zombie_Bite
- Turn180_L_RM / Turn180_R_RM; Melee_Hook / Melee_Hook_Rec / Melee_Uppercut
- Root-motion twins (Hit_Knockback_RM, Roll_RM, Dodge_*_RM); Drink; diagonal walks

**Already shipped and reusable:** Sword_Idle, Sword_Block, Idle_Shield_Loop, Hit_Chest, Hit_Head, Hit_Stomach, Hit_Knockback, LayToIdle, KipUp, Death01, Death02, IdleToLay, LiftAir_Fall_Impact, Crouch_Idle_Loop, Crouch_Fwd_Loop, Fixing_Kneeling, PickUp_Kneeling, Interact, Bow_Notch, Bow_Aim_Neutral, Bow_Shoot, Spell_Simple_Idle_Loop, OverhandThrow, Idle_Torch_Loop, Idle_Talking_Loop, Idle_FoldArms_Loop, Yes, Idle_No_Loop, Surprise, Turn90_L/R.

**Gaps (no clip exists):** lever pull (use Farm_PickingTree), sword-only block impact (replay the Sword_Block raise segment 0.10–0.40 s), backstep dodge (use a burst of Jog_Bwd_Loop), hip draw, and any animal animation (bear, wolf, spider are not in UAL).

### 6. Pipeline and runtime changes this implies
1. **Root motion in `characters.mjs`.** For every clip whose root translation track is non-constant or non-zero, plus Turn90/Turn180:
   - Rebase the track to its first key.
   - Write the per-key curve (t, x, y, z, yaw) to a JSON sidecar, for example `chars/anim_rootmotion`.
   - Set the glTF root translation to 0 and root rotation to rest (-0.7071, 0, 0, 0.7071).
   - At runtime, apply the curve delta (rotated by the character's yaw) to the CharacterVirtual or the NPC root, optionally scaled.
2. **Fail loudly on missing clips.** Assert that every KEEP_CLIPS name was found, so the Standard-pack fallback cannot silently drop clips.
3. **Clean up the merge.** After retargeting UAL2 channels, dispose the copied UAL2 nodes to remove the 63 orphans.
4. **Stream combat clips separately.** Emit them as `chars/anim_combat` in a later segment and add `CharacterFactory.addClips(container)`; today the clip map is built only in the constructor.
5. **Finger override.** When a weapon is held, copy the Sword_Idle frame-0 local rotations of the 15 weapon-hand finger joints (thumb, index, middle, ring, pinky _01–_03) in `postAnimate`. Skip this during the Sword_Enter/Exit grab window.
6. **Upper-body masking** for attacking while moving: clone groups restricted to spine_01 and its children.

## Recommendations
- Clip inventory source (all UAL1/UAL2 names, durations, root motion): Full UAL1.glb (127 clips) + UAL2.glb (135 clips); 30 fps LINEAR; same 65-joint skeleton as the characters | /home/user/northern-prologue/assets-src/chars/anim_full/UAL1.glb, UAL2.glb (fetched from https://cdn.cinevva.com/rt/clips/1/UAL{1,2}.glb by tools/fetch-extra.mjs). Full tables: /tmp/claude-0/research/ual1.tsv, ual2.tsv | CC0 1.0 (Quaternius; already credited as quaternius-ual in tools/credits-extra.mjs) | verified=True | Already on disk. Re-run /tmp/claude-0/research/ual.mjs <glb> to dump names, durations and root deltas; glb.mjs has the FK helper.
- Melee light/regular/heavy attacks (sword or one-handed axe): Sword_Light_A 0.367 (hit 0.13-0.30) / Light_A_Rec 0.500 / Light_B 0.433 (0.20-0.27) / Light_B_Rec 0.567 / Light_C 0.867 (0.42-0.50) / SwordLight_C_Rec 0.700; Sword_Regular_A 0.433 (0.20-0.30) / A_Rec 0.967 / B 0.533 (0.20-0.30) / B_Rec 1.033 / C 2.000 (0.60-0.67); Sword_Heavy_A 0.733 (0.43-0.53) / A_Rec 1.000 / B 0.500 (0.35-0.43) / B_Rec 0.767; simple in-place Sword_Attack 1.533 (hit 0.37-0.47, Sword_Idle stance). All UAL2 Sword_* have ROOT MOTION (0.3-1.7 m forward) with absolute start offsets up to 3.84 m; start/end pose = Idle_Loop; chains A→B→C(→D), each piece with an _Rec exit back to idle | UAL2.glb (Sword_Light/Regular/Heavy_*), UAL1.glb (Sword_Attack) | CC0 1.0 | verified=True | Add the names to KEEP_CLIPS_2 / KEEP_CLIPS in tools/gen/characters.mjs; rebase the root translation to the first key and extract it to a root-motion sidecar before shipping
- Draw / sheathe weapon: Sword_Enter 1.300 and Sword_Exit 1.300 (exact time reverse), no root motion. Back draw over the right shoulder; grab the hilt at Enter t≈0.70-0.77 s (fist closed at 0.80 s); release at Exit t≈0.45-0.50 s. Sheathed transform in spine_03 local: grip (-0.138, 0.347, -0.216), blade dir (0.559, -0.827, -0.062), hand_r rotation relative to spine_03 (0.260, 0.659, -0.486, 0.512) | UAL1.glb | CC0 1.0 | verified=True | Add to KEEP_CLIPS; at the swap frame setParent() the weapon between hand_r and spine_03
- Block and block-hit: Sword_Block 1.233 (already shipped; raise 0-0.17, hold 0.27-0.57, so freeze at ≈0.40 s to hold; constant root z -0.08). Shield: Idle_Shield_Loop (shipped, held guard), Shield_OneShot 0.833 (quick raise from idle), Idle_Shield_Break 1.067 (block-hit / guard break, starts and ends in the Idle_Shield_Loop pose). No sword-only impact clip: replay the Sword_Block 0.10-0.40 s segment | UAL2.glb | CC0 1.0 | verified=True | Add Shield_OneShot and Idle_Shield_Break to KEEP_CLIPS_2
- Hit reactions, stagger, knockdown: Hit_Chest 0.333, Hit_Head 0.433, Hit_Stomach 0.667 (shipped) + Hit_Shoulder_L 0.533, Hit_Shoulder_R 0.500 (new); all end in the Idle_Loop pose (1° off). Stagger: Idle_Shield_Break 1.067. Knockdown: Hit_Knockback 0.833 (in place, ends lying flat) → LayToIdle 1.533 / KipUp 1.167 (shipped). Hit_Knockback_RM moves the body 3 m back | UAL1.glb / UAL2.glb | CC0 1.0 | verified=True | Add Hit_Shoulder_L and Hit_Shoulder_R to KEEP_CLIPS
- Dodge / roll: Dodge_Left 1.300, Dodge_Right 1.300, Roll 1.467: in-place versions, so drive the controller yourself. The _RM twins move 2.01 m sideways (+X = left) and 4.99 m forward. No backstep clip exists. Blend in over ≥0.15 s (start pose is 103-114° from idle); they end ≈11° from idle | UAL1.glb | CC0 1.0 | verified=True | Add Dodge_Left, Dodge_Right and Roll to KEEP_CLIPS
- Death variants: Death01 2.400 (falls backward, pelvis moves 0.46 m), Death02 2.467 (falls forward, 0.97 m), Hit_Knockback 0.833 (flat on back), IdleToLay 3.0 (slow collapse), LiftAir_Fall_Impact 0.667 (fall from height); all already shipped. Plus the Jolt ragdoll | UAL1.glb / UAL2.glb | CC0 1.0 | verified=True | Already in KEEP_CLIPS / KEEP_CLIPS_2
- Sneaking: Crouch_Idle_Loop and Crouch_Fwd_Loop (shipped) + Crouch_Enter 0.833 / Crouch_Exit 0.833 (pelvis drops 0.41 m), Crouch_Bwd_Loop 2.0, Crouch_Left_Loop 2.0, Crouch_Right_Loop 2.0. Optional: diagonals (2.0 s each) and Crawl_Enter/Idle_Loop/Fwd_Loop/Exit. Native speed ≈0.5-0.7 m/s forward, ≈0.45 m/s sideways. These open the hand, so a held weapon needs the finger override | UAL1.glb | CC0 1.0 | verified=True | Add to KEEP_CLIPS
- Climbing down: Climb_Enter 1.467 → Climb_Idle_Loop 2.933 / Climb_Down_Loop 1.267 (in place; script ≈0.9 m/s descent; wall ≈0.32 m in front of root; hands 1.29-1.88 m) → Climb_Exit 1.467 (standing at the bottom facing the wall). Ledge drop: GetOffWall_2m_RM 0.633 (root starts at (0, 1.04, 0.87), 1.46 m forward, ends mid-air) + LiftAir_Fall_Impact / Jump_Land. Climb_Up_Loop 1.267 for symmetry | UAL1.glb (Climb_*), UAL2.glb (GetOffWall_2m_RM) | CC0 1.0 | verified=True | Add to KEEP_CLIPS / KEEP_CLIPS_2; extract root motion from GetOffWall_2m_RM
- Kneel to free hands (cut bonds): Player: Fixing_Kneeling 5.2 (shipped; kneel by 0.65 s, loopable two-hand segment 0.65-3.9 s at ≈0.35 m height, rise 3.9-5.2) or PickUp_Kneeling 1.933. Companion cutting the bonds at chest height: Bandage_Loop 0.667 (both hands at 1.0-1.1 m, 0.25-0.3 m forward); also usable as the player rubbing their wrists | UAL1.glb / UAL2.glb | CC0 1.0 | verified=True | Add Bandage_Loop to KEEP_CLIPS_2
- Looting: Chest_Open 1.367 (left hand lifts a lid from 0.69 to 0.96 m), PickUp_Table 0.833 (grab at ≈0.86 m, 0.46 m forward, at 0.21 s), PickUp_Kneeling 1.933 (ground or body; hand touches ≈0.55 m forward at 0.72 s), Fixing_Kneeling (search a body), Interact 2.0, Consume 1.333 (potion) | UAL1.glb / UAL2.glb | CC0 1.0 | verified=True | Add Chest_Open, PickUp_Table and Consume to KEEP_CLIPS / KEEP_CLIPS_2
- Pull a lever / open heavy door: No lever clip exists. Farm_PickingTree 2.233: right hand reaches head-high (≈1.65 m, 0.3 m forward) at 0.56-1.12 s, then pulls down to ≈1.0 m by 1.68 s; animate the lever handle in sync. Heavy door or gate: Push_Enter 0.667 / Push_Loop 2.667 / Push_Exit 1.2. Button: Interact 2.0 (left hand at 1.3 m, 0.5 m forward, held 0.6-1.0 s) | UAL2.glb (Farm_PickingTree), UAL1.glb (Push_*, Interact) | CC0 1.0 | verified=True | Add to KEEP_CLIPS / KEEP_CLIPS_2; place the lever handle about 0.3-0.35 m in front of the character root at 1.6 m height
- Enemies / companions: Soldiers: Idle_Shield_Loop, Sprint_Shield_Loop 0.667, Walk/Jog strafes, Sword_Regular_*, Shield_OneShot, Idle_Shield_Break, Sword_Dash_RM 1.567 (3.69 m lunge, hit 0.27-0.37), Shield_Dash_RM 1.1 (1 m bash). Archers: Bow_Notch / Bow_Aim_Neutral / Bow_Shoot (shipped) + Bow_Aim_Up 1.333, Bow_Aim_Down 1.333, optional Bow_RapidShoot_Loop 0.433. Mage: Spell_Simple_Enter 0.533 / Idle_Loop (shipped) / Shoot 0.5 / Exit 0.433, optional Spell_Double_*. Brawler: Punch_Jab 0.867, Punch_Cross 1.0, Kick 1.1, Melee_*. Optional undead: Zombie_Spawn 2.833, Zombie_Idle_Loop, Zombie_Walk_Fwd_Loop (≈0.95 m/s), Zombie_Run_Fwd_Loop (≈3.9 m/s), Zombie_Scratch 1.8, Zombie_Bite 1.5. Companion: Idle_Lantern_Loop 2.5 + shipped idles. Animals: none in UAL | UAL1.glb / UAL2.glb | CC0 1.0 | verified=True | Add to KEEP_CLIPS_2; animals need a separate CC0/CC-BY pack
- Weapon attachment to hand bones: No weapon or prop bones; parent to Character.bone('hand_r' | 'hand_l') (a joint TransformNode). Hand-local grip centre ≈ (∓0.03, 0.095, 0); handle axis +Z (pinky→index); true edge +Y; palm normal -X (right) / +X (left). Model with handle +Y and edge +X → rotationQuaternion (0.5, 0.5, 0.5, 0.5). ph/wooden_axe_03 → (0, 0.7071, 0.7071, 0) with position ≈ (-0.03, 0.095, 0.15) at scale 1.25. Kite shield on hand_l → (0.5, -0.5, -0.5, 0.5), flipped about Z if it faces inward. Back sheath: spine_03. Armed fist: copy the Sword_Idle frame-0 rotations of 15 finger joints in postAnimate when a clip opens the hand | FK of UAL1/UAL2 poses (Sword_Idle, Sword_Block, Idle_Shield_Loop, Bow_Aim_Neutral, Idle_Torch_Loop); models in assets-src/models/wooden_axe_03 and kite_shield | CC0 1.0 (UAL); Poly Haven CC0 (props) | verified=True | Runtime code only; no new assets
- Build-pipeline support for the new clips: In tools/gen/characters.mjs: (1) rebase and extract root translation and yaw for RM clips and Turn90/180 into a JSON sidecar, then zero the root channels; (2) assert that every KEEP name was found (the Standard fallback is missing 16 shipped clips, and names differ: ClimbUp_1m / Shield_Dash / Sword_Dash vs *_RM); (3) dispose the 63 orphan UAL2 joint copies; (4) emit combat clips as a separate later-segment asset and add CharacterFactory.addClips() | tools/gen/characters.mjs, src/world/characters.ts, src/prologue/World.ts | n/a | verified=True | Code change by the implementer (not done here per the rules)

## Risks
- Root-motion teleport: UAL2 Sword_* segments keep absolute root offsets (start z up to 3.84 m for Sword_Heavy_C_Rec / Sword_Heavy_D), and Character.play applies root translation unchanged. Shipped as-is, the mesh would jump away from its controller. Rebase and extract at build time.
- Existing minor bug: the already-shipped Sword_Block holds a constant root z offset of -0.08 m, so the mesh shifts 8 cm backward while it plays.
- Turn90_L / Turn90_R (shipped, currently unused) rotate the root bone ±90° inside the clip. Playing them spins the mesh, which then snaps back on loop or stop. The same applies to Turn180_*_RM.
- Existing likely bug: execution.ts attachAxe uses rotation (0, 0, π/2), which maps the axe handle (+Y) to hand -X, the palm normal. In Idle_Loop the handle then points sideways across the hips (world ≈ +0.98 X) instead of through the fist (+Z). Verify visually; the suggested fix is rotationQuaternion (0, 0.7071, 0.7071, 0).
- appearance.ts scales spine_02 / spine_03 by (build, 1, build) and compensates only neck_01. The arm chain, and any weapon parented to hand_r or spine_03, inherits that non-uniform scale and gets sheared or stretched. Attach weapons through a helper node that copies only position and rotation, or compensate the clavicles.
- Fragile fallback: if anim_full is missing, the build silently drops 16 shipped clips (Death02, Bow_*, Hit_Stomach, KipUp, ...), and Character.group throws 'missing clip' at runtime. Nearly all proposed additions (43 of 62 required) also exist only in the full files.
- Name mismatches between packs: Standard ClimbUp_1m / Shield_Dash / Sword_Dash vs full ClimbUp_1m_RM / Shield_Dash_RM / Sword_Dash_RM; also 'SwordLight_C_Rec' has no underscore.
- Stance mismatch: UAL2 sword attacks start and end in the Idle_Loop pose, which is 56° from the UAL1 Sword_Idle stance. Use Idle_Loop as the armed idle with UAL2 attacks, or blend over ≥0.2 s.
- Hit windows are very short (2-6 frames at 30 fps; tip speeds 47-88 m/s), so per-frame point checks will miss hits. Use swept segment or capsule tests between frames.
- Several actions have no dedicated clip: lever pull, sword-only block impact, backstep, hip draw (Sword_Enter is a back draw), animals. The substitutes (Farm_PickingTree, a Sword_Block segment, Jog_Bwd burst) are approximations.
- Hit_Knockback ends lying flat. Using it as a stagger requires chaining LayToIdle or KipUp.
- Climb loops are in place and GetOffWall_2m_RM ends mid-air, so the controller must script vertical speed (≈0.9 m/s) and the landing.
- Foot sliding (existing): player.ts normalizes Walk_Loop at 1.6 m/s and crouch at 1.3 m/s, but the native speeds are ≈0.95 m/s and ≈0.5-0.7 m/s.
- Crouch, dodge, roll, jump, death and climb clips open the hands, so a held weapon floats unless finger rotations are overridden.
- Size: the required set adds ≈70 s ≈ 470 KB brotli (≈1.1 MB raw) to a file in the first ('cart') segment unless it is shipped as a separate later asset; CharacterFactory currently builds its clip map only in the constructor.
- Grip and sheath offsets come from joint positions, not meshes (accuracy about ±1-2 cm); fine-tune visually. Speed estimates are ±20%.