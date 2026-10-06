# 《北境：序章》 Keep (要塞) and Exit (出洞): final design specification

This is the build spec for two new chapters, `keep` and `exit`, plus the fixes to earlier chapters that they depend on. It is written for the implementers.

**Status.** Synthesised from three candidate designs (cinematic, gameplay, tech) and the judges' notes. The engineering backbone is the tech design. The dramatic beats come from the cinematic design. The combat teaching and resilience come from the gameplay design.

**What was checked.** I verified the claims below against the code, read-only, in `/home/user/northern-prologue`. I also re-ran the cave signed-distance-field (SDF) prototype with the final layout. The script is `tools/gen/prototypes/cave_v4.mjs`, a copy of `research/keepexit/cave_v3.mjs` with the layout in §4.3, and it is the reference to port. Every cave Y value in this document is a **measured floor** from that run. At runtime they come from `cave/anchors.json`; never hard-code them.

---

## 0. Decisions and how contradictions were resolved

| # | Topic | Decision | Source and reason |
|---|---|---|---|
| 1 | Segments | `SEGMENTS = [menu, cart, muster, execution, dragon, keep, exit]`. Drop `"choice"` (manifest.ts:2; nothing else references it). | tech. The keep pack is then fetched at tier 2 during the dragon chapter. |
| 2 | Faction choice | An explicit **E prompt** on each NPC: `E 跟随布伦（霜誓军）` or `E 跟随书记官（帝国）`. No timer and no auto-commit. Pressure comes from a dragon pass, nag lines and the NPCs running to their doors. A player who wanders off gets fireballs and is pushed back. `Chapter.canSkip()` returns false at step 0. | hybrid, per the judges |
| 3 | Doors | The scribe uses the **existing main gate**: he has the key, and the leaves are made openable. Brun uses a **new west postern**. That is one new wall opening, not two. | Resolves the tech design's "Brun opens a gate the scribe holds the key to". |
| 4 | Continuity of the unchosen NPC | Rebel route: the scribe runs off east and later comes back through the keep with soldiers. Imperial route: Brun goes in through the postern and his men follow; they are the E1 enemies. He later leads the pursuers. | Fixes the gameplay design's K0.E3/K4.E2 contradiction. |
| 5 | Names | Scribe: **伊沃·塔兰**, 雾门守备队书记官. His speaker label is 书记官 until he introduces himself (imperial K1-I6) and 伊沃 after. 卢西安 and 马雷克 are rejected. General: **维罗** (卡西乌斯·维罗) everywhere. Brun's surname 灰鬃 → **铁桦** (likely the official Chinese name of Skyrim's Gray-Mane family). Interrogator: **奥斯维克**. Scout: **卡雅**. New places: 柳溪村 (in 溪谷) and 石桥堡. | judges |
| 6 | Torture room | Rebel route: a fight (interrogator plus an assistant who surrenders). The tech design's mercenary interrogator supplies the dying lines. Imperial route: the **blank-warrant bluff**, which becomes a fight if the player attacks. The interrogator leaves toward the drain and his **body is found at the rebel camp**. The cocoon now holds a courier, which fixes the drawbridge continuity hole. | cinematic + tech + judges |
| 7 | Beast | 0 A.D. **wolf** ×1.5, which has a native lying segment. The bear is cut. *Pipeline note, awaiting the design owner's confirmation: the build reads ×1.5 as 1.5 × a real-world large grey wolf (0.3 m per 0 A.D. unit: 1.15 m to the ear tips, 1.7 m nose to tail tip), so the shipped wolf is 0.45 m per unit, 1.72 m to the ears and 2.56 m long. This is **not** the horse's convention: `HORSE_SCALE` 0.4 m per unit as life size (`src/prologue/wagon.ts`). On that baseline ×1.5 would be 0.6 m per unit, 33 % larger (2.29 m to the ears, 3.41 m long). For that size, set `CreatureProfile.scale` 1.333 or `WOLF.metresPerUnit` 0.4 in `tools/gen/creatures.mjs`. See Appendix "Pipeline outputs", Creatures.* | tech |
| 8 | Cave layout | Tech's measured layout, with the gallery enlarged so a camp fits, the spider chamber and den raised, and a new switchback climb to the cinematic **balcony**. Re-validated in v4 (§4.3). | tech + cinematic |
| 9 | Exit | The tunnel physically emerges inside a **rock outcrop set piece** that sits on the terrain. The terrain crossing is a covered hole (`EXIT_HOLE`, same code as `KEEP_HOLE`). A white-out teleport from a dead-end stub is the **cut-list fallback** only. | judges |
| 10 | Controls | Attack = `Mouse0`. Block = `Mouse2` (`Mouse1` is the middle button: input.ts records `Mouse${e.button}`). Heal = `KeyQ`. Sneak = **`KeyC`** with a toggle option (Ctrl+W closes the tab and nothing calls `keyboard.lock`). **No dodge** (Alt+Left is browser Back). `input.down()` must also read mouse buttons. | verified in input.ts and settings.ts |
| 11 | Camera | Automatic third person while armed. The first-person viewmodel is cut. | gameplay, tech cut path |
| 12 | Navmesh | **Not on the critical path** for these chapters. The arenas are convex; the AI uses direct steering, `CapsuleMover` and a breadcrumb companion. Recast is built as framework item P2b. | tech + navigation research |
| 13 | Death | The **encounter** resets in place and difficulty adapts after 2 deaths. The chapter is never re-prepared. | gameplay (adaptive) + tech (no re-prepare) |
| 14 | Pacing | Keep about 13 min, exit about 8 min. Any stretch with movement locked is ≤ 20 s, and look stays enabled except in the 8 s bonds shot. Hold E to skip a line. | judges |
| 15 | Scope cuts | Removed: frost spells, the mother spider's spit and puddles, coins, the 14-item loot table, difficulty presets, the viewmodel, the bear, and the cinematic design's second door. | judges |

---

## 1. Cast

| id | Label | Model (`CharacterSpec`) | Role |
|---|---|---|---|
| `brun` | 布伦 | existing | Rebel companion. On the imperial route he leads the pursuers in K12. |
| `scribe` | 书记官 → 伊沃 | existing | Imperial companion. On the rebel route he leads the pursuers in K12. |
| `gateguard` | 帝国守卫 | `OUTFITS.soldier` without the hood, `hair_buzzed` | Imperial route only, K1–K3. Killed off-screen. (cut list #5) |
| `interrog` | 审讯官 (奥斯维克) | `OUTFITS.peasant` + `outfit_ranger_Arms_Bracer` + boots, `hair_buzzed` + `hair_beard`, dark tint | Torture room |
| `assistant` | 审讯助手 | `OUTFITS.peasant` | Torture room |
| `kaja` | 女囚 → 卡雅 (rebel route); 霜誓军斥候 → 卡雅 (imperial route) | `sex:"f"`, `OUTFITS.rebel`, `hair_buns`. Uses `World.ensureFemale()`, as the priestess already does, so it is cheap. | Caged scout |
| `oldman` | 老囚犯 | peasant, `hair_long` + `hair_beard` | Optional flavour in the cells (cut #2) |
| enemies | 帝国盾兵 / 帝国守卫长 / 帝国士兵 / 帝国弓手 / 狱卒 | `OUTFITS.soldier` | Rebel route |
| enemies | 霜誓军斧手 / 霜誓军头目 / 霜誓军弓手 / 霜誓军逃犯 | `OUTFITS.rebel` | Imperial route |
| creatures | 小洞蛛 ×2, 洞穴巨蛛, 巨狼 | §10 | Both routes |

---

## 2. Controls and input (prerequisites)

| Action | Key | Pad | Label |
|---|---|---|---|
| `attack` (new) | `Mouse0` | RT (7) | 攻击 |
| `block` (new) | `Mouse2` | LT (6) | 格挡 |
| `heal` (new) | `KeyQ` | D-pad up (12) | 治疗药水 |
| `ready` (existing, R) | `KeyR` | X (2) | 拔出/收起武器 |
| `sneak` (changed) | **`KeyC`** | L3 (10) | 潜行 |
| `activate` (existing) | `KeyE` | A (0) | 交互 |

Required changes:
- `input.down(a)`: if the bound code matches `/^Mouse(\d)$/`, return `(mouseButtons >> n) & 1`.
- Mouse swallow: when a `mousedown` happens while the pointer is not locked (Game.ts:65 then requests the lock), set `input.swallowMouse0 = true`. `PlayerCombat` ignores `Mouse0` while `!input.locked` or while that flag is set, and the flag clears on `mouseup`.
- Settings: bump the settings store to v2. Migrate `sneak: "ControlLeft"` to `"KeyC"`. Add `sneakToggle: boolean` (default false), shown in settings as 潜行方式：按住 / 切换.
- `Character.play` (characters.ts:137): change the default to `offset = loop ? Math.random() : 0`. This stops one-shot clips (attacks, hits, Kick, Consume, Chest_Open, Farm_PickingTree) from starting mid-clip.

---

## 3. Framework systems

New code goes in `src/engine/*` and must not import `src/prologue`. Game content stays in `src/prologue/*`.

### 3.1 Physics (`src/engine/physics`)
- **`CapsuleMover`**: extracted from `PlayerController.step`. A `CharacterVirtual` with r 0.3 and h 1.8, step-up 0.45, stick-down 0.5, and `mInnerBodyShape` on `L.MOVING`. Used by the player, combat NPCs and the companion in combat.
- **`Physics.rayCastStatic(from, dir, max)`** with a STATIC-only filter, used for line of sight and the camera boom. Today's `rayCast` uses the MOVING filter and hits NPC inner bodies.
- **Body registry**: `addStaticMesh`/`addBox` accept `{tag}` and return an id, plus `setBodyEnabled(id, on)`. Door tags: `keep_door_l/r`, `postern`, `g2_door`, `store_door`, `stair_door`, `torture_door`, `cell_gate`, `web_A/B`, `bridge_deck_{raised,lowered,broken}`, `blocker_*`. `ensurePhysics` must **keep** the per-leaf ids for `keep_door_*` (it currently discards them) and unfreeze the leaf world matrices.
- **Terrain holes**: a single shared constant `TERRAIN_HOLES` (`src/world/terrainHoles.ts`, mirrored in `tools/gen/terrainHoles.mjs`). It is used by:
  - `tools/gen/terrain.mjs` `buildChunk`, which skips any quad whose centre lies inside a hole's `render` rectangle;
  - `Physics.addHeightField(..., hole)`, which returns `HeightFieldShapeConstantValues.cNoCollisionValue` for samples inside a hole's `samples` rectangle.

  Jolt drops every triangle that touches a hole sample. On the 2 m grid the effective hole is therefore up to 2 m larger than the sample rectangle, which is why sample rectangles are shrunk 2 m inside the covering geometry.

  | Hole | `samples` (x, z) | Effective hole | `render` skip | Covered by |
  |---|---|---|---|---|
  | `KEEP_HOLE` | x 50…70, z −668…−656 | x 48…72, z −670…−654 | x 47.5…72.5, z −670.5…−653.5 | keep walls and roof; interior floor-slab collider x 47.5…72.5, z −670.5…−653 |
  | `EXIT_HOLE` | x −22…−16, z −680…−676 | x −24…−14, z −682…−674 | same as effective | outcrop footprint x −26…−9, z −684…−664 |

- **`Debris`**: generalised from `PrologueStage.breakBreach`. Boxes go on `L.DEBRIS`/`L.RAGDOLL` and freeze after 8 s. Used for the crenellation block, the bridge planks, the rubble and the slab.

### 3.2 World, lighting and zones (`src/engine/world`)
- **Fixed lights from boot.** The scene has exactly 5 lights in every chapter: `sun`, `fill` and **`LightPool` = 3 PointLights**, always enabled with intensity 0 when unused. Set `maxSimultaneousLights = 5` on every PBR or Standard material at load (terrain, buildings, characters, props, interior, cave). Shaders then never recompile mid-play.
  - `FireFx.create(w, {lights: 0})` creates no lights of its own. `fire(..., {light:true})` asks the pool for a slot.
  - Pool assignment: every 0.25 s, assign the slots to the nearest in-front anchors within 18 m, crossfading over 0.3 s. Slot 0 can be **locked** to the companion's torch. Low quality uses 2 slots.
  - Wall-sconce flames are sprites from one `SpriteManager`.
- **`environment.setInterior(profile, seconds)`** blends sun intensity, fill, environment intensity, fog and exposure, and sets CSM `refreshRate = 0` while inside. Sun intensity goes to 0; lights are never toggled.

  | Profile | Env | Fog colour / density | Exposure | Sun |
  |---|---|---|---|---|
  | `hall` | 0.25 | (0.08, 0.06, 0.05) / 0.02 | 1.25 | 0 |
  | `basement` | 0.08 | (0.03, 0.03, 0.035) / 0.035 | 1.45 | 0 |
  | `cave` | 0.05 | (0.02, 0.025, 0.03) / 0.04 | 1.6 | 0 |
  | `climb-out` | blends to outdoor by distance to the anchor `bend`, over the last 13 m | | | 0 → 1 |
  | `outdoor` | restore, plus `env.setMood(1)` | | | 1 |

- **`World.setOutdoorVisible(on)`** toggles terrain chunks, instanced sets, the town root (except the keep holder while on the ground floor), the sky and `stage.townFires`.
- **`Zones`**: AABB zones checked at 4 Hz. Each zone sets a lighting profile, visibility sets, ambience beds and the music state.
  - Keep: `K_GF`, `K_BS`.
  - Cave: `A` (entry + gallery), `B` (toward the spider chamber + spider), `C` (toward the den + den), `D` (climb), `E` (outcrop/balcony).
  - The current cave zone and its neighbours are enabled.

### 3.3 Actors and equipment (`src/engine/actors`)
- **`BoneSocket(bone)`**: a free TransformNode that copies only the bone's world position and rotation each frame. This avoids the shear from `appearance.ts` spine scaling. Attach recipes (hand-local; grip centre (∓0.03, 0.095, 0); handle axis +Z):

  | Prop | Socket | `rotationQuaternion` | Position | Scale |
  |---|---|---|---|---|
  | `ph/wooden_axe_03` | `hand_r` | (0, 0.7071, 0.7071, 0) | (−0.03, 0.095, 0.15) | 1.25 |
  | FPM `Sword_Bronze` (handle +Y, edge +X) | `hand_r` | (0.5, 0.5, 0.5, 0.5) | (−0.03, 0.095, 0) minus the model's grip offset, tuned | 1 |
  | `ph/kite_shield` | `hand_l` | (0.5, −0.5, −0.5, 0.5); flip 180° about Z if the face points inward | tune | 1 |
  | Sheathed sword | `spine_03` | hand rotation relative to spine (0.260, 0.659, −0.486, 0.512) | grip (−0.138, 0.347, −0.216) | – |

  - Draw: `Sword_Enter`, swapping the weapon to the hand at 0.72 s.
  - Sheathe: `Sword_Exit`, releasing at 0.47 s. Use `setParent` so the world transform is kept.
  - The shield is carried on the back at `spine_03`, tuned visually.
- **Finger override**: while armed, `postAnimate` copies the `Sword_Idle` frame-0 local rotations of the 15 weapon-hand finger joints, except during the Enter/Exit grab window.
- **`Creature`**: a generic animated glb with cloned groups. `play(name, {loop, speed, from, to})` and `bone()`. Used for the spiders and the wolf.
- `createPlayerBody(world, a, outfit = OUTFITS.peasant)`. Gear-up rebuilds the body with `OUTFITS.rebel` or the soldier set minus the hood, behind a 0.35 s black dip.
- `player.playScripted(clip)` / `clearScripted()`, `player.bound`, `player.armed`. While a body clip plays (bonds, chest, lever, potion), the camera switches to third person with a 0.25 s blend and then back.

### 3.4 Animation pipeline (`tools/gen/characters.mjs`)
- Assert that every requested clip was found. Today the Standard-pack fallback silently drops 16 shipped clips.
- Dispose the 63 orphaned UAL2 joint copies.
- **Root motion**: for each new UAL2 `Sword_*`, `Sword_Dash_RM` and `Sword_Block`:
  - rebase the root track to its first key;
  - write `(t, x, y, z, yaw)` into `chars/anim_rootmotion.json`;
  - zero the root translation and set the rotation to rest (*as built: the rotation goes to rest, but the translation is pinned at the sword set's static offset (0, 0, −0.0758), not zeroed; see below*).

  At runtime the curve delta is applied to the `CapsuleMover` as velocity, clamped to 3 m/s and zeroed within 0.9 m of the target. *Correction (as built):* the shipped `Sword_Block` −0.08 m root offset is not a bug. Its pelvis and leg pose bake in a matching +0.0758 m forward offset, as do the other UAL2 `Sword_*` clips, so its feet stand on `Idle_Loop`'s footprint. Zeroing that root moved every sword clip 7.6 cm ahead of the idle footprint and the capsule. The build therefore pins the root at that offset (`Sword_Dash_RM` at 0) and checks the footprints by forward kinematics. `Sword_Block` ships unchanged. See Appendix "Pipeline outputs".
- Emit the new clips as **`chars/anim_combat`** in segment `keep`, and add `CharacterFactory.addClips(container)`.
- New clips (44, about 48 s, about 330 KB brotli):
  - **UAL1:** Sword_Enter, Sword_Exit, Sword_Attack, Hit_Shoulder_L, Hit_Shoulder_R, Push_Enter, Push_Loop, Push_Exit, Punch_Jab, Punch_Cross, Kick, Crouch_Enter, Crouch_Exit, Crouch_Bwd_Loop, Crouch_Left_Loop, Crouch_Right_Loop, Jog_Left_Loop, Jog_Right_Loop, Jog_Bwd_Loop, PickUp_Table (*as built: PickUp_Table exists only in UAL1; see Appendix "Pipeline outputs"*).
  - **UAL2:** Sword_Light_A, Sword_Light_A_Rec, Sword_Light_B, Sword_Light_B_Rec, Sword_Light_C, SwordLight_C_Rec (no underscore), Sword_Regular_A, Sword_Regular_A_Rec, Sword_Regular_B, Sword_Regular_B_Rec, Sword_Heavy_A, Sword_Heavy_A_Rec, Sword_Dash_RM, Shield_OneShot, Idle_Shield_Break, Walk_L_Loop, Walk_R_Loop, Walk_Bwd_Loop, Bandage_Loop, Chest_Open, Consume, Farm_PickingTree, Bow_Aim_Up, Bow_Aim_Down.
  - **Reused shipped clips:** Idle_Loop (armed idle), Sword_Idle, Sword_Block, Idle_Shield_Loop, Hit_Chest/Head/Stomach, Hit_Knockback, LayToIdle, KipUp, Death01/02, Crouch_Idle/Fwd, Idle_Torch_Loop, Idle_Talking_Loop, Idle_Rail_Call, Interact, Fixing_Kneeling, PickUp_Kneeling, Sitting_Idle_Loop, GroundSit_Idle_Loop, Crying, Idle_Tired_Loop, Bow_Notch/Aim_Neutral/Shoot, Sprint_Loop, Surprise.
- Foot slide (player.ts): normalise walk to the native 0.95 m/s and crouch to 0.6 m/s, not 1.6 and 1.3.

### 3.5 Combat (`src/engine/combat`)
- `Vitals {hp, maxHp, st, poise, armourMul}` with events.
- `attacks.ts` holds the data tables from §8.
- **`CombatSystem`**:
  - Registry and faction hostility.
  - **Hit test**: on every frame inside the clip's active window, test each target **once per swing**: distance ≤ reach + target radius, within ±arc of the attacker's facing, |Δy| < 1.2, and `rayCastStatic` line of sight. This is a swept test, not a single frame, because the swings are 2–6 frames long.
  - Block, parry, poise and guard break; attack tokens (≤ 2 on the player, ≤ 1 on the companion); events for sound effects, hit-stop (50/80 ms) and camera shake.
- **`PlayerCombat`**: draw and sheathe, light chain, held heavy, block and parry, potion, stamina, death callback. Drawing a weapon switches to third person (shoulder offset 0.45 m right, distance 2.6, boom collision via `rayCastStatic`); sheathing returns to the previous point of view.
- **`Encounter`**:
  - Spec: `{id, arena AABB[], spawns[], music, retry: {player, companion}, onStart, onClear}`.
  - `spawn()`, `allDefeated` (surrender counts as defeated), `reset()`, `dispose()`.
  - On player death: time scale 0.35 for 1 s, `hud.fade` 1.5 s, `reset()` (despawn and respawn the enemies, restore player HP/stamina and potion count to the encounter-start snapshot, teleport both actors to the retry marks), increment `flags.deaths[id]`, fade in.
  - Adaptive difficulty: ≥ 2 deaths gives enemy damage ×0.75 and wind-ups at 0.5×. ≥ 3 deaths also gives enemy HP ×0.85 and companion damage ×1.5.

### 3.6 AI (`src/engine/ai`)
- **Perception** (5 Hz, round-robin, ≤ 4 LOS rays per frame) and **NoiseBus**. Values are in §9.
- **HumanoidBrain** (10 Hz hierarchical state machine):
  - `Post/Unaware → Suspicious (investigate the last noise) → Alert (bark; shout alerts allies within 15 m) → Approach (jog 3.0 m/s to 3.5 m, walk to 1.6 m) → Circle (strafe 0.9 m/s on a 3–4.5 m ring, Walk_L/R_Loop, while waiting for a token) → Attack (wind-up at 0.6× to the hit frame, then 1×, plus a glint and a grunt) → Recover (_Rec at 1.2×) → Block (reactive, % in §8) → Stagger (poise 0: directional Hit_* 0.9 s; heavy kill: Hit_Knockback → LayToIdle) → Dead (Death01/02, or a ragdoll for at most 2 at once)`.
  - Extra states: `Surrender` (kneel, `Crying`, removed from tokens) and `Scripted` (`ai.suspend(ch)`/`ai.resume(ch)` hand control to the Director).
  - Facing `yaw = atan2(vx, vz)` at 8 rad/s.
  - Stuck detector: speed < 0.2 for 0.8 s while moving → steer tangentially for 0.6 s.
  - Separation r 0.45.
- **CreatureBrain**: the same machine with creature parameters, plus `Asleep → Stir → Wake` and a leash for the wolf.
- **Companion**:
  - Outside combat it follows **breadcrumbs**. A crumb is dropped every 0.5 m while the player is grounded and carries the foot Y (120 kept). It keeps 2.5 m behind the player: walks 1.4 m/s under 3 m, 2.2 m/s at 3–8 m, jogs 3.6 m/s beyond 8 m, and stops within 4 m when the player is idle.
  - Catch-up: if more than 25 m behind and off-screen, or stuck for 4 s, it teleports to the crumb 6 m behind the player, outside the camera frustum.
  - It crouches when the player sneaks or inside stealth zones.
  - In combat it switches to `CapsuleMover`, prefers enemies that are **not** on the player, and has the specials in §8.
  - It is essential: at 0 HP it kneels for 6 s, then stands at 50 %.

### 3.7 Interaction, HUD and Director
- **`Interactables.add({id, pos, radius:2.0, label, enabled, use})`**: picks the nearest target within 2.0 m and 35° of the view and shows `hud.use("E " + label)`. A "hold" variant (1.5 s, `Fixing_Kneeling`) is used for the cocoon.
- **HUD additions**:
  - `vitals({hp, st})`: bottom centre; fades 3 s after full; shown when armed or changed.
  - `target(name, frac)`.
  - `boss(name, frac)`: 洞穴巨蛛, 巨狼.
  - `use(text)`: its own element, so it never clobbers `prompt`.
  - `objective(text)`: persistent line.
  - `tip(id, text)`: once per id, recorded in `flags.tips`.
  - `stealth(k, stir)`: eye icon.
  - `damage()`: red vignette, plus a heartbeat below 30 % HP.
  - `death()`: 你倒下了……
- **Director**:
  - `bark(name, text, {npc, cooldown=4})` is non-blocking, suppressed while a `say` is running, and never freezes the player.
  - **Hold-E skip**: holding `activate` for ≥ 0.35 s, once a line has played ≥ 0.3 s, ends that line. It is disabled in K0, and interactables do not fire while a `say` is active.

### 3.8 Persistent state (`PrologueStage`)
```ts
interface PrologueFlags { v: 1;
  faction?: "rebel" | "imperial";
  inv: { weapon: "none"|"sword"|"axe"; shield: boolean; armour: 0|15|20; potions: number; keyring: boolean; letter: boolean; charm: boolean };
  looted: string[]; tips: string[];
  outcomes: { torture?: "killed"|"bluff"|"fought"; assistant?: "spared"|"killed"; backstab?: "silent"|"fight"; beast?: "asleep"|"killed"|"fled"|"skipped" };
  deaths: Record<string, number>; }
```
- Saved as `PrologueSave.flags`, next to `appearance`.
- `Chapter.save()` returns only `{step}`.
- `stage.snapshotFlags()` runs at every checkpoint and encounter start. Loot ids in `looted` are never respawned.
- `Chapter.canSkip?(): boolean`. `PrologueStage` hides 跳过 while it returns false.
- **Stage-owned world events**:
  - `stage.dragons` (a `DragonDirector` with `pass(points, speed)`, `circuit(center, r, yMin, yMax, roarEvery)`, `hide()`, built from DragonChapter's private helpers).
  - `stage.townFx` (a single FireFx with `lights:0`) and `stage.townFires` (persistent house-fire handles with `pause()`/`resume()`).
  - `DragonChapter.dispose()` must no longer stop the flight or dispose the fires.
- **Underground placement**: `place3(ch, x, z, yHint)` casts a ray down from yHint + 1.5 against static colliders. Never use `stand()` or `heightAt()` below ground; `walkPath` underground passes `{ground:false}` with explicit Y from anchors.

### 3.9 Navmesh (framework, P2b, non-blocking)
Implement as a reusable engine module for town roaming and future content. The keep and exit chapters do not depend on it.

- **Packages:** `@recast-navigation/core`, `generators` and `wasm`, pinned **exactly 0.43.1**.
- **Vite:** alias `/^@recast-navigation\/wasm$/` → `dist/recast-navigation.wasm.js`, and exclude all three packages from `optimizeDeps`.
- **Build:** a module worker `src/engine/nav/nav.worker.ts` builds a **TileCache** from the Jolt static collider soup (a `NavGeometry` sink in `addStaticMesh`/`addHeightField`/`addBox`). Results are cached in IndexedDB under the key SHA-256(soup) + `NAV_VERSION` + zone.
- **Config:** `cs 0.25, ch 0.2, tileSize 32, walkableSlopeAngle 50, walkableHeight 9, walkableClimb 2, walkableRadius 2` (the walkable values are in voxels), `expectedLayersPerTile 4, maxObstacles 64`.
- **Runtime:** doors are box obstacles; off-mesh links come from a per-zone table. The crowd syncs to `CapsuleMover` via `agent.raw.set_npos()` before `crowd.update()`.
- **Gotcha:** `computePath` reports partial paths as success, so always check the distance from the path's last point to the goal.

---

## 4. Layout

Keep-local → world: `(60 + x, 37.73 + y, −662 + z)`. The keep stands at `heightAt(60, −662) − 0.2`. The ground-floor top is local y 0.4 (**world 38.13**); the basement floor is local y −5.6 (**world 32.13**). Yaw is `atan2(−dx, −dz)`: facing −Z = 0, west = π/2, east = −π/2.

### 4.1 Keep exterior and doors (`tools/gen/townbuildings.mjs` `buildKeep`)
- **Remove the `dark` box** at line 206 (`[0, gateH/2, hd−t−1.5]`, 4×5×3). It is also a collider and blocks the gate passage.
- **Main gate**: the existing leaves are hinged at x 58 and 62, z −653.65. They swing **inward 85° over 1.4 s** (check the sign per side). The hall keeps 2.2 m clear behind them. Once inside, add `blocker_gate` (4 × 5 × 0.3 at z −653.9).
- **West postern (new)**: west wall, local x −13…−11.8 (world 47.0…48.2), local z 2.3…3.7 (world −659.7…−658.3), opening y 0.4…2.8 (1.4 × 2.4 m). The ground outside is 38.05, so add a 0.1 m stone sill. The leaf (`dark_wooden_planks` + `rusty_metal_02` straps) is hinged at the north jamb and has its own body.
- **K0 marks**:
  - Player start (60, 38.2, −648).
  - Scribe at the gate (61.0, 38.13, −652.6), facing the door, looping `Interact`.
  - Brun's postern wait point (43.6, 38.08, −657.5), looping `Idle_Rail_Call`. It is visible past the SW turret, which occupies x 45.4–48.6, z −654.6…−651.4.
  - Crenellation debris falls at (64.5, 38.3, −650.5), to the side of the steps so it never blocks the gate.

### 4.2 Keep interior (`tools/gen/keepinterior.mjs`)
A room graph of boxes with faces subdivided to about 0.5 m.
- COLOR_0 = baked AO (union-of-boxes SDF, 5 probes) × (0.35 + warm falloff from the sconce anchors) × grime (darker below 0.6 m, soot above torches). Reset `hasVertexAlpha=false` after load.
- `*_col` nodes hold unsubdivided boxes, plus **one ramp per stair flight (35.5°)**. Door leaves are separate nodes. Empty `anchor_*` nodes mark lights, spawns, interactables and zones.
- Target 30–40k triangles. Partitions are 0.6 m thick; doors are 1.4 × 2.4 m.
- Materials:
  - `castle_wall_slates`: ground-floor walls (matches the outside).
  - `stone_brick_wall_001`: basement.
  - `rock_tile_floor`: all floors.
  - `dark_wooden_planks`: doors, tables, racks.
  - `rusty_metal_02`: bars, chains, cage.
  - `old_planks_02`: shelves.

**Ground floor** (world floor 38.13)

| Room | Local extent (x; z) | World anchors |
|---|---|---|
| **G1 Hall** (E1 arena) | −6…6; −1.6…7.8; beams at y 6.4 | Pillars (57, −660) and (63, −660). Cover table `ph/wooden_table_02` ×2 at (60, −661.5). Cauldron braziers + FireFx 0.4 (pool lights) at (55.2, −655.4) and (64.8, −655.4). **Imperial gear**: WeaponStand (sword + kite shield) at (64.6, −655.0) facing −X; armour locker `Chest_Wood` at (65.2, −661.0) facing −X. Imperial bond spot: player (60, −656.5), Ivo (60, −658.3). |
| **G2 West guard room** (rebel entry) | −11.8…−6.6; −7.8…7.8 | Postern (§4.1). Door to the hall: x 53.4…54.0, z −657.7…−656.3 (`g2_door`; the leaf is on the hall side). North part (z < −665) collapsed: rubble, a crushed guard at (51.0, −666.5), fire glow (pool light, **no roof hole**). **Rebel gear**: confiscation `Chest_Wood` at (49.0, −655.5) facing +X; WeaponStand (Brun's father's axe, an iron sword, a second axe) at (49.0, −662.2) facing +X. Rebel bond spot: player (52.0, −658.8), Brun (50.6, −658.8). |
| **G3 Barracks** (optional) | −6…6; −7.8…−2.2 | Door x 59.3…60.7, z −664.2…−663.6. Bed_Twin1 ×4. Footlocker at (64.2, −666.9) holds the `letter`. Rebel-route E1 spawns at (60.0, −667.0) and (62.5, −667.5). |
| **G4 Storeroom** | 6.6…11.8; 1.2…7.8; clear 4.0 | Hall door x 66.0…66.6, z −659.0…−657.6 (`store_door`, **locked**, opened with the key ring). Shelf_Small_Bottles + Potion_2 ×2 at (71.2, 39.0, −656.5). Barrels and crates (existing PH props). Stair door x 69.0…70.4, z −661.4…−660.8. |
| **G5 Stairwell** | 6.6…11.8; −7.8…0.6 | Top landing z −1.2…0.6 (local y 0.4). Flight A: local x 9.9…11.6, z −1.2 → −5.4, y 0.4 → −2.6 (14 steps, 0.214/0.30). Mid landing z −7.6…−5.4 at y −2.6 (**tremor point** world (69.2, 35.13, −668.5)). Flight B: x 6.8…8.5, z −5.4 → −1.2, y −2.6 → −5.6. 1.0 m railing. |

**Basement** (world floor 32.13)

| Room | Local extent | World anchors |
|---|---|---|
| **B1 Stair foot** | 6.6…11.8; −1.2…7.8; clear 3.6 | CP4 (67.65, −662.8) |
| **B2 Corridor** | −1.0…6.6; 4.4…6.8; clear 3.0 | 2 sconces |
| **B3 Torture room** | −10.6…−1.0; −1.4…7.6; barrel vault 4.4 | Door x 59.0, z −657.1…−655.7 (`torture_door`). **Cage** (procedural 2.0 × 2.2 × 2.0 m, door on +X) at (51.4, −656.6). Strap chair (54.2, −659.4). Brazier with irons (56.6, −657.4). Records table + Scroll_1 + Book (51.2, −661.5). Wall shackles and corpse (49.7, −662.8). **Marks**: interrogator (53.0, −657.8), assistant (54.0, −655.6), companion (55.6, −659.0). Arch to the cells x 52.9…55.3 at z −663.4 (open bar gate). |
| **B4 Cell corridor** | −7.1…−4.7; −1.4…−20; clear 3.2 | 10 cells, 3.0 × 3.4 m each (west x 49.5…52.9, east x 55.3…58.7, bands of 3.4 m from z −664.4). Bars r 15 mm at 0.12 m, merged, one collider per cell front. Old prisoner, east cell 2, at (57.0, −669.5). Loot potion, west cell 3, at (51.2, −672.9). |
| **B5 Guard room J** | −11…−1; −20…−26; clear 3.4 | Table + dice (54.1, −685.6). **Jailer stool** (54.1, −684.6) facing −Z. Chest (50.4, −687.2). Companion whisper stop (54.1, −679.5). **Drain** in the north wall: x 52.9…55.3, z −688, broken iron grate → cave anchor `breach`. |

### 4.3 Cave (`tools/gen/cave.mjs`, port of `cave_v4.mjs`)
The method follows the env research: an SDF smooth union of D-shaped swept capsules plus flat-floored ellipsoid chambers and a stream trench. Noise is 0.55 m on walls and 0.12 m on floors; meshing is naive surface nets at 0.5 m; normals are the SDF gradient; AO comes from 5 SDF probes. Meshes are simplified to **35 % (render)** and **12 % (collider)**.

Spline control points are `[x, floorY_spline, z, halfWidth, clear]`. The splines carry +1 m because smooth-min floors land about 1 m lower.
```
entry:    [54,33.1,-687,1.3,2.7] [54,31.0,-697,1.8,3.0] [52,29.6,-710,2.0,3.2] [49,28.0,-720,2.2,3.4] [48,28.0,-731,2.4,3.6]
toSpider: [48,28.0,-731,2.2,3.4] [47,28.0,-741,2.0,3.3] [42,28.2,-746,2.0,3.2] [32,28.4,-749,1.9,3.2] [18,28.5,-750,2.2,3.4]
toDen:    [18,28.5,-750,2.0,3.2] [6,29.2,-748,2.0,3.2] [-6,30.6,-741,1.9,3.0] [-16,32.0,-731,2.0,3.2] [-24,33.5,-720,2.2,3.4]
exit:     [-24,33.5,-720,2.0,3.2] [-28,34.3,-709,2.0,3.2] [-33,36.3,-699,2.1,3.2] [-40,38.8,-690,2.2,3.3] [-46,41.6,-681,2.3,3.4]
          [-44,44.2,-671,2.3,3.4] [-36,46.8,-674,2.3,3.4] [-30,49.6,-682,2.4,3.5] [-25,52.2,-684,2.6,3.6] [-21,54.8,-680,2.8,3.8] [-17.5,57.0,-673.5,3.2,4.2]
stream [x,bedY,z,halfW]: [64,23.4,-733,1.6] [56,23.3,-732.5,2.6] [48,23.2,-731.5,3.7] [40,23.1,-731,2.6] [32,23.0,-731,1.6]
chambers: gallery c[48,28,-731] r[14,10,11] yaw 0 · spider c[18,28.5,-750] r[9,8.5,7] yaw 0.1 · den c[-24,33.5,-720] r[8,6,7] yaw -0.4
extra SDF: spider chimney capsule Ø2.5 from (18,34.8,-750.5) to (18,39,-750.5); archer perch = rock box 3×2.2×2 (solid) at (55.0, 29.05, -727.6) with 0.4 m rock steps from (52.8,-727.2);
           exit section s 76–92 floor terraced to 0.35 m risers
```

**Measured (v4):**

| Measure | Value |
|---|---|
| Path length | 238 m |
| Triangles raw → render → collider | 61.9k → 20.9k → 7.2k |
| Minimum rock cover | **3.92 m, 0 failures** (outside the outcrop zone x > −27, z > −686) |
| Minimum clearance / half-width | 3.8 m / 1.55 m |
| Wrong-winding faces | 0.44 % |
| Maximum floor slope | entry 22°, toSpider 15°, toDen 14°, exit **30° only in the terraced stair**, s 76–92 |
| Build time | about 23 s single-threaded |

**Build validator** (fails the build): cover < 1.5 m (outside the outcrop zone), clearance < 2.6 m, half-width < 0.9 m, untreated slope > 35°, wrong winding > 1 %.

**`cave/anchors.json`**: floor Y probed from the SDF. These are the v4 values; regenerate them on every build.

| Anchor | x, floor, z | Clear | Use |
|---|---|---|---|
| `breach` | 54, 32.00, −688.5 | 4.1 | drain/J junction (CP6) |
| `ramp_foot` | 54, 30.20, −697 | 4.3 | |
| `cp_gallery` | 51.0, 28.10, −714 | 4.8 | CP7 |
| `gal_entry_mouth` | 49.5, 27.00, −721.5 | 5.3 | where pursuers enter |
| `camp_fire` | 53.5, 27.95, −724.0 | 4.4 | PH `stone_fire_pit` + FireFx 0.5 |
| `sitA` | 52.0, 27.70, −722.8 | 4.1 | enemy A sits (GroundSit_Idle_Loop) |
| `standB` | 54.0, 27.95, −725.5 | 5.3 | enemy B stands (Idle_Tired_Loop) |
| `perch` | 55.0, 30.15 (shelf top), −727.6 | ~4.0 above the shelf | archer |
| `lever` / `lever_stance` | 44, 27.95, −725 / 44, 27.95, −724 | 5.3 / 4.7 | handle 0.32 m in front of the puller at 1.6 m height; stance yaw 0 |
| `bridge_n` / `bridge_s` | 48, 26.95, −726.5 / 48, 27.00, −736.5 | 7.6 / 7.2 | gap z −727.5…−735.5 (8 m; jump ≤ 5.8 m) |
| `gal_s_cp` / `comp_s` | 47.5, 27.05, −738.5 / 49.2, 27.10, −739.0 | 6.0 / 5.6 | keep end, exit CP0 |
| `web_A` / `cp_spider` | 27.0, 27.55, −749.5 / 31.5, 27.70, −749.0 | 4.8 / 4.6 | |
| `spider_c` | 18, 27.50, −750 | 7.3 | ceiling about 34.8; the chimney sits above it |
| `burrow_n` / `burrow_s` | 15, 28.45, −745.5 / 21, 28.50, −755 | 3.8 / 3.3 | small-spider spawns |
| `cocoon` | 22, 28.45, −754 | 4.1 | courier + letter |
| `web_B` / `cp_spider_done` | 10.5, 27.80, −749.2 / 12, 27.70, −749.5 | 5.2 / 5.5 | |
| `cp_den` | −16.5, 31.55, −729 | 4.2 | CP X3 |
| `wolf_bed` | −22, 32.85, −718 | 4.8 | wolf faces `cp_den` |
| `satchel` | −20.5, 33.50, −716.5 | 3.2 | 2.1 m from the wolf |
| `den_path` | (−19, 31.95, −726) → (−25.5, 33.15, −723.5) → (−27.5, 33.00, −718) → (−27, 33.15, −712.5) | ≥ 3.9 | closest approach to the wolf 5.5 m |
| `cp_climb` | −28, 33.60, −709 | 4.5 | CP X4 |
| `climb_mid` | −46, 40.70, −681 | 4.7 | |
| `cp_light` | −25, 50.85, −684 | 5.9 | stair start; `setOutdoorVisible(true)` |
| `bend` | −21, 53.70, −680 | 5.8 | the tight final bend; exposure bloom |
| `stub84` | −21.9, 52.95, −681.3 | 5.8 | cover 5.6 m; **fallback white-out point** |
| `balcony_mouth` | −17.5, 56.05, −673.5 | 5.4 | terrain below is 50.5 |

**Gallery**:
- Chasm z −727.5…−735.5 at x 48. Water surface 23.7, bed 23.1, flowing south.
- **Respawn plane**: y < 25.5 inside x 32…64, z −727.5…−735.5 → fade 0.6 s and teleport, with no damage, to the bank last stood on (`lever_stance` or `gal_s_cp`).
- **Drawbridge** (procedural, `weathered_planks` + chains): deck 8.8 × 1.8 × 0.25 m, hinge at (48, 27.0, −735.6).
  - States, each with its own static colliders:
    - **raised at 60°**: tip about y 34.6, under the 35.5 crown;
    - **lowered**: spans to z −727;
    - **broken**: north 3.6 m becomes 6 Debris planks; the south part hangs at −35°.
  - Winch at (44.8, 27.95, −725.8). A chain runs from the winch to the deck tip.
  - Slab (procedural, `rock_face_03`, 2.4 × 1.0 × 1.8 m) drops from (48, 34.8, −731.5).

**Spider chamber**:
- Web walls **A** at the east door and **B** at the west door: 3 stacked cards 4.4 × 3.6 m, 0.15 m apart, each wall with one removable box collider.
- Dressing: 12–20 corner webs and 5 cocoons (capsules r 0.35, 1.2–1.8 m). Teal egg sacs (emissive) by `burrow_s`.

**Den**:
- `roots` floor texture is optional. A daylight-fissure emissive card plus a spot light is purely cosmetic (112 m of rock lies above).
- Bones (procedural; stepping on one is noise): (−24.5, −721.0), (−26.8, −715.5), (−23.5, −712.8).

**Water**: a ribbon mesh at 23.7, 0.6 m wider than the channel, PBR with a scrolling `fx/water_n` (generated, tileable sines). No collider.

**Zone split**: A = entry + gallery, B = toSpider + spider, C = toDen + den, D = exit to `bend`, E = `bend` to the outcrop.

### 4.4 The balcony outcrop (望台)
Built in `cave.mjs` as a second SDF solid:
- `outcrop = roundedBox(centre (−17, 51.5, −673), half (7, 5, 7.5)) + noise 0.5`, with a hood rising to y 62.5 over x −23…−15, z −681…−674. The tunnel air is subtracted (`solid = max(outcrop, −air)`).
- Mesh only above `terrain − 0.5`. Footprint x −26…−9, z −684…−664.
- **Platform top** flattened at the measured `balcony_mouth` floor (56.05): 8 × 7 m centred at (−15.0, 56.05, −670.5), spanning x −19…−11, z −674…−667. The open edges are S and E, with a 0.8–1.2 m boulder lip (`boulder_01`, `rock_moss_set_01/02`) plus invisible 1.2 m rails.
- Brow: `rock_face_02` (PH, new). `EXIT_HOLE` (§3.1). Scatter exclusion within 10 m of (−18, −676).
- Respawn if y < 50 inside the outcrop zone.

**Vista** from eye (−15.0, 57.7, −670.5). All four sightlines were checked clear of terrain:

| Target | Distance | Yaw |
|---|---|---|
| Keep top | 76 m | −1.68 |
| Square | 110 m | −2.38 |
| Tower | 137 m | −2.26 |
| Inn | 146 m | −2.21 |

**Fallback (cut #6)**: the exit spline ends at `stub84` and no `EXIT_HOLE` is cut. Within 3 m of `stub84`: `hud.flash(1, 0.8)`, teleport to the platform, fade the white over 1.5 s. The outcrop mouth gets a black void card.

### 4.5 Dragon paths (Catmull-Rom; terrain clearance checked)
- **K0 pass**, 32 m/s, 276 m, minimum clearance 13 m over the forecourt; check against the turret tops at 52.7: (54, 150, −725) → (56, 125, −708) → (60, 64, −664) → (78, 55, −628) → (110, 70, −590) → (170, 95, −560). Then `circuit((72, −592), r 80, y 40–60, roar every 14–18 s)` until the keep doors close, then `hide()`.
- **X4 finale**, 1086 m, minimum clearance 18.6 m:
  - 30 m/s: P0 (−150, 205, −800) → P1 (−72, 170, −732) → P2 (−38, 130, −702) → **P3 (−16, 86, −676)**, which passes about 30 m over the platform.
  - 24 m/s: P4 (20, 74, −664) → P5 (58, 70, −648), over the keep → P6 (98, 72, −596), roar over the tower → P7 (82, 80, −552).
  - 28 m/s: P8 (150, 112, −600) → P9 (300, 205, −760) → P10 (520, 265, −1000), where it is disabled.

---

## 5. Chapter `keep` (要塞)

`id "keep"`, label 要塞, `seamless = true`. Target length about 13 minutes.

### 5.1 Beat sheet

| Beat | ≈ Time | Trigger → content | Objective (`hud.objective` + toast) | Step after |
|---|---|---|---|---|
| K0 两扇门 | 0:00–1:10 | Dragon pass, argument, NPCs run to their doors, nags, E-commit | 做出选择：跟随布伦（西墙小门），或跟随书记官（正门） | – |
| K1 入堡 | 1:10–2:00 | R: postern shouldered open, beam seals it, bonds cut. I: gate unlocked and barred, gate guard, introduction, bonds cut. **Doors open only after `await stage.ensureUnderground()`**; if late, `hud.loading(true)` and the companion loops "门闩卡住了" (`Push_Loop`). | 跟随{布伦/书记官}进入要塞 → 你的双手重获自由 | **1** (inside, bound) |
| K2 取装备 | 2:00–2:50 | Chest + rack (R in G2; I in the hall). 45 s fallback: the companion tosses a sword and auto-equips the armour. | 从{箱子/军械架}拿取护甲和武器 | **2** (= E1 retry point) |
| K3 初战 E1 | 2:50–4:00 | R: two imperial shield-bearers come out of the barracks. I: the gate guard screams and two rebel axe-men come in through G2. | 击败帝国守卫 / 击败霜誓军 | – |
| K4 储藏室 | 4:00–4:45 | Loot the leader (key ring + 1 potion; 30 s fallback). Storeroom: 2 potions. Barracks footlocker is optional. | 搜索{守卫长/头目}的尸体 → 打开储藏室 → 下到地牢 | **3** (E1 done) |
| K5 楼梯 | 4:45–5:05 | Tremor at the mid landing | – | **4** (stair foot) |
| K6 审讯室 | 5:05–7:15 | Overheard interrogation. R: fight (E2). I: warrant bluff (fight only if attacked). Cage opened, Kaja freed, key ring handed to her. | R: 击败审讯官 → 打开笼子 / I: 查看审讯室 → 打开笼子 | **5** |
| K7 牢房 | 7:15–8:00 | Old prisoner (optional), loot cell (optional) | 穿过牢房区 | – |
| K8 狱卒房 E3 | 8:00–8:50 | Backstab tutorial with one unaware enemy; no fail state | R: 潜行接近狱卒 / I: 潜行接近那个霜誓军 | – |
| K9 排水道 | 8:50–9:30 | Bent grate, tremor, drain ceiling collapses into a rubble ramp, companion takes a wall torch | 穿过排水道 | **6** (`breach`) |
| K10 河边营地 E4 | 9:30–11:30 | Unaware camp (2 melee + 1 archer). Briefing. Optional sneak opener. (I: the interrogator's body by the fire) | 击败营地里的{帝国兵/霜誓军} | **7** at `cp_gallery` (E4 retry) |
| K11 拉杆 | 11:30–12:15 | Lever (`Farm_PickingTree` 2.23 s; handle moves 0.56–1.68 s), bridge lowers over 4.5 s, cross. 60 s fallback: the companion pulls it. | 拉下拉杆，放下吊桥 → 过桥 | **8** (camp done) |
| K12 断桥 | 12:15–13:00 | Both on the south ledge (player z < −737, companion within 6 m, or a 20 s companion teleport) → pursuers, slab, collapse, standoff → they leave | 沿着河道深入岩洞 | chapter ends (seamless to `exit`) |

**Prompts (`hud.use`)**: E 跟随布伦（霜誓军） · E 跟随书记官（帝国） · E 打开箱子 · E 拿起 铁剑 · E 拿起 战斧 · E 拿起 鸢盾 · E 穿上 皮甲 · E 搜查 · E 打开笼子 · E 阅读 · E 拉下拉杆.

### 5.2 Set-piece timelines

**K0** (the player can move throughout; `canSkip()` is false; no auto-commit)

| t (s) | Event |
|---|---|
| 0.0 | `stage.dragons.pass(K0 path, 32)`. `audio/wings`. Both NPCs `Crouch_Idle_Loop`. |
| 1.0 | Crenellation Debris box falls at (64.5, 38.3, −650.5). |
| 3.0 | `roar_b`, `rig.shake(0.025, 1.8)`, `rig.lookToward(dragon, 0.8)`. Then `circuit(...)`. |
| 4.5 | K0-01…05 (about 16 s). |
| 20 | Brun sprints (5.2 m/s) to his postern mark. The scribe steps to the gate. Two 1.0 s `lookToward` nudges (Brun, then the scribe). Toast. Both E prompts become active, radius 3.0 m. |
| 20+ | Nag lines every 9 s, alternating, at most 6 (barks). After that, the toast repeats every 20 s. |
| any | Player > 35 m from (60, −650): `townFx.fireball` 6–10 m ahead of them plus K0-P1. Beyond 60 m: fade, toast 浓烟把你逼了回来, teleport to the start. |
| commit | `flags.faction` set, `snapshotFlags()`, commit lines. The unchosen NPC goes through his own door: R, the scribe unlocks the gate, slips in and is removed; I, Brun shoulders the postern and is removed. Each is removed once off-screen or after 10 s. |

**K1 bonds shot** (the only locked camera besides K12/X4, ≤ 8 s): `player.enabled=false`, `cut()` to a two-shot. R: camera (52.9, 39.7, −657.2) looking at (50.9, 39.2, −659.6). I: camera (61.6, 39.7, −655.2) looking at (60, 39.2, −657.6). Companion `Bandage_Loop` ×3, player `playScripted("Idle_Tired_Loop")`. The rope cuffs (procedural torus on `hand_l/hand_r`; **new**, none exist today) are removed, `player.bound=false`, then control returns. Save at step 1 happens before the shot.

**K6 imperial bluff** (the player keeps full control):
- `glide()` is not used. The scene plays in-world, with lines aimed at `eye`.
- At K6-I8 Ivo plays `Interact` with the paper prop on `hand_l`.
- After K6-I10: 4.0 s of silence, a tremor at 1.5 s (`shake(0.01, 1.5)` + dust), then K6-I11.
- The key is thrown as a physics item and lands at (52.4, 32.2, −656.0).
- **If the player damages the interrogator or the assistant between K6-I3 and K6-I13**: K6-IX1/IX2 and E2' starts (`outcomes.torture = "fought"`).
- If the player walks more than 12 m away, the scene finishes anyway and the key lands at Ivo's feet.
- On a bluff, the interrogator and assistant `walkPath` south through the cells to J and are removed there. His body is placed at the camp (§5.4).

**K12 standoff** (`canMove=false`, **look allowed**, ≤ 18 s)

| t (s) | Event |
|---|---|
| 0.0 | Off-screen shout (R0/I0). `lookToward(gal_entry_mouth + (0, 1.5, 0), 1.0)`. |
| 1.2 | Unchosen NPC + archer + soldier sprint in from `gal_entry_mouth` toward `bridge_n`. |
| 2.0 | Impact above: `sfx_rumble` + `sfx_rockfall` + `roar_c` low-passed. `shake(0.035, 2.5)`. Dust falls from the dome; 6 small Debris rocks. |
| 2.6 | The lead soldier steps onto the deck at z −727.5. The archer plays `Bow_Aim_Neutral`. |
| 2.8 | Crack. Slab released. `lookToward((48, 28, −731), 0.5)`. |
| 4.1 | Slab hits mid-span. Collider swap to **broken**. North 3.6 m becomes 6 Debris planks. The south part swings to −35°. The lead soldier plays `Hit_Knockback` → `LayToIdle` on the north ledge. `sfx_bridge_crash`. Music cuts to silence. |
| 4.8 | Splash particles, fog density bump for 3 s. |
| 6.5 | Standoff lines (about 11 s; the camera follows the speaker with `lookToward`). |
| ≈ 18 | Pursuers `walkPath` back to `gal_entry_mouth` and are removed. `canMove=true`. Two closing lines play while the player walks. |

### 5.3 Dialogue: `keep`
All lines are stored in `src/prologue/chapters/keepScript.ts` as `{id, who, text, branch?: "rebel"|"imperial"}`. `${name}` = `stage.appearance?.name || "朋友"`. Br: R = rebel route, I = imperial route.

**K0 两扇门**

| id | Br | Speaker | Line |
|---|---|---|---|
| K0-01 | – | 布伦 | 它又绕回来了——都别站在空地上！ |
| K0-02 | – | 书记官 | 正门锁着，钥匙在我身上。进了门，石墙能替我们挡火！ |
| K0-03 | – | 布伦 | 西墙根有道送柴的小门，帝国人从来懒得锁。${name}，跟我走！ |
| K0-04 | – | 书记官 | ${name}，跟一个叛军进门，出来的时候你就是叛军！ |
| K0-05 | – | 布伦 | 跟一个书记官进门，明早他就把你重新写进死人名单！ |
| K0-N1 | – | 布伦 | ${name}！这边！ |
| K0-N2 | – | 书记官 | 锁开了一半——${name}，过来！ |
| K0-N3 | – | 布伦 | 它在山那头转弯了，下一趟就冲着我们来！ |
| K0-N4 | – | 书记官 | 别站在空地上！龙最先看见的，就是会动的东西！ |
| K0-N5 | – | 布伦 | 我数到十就关门——一……好吧，我不会数到十。快！ |
| K0-N6 | – | 书记官 | 今早的名单是我念的——让我还你一条命！ |
| K0-P1 | – | (nearer NPC) | 回来！那边全是火！ |
| K0-R1 | R | 布伦 | 好！霜誓军记得住，谁在火里站到了我们这边。 |
| K0-R2 | R | 书记官 | ……随你吧。但愿你别后悔。 |
| K0-R3 | R | 书记官 (going through the gate) | 将军！有人看见维罗将军吗？！ |
| K0-I1 | I | 书记官 | 谢谢你……肯信一个早上还在念死人名单的人。 |
| K0-I2 | I | 布伦 (distant) | 那就各走各的路。下回见面，别指望我手下留情。 |

**K1 入堡**

| id | Br | Speaker | Line |
|---|---|---|---|
| K1-R1 | R | 布伦 | 有一年冬天，我在这儿替帝国人劈过柴。这扇门的闩，早让我撬松了。 |
| K1-R2 | R | 布伦 | 进去！快！ |
| K1-R3 | R | 布伦 (beam falls outside) | ……好，门也省得关了。龙进不来，帝国兵也别想从这儿进来。 |
| K1-R4 | R | 布伦 | 手伸过来。绳子勒了一整天，你的手该没知觉了。 |
| K1-R5 | R | 布伦 | ……好了。活动活动手指，待会儿要用。 |
| K1-I1 | I | 书记官 | 别出声……锁锈了……好了！ |
| K1-I2 | I | 书记官 | 进去——闩上！外头那东西可不会敲门。 |
| K1-I3 | I | 帝国守卫 | 站住！……书记官大人？您还活着！外面……外面还有人活着吗？ |
| K1-I4 | I | 书记官 | 比你想的少。去西边卫兵房看看，那道送柴的小门闩好了没有。 |
| K1-I5 | I | 帝国守卫 | 是、是！ |
| K1-I6 | I | 书记官 | 我们还没正式认识。伊沃·塔兰，雾门守备队的书记官。 |
| K1-I7 | I | 伊沃 | 今早那份名单……你的名字，是我添上去的。 |
| K1-I8 | I | 伊沃 | 手伸出来。这是守备队的绳结，我见过上百回，也解过上百回。 |
| K1-I9 | I | 伊沃 | 这一回，算我替早上那件事赔罪。远远不够，可总得有个开头。 |

**K2 装备**

| id | Br | Speaker | Line |
|---|---|---|---|
| K2-R1 | R | 布伦 | 那口箱子里，是帝国人从我们身上扒下来的东西。打开看看。 |
| K2-R2 | R | 布伦 (takes an axe) | 我爹的斧子……还以为再也摸不着了。 |
| K2-R3 | R | 布伦 | 架子上还剩一把剑、一把斧子。剑快，斧子沉——挑一把顺手的。 |
| K2-R4 | R | 布伦 (armour on) | 合身！穿着霜誓军的皮甲站在帝国的要塞里——我爹要是看见了，能笑上三天。 |
| K2-I1 | I | 伊沃 | 架子上有制式长剑，盾也拿一面……别看我，我握笔比握剑稳。 |
| K2-I2 | I | 伊沃 | 盾牌别嫌沉。真打起来，它比剑更能救命。 |
| K2-I3 | I | 伊沃 (armour on) | 守备队的皮甲，号码大了点。至少现在，没人会把你当成囚犯了。 |
| K2-F | – | 布伦 / 伊沃 | 接着！ |

**K3 初战 (E1)**

| id | Br | Speaker | Line |
|---|---|---|---|
| K3-R0 | R | 帝国守卫 (off-screen, barracks) | 兵器库那边有动静！ |
| K3-R1 | R | 布伦 | 有人来了——贴着门框，等他们进来！ |
| K3-R2 | R | 帝国守卫长 | 囚犯跑出来了！拿下！ |
| K3-R3 | R | 帝国盾兵 | 是铁桦！别让他跑了！ |
| K3-R4 | R | 布伦 (after) | 他们本来是看守，今天也成了笼子里的耗子。……这不是我想要的打法。 |
| K3-R5 | R | 布伦 | 守卫长腰上挂着钥匙串。搜一搜——东边储藏室的门得用它开。 |
| K3-I0 | I | 帝国守卫 (off-screen, G2) | 你们是——不、别——啊！ |
| K3-I1 | I | 伊沃 | 那是……刚才那个孩子。 |
| K3-I2 | I | 霜誓军头目 | 这边还有帝国的人！一个也别放过！ |
| K3-I3 | I | 霜誓军斧手 | 为了托尔瓦德！北境不跪！ |
| K3-I4 | I | 伊沃 (after) | 他们是跟着布伦摸进来的。……他们只是想活下去。可他们先拔的刀。 |
| K3-I5 | I | 伊沃 | 头目身上有钥匙串——是从那孩子身上抢的。储藏室的门得用它开。 |
| K3-I6 | I | 伊沃 (bars `g2_door`) | 卫兵房的门我顶上了。现在只剩一条路：往下走。 |

**Combat barks** (all human fights; at least 4 s apart per speaker)

| Speaker | Barks |
|---|---|
| 布伦 | 来啊，帝国佬！ · 盾再厚，重斧照样劈开！ · 他在蓄力——退开！ · 好一斧！ · 还站得住吗？ · taunt: 冲我来！ · downed: 还死不了！ |
| 伊沃 | 举盾！ · 等他砍空了再还手！ · 斧子来了——挡住！ · ……我居然还站着。 · shield wall: 我、我挡着——快喝药！ · downed: 我……我还能站起来。 |
| 帝国兵 | 以皇帝之名！ · 放下武器！ · 叛贼！ · 按住他！ · death: 啊……该死…… |
| 霜誓军 | 帝国的狗！ · 为了寒脊！ · 霜誓不灭！ · 砍了他！ · death: 领主……大人…… |

**K4 储藏室 / 营房**

| id | Br | Speaker | Line |
|---|---|---|---|
| K4-R1 | R | 布伦 | 红的那瓶是治伤药。喝下去像吞了块炭，可能救命。 |
| K4-R2 | R | 布伦 | 楼梯在里头。地牢在底下——我在那儿蹲过三天，熟。 |
| K4-I1 | I | 伊沃 | 军需簿上记着十二瓶治疗药水……看来有人先来过，就剩这几瓶了。 |
| K4-I2 | I | 伊沃 | 底下是地牢和审讯室。我只下去过两次，都是去登记死人的名字。 |
| K4-RF | R | 布伦 (30 s fallback, kicks the door) | 钥匙不要了？……算了，让开。 |
| K4-IF | I | 伊沃 (30 s fallback) | 等等……守备处的备用钥匙，我好像带着。……有了。 |
| K4-R3 | R | 布伦 (footlocker) | 一封没寄出去的家信……这些帝国兵，也是有娘的。 |
| K4-I3 | I | 伊沃 (footlocker) | 靠墙那张是我的铺位。床底下那封信，本来要寄回家的……你替我收着吧。 |

**K5 楼梯**: K5-R1 布伦: 它落在要塞顶上了……它在找东西。也可能是在找人。 · K5-I1 伊沃: 它停在楼顶上……听，像是在用爪子刨石头。

**K6 审讯室**

| id | Br | Speaker | Line |
|---|---|---|---|
| K6-01 | – | 审讯官 (through the door) | 最后问一遍。托尔瓦德的人藏在寒脊哪条山沟里？ |
| K6-02 | – | 女囚 | 去问山里的风吧。它知道的比我多。 |
| K6-03 | – | 审讯助手 (after the tremor) | 师傅！上头整座楼都在晃！我们……我们得撤了！ |
| K6-04 | – | 审讯官 | 撤之前，把笼子里的收拾干净。要塞失守，囚犯不留——这是规矩。 |
| K6-R1 | R | 布伦 (low) | 是卡雅……霜誓军的斥候。他们要杀了她。 |
| K6-R2 | R | 布伦 (`Kick` on the door) | 规矩？我来教教你北境的规矩！ |
| K6-R3 | R | 审讯官 | 铁桦？你本该在断头台上。——小子，拿家伙！ |
| K6-R4 | R | 布伦 (assistant surrendered) | 滚到墙角去。再让我看见你拿刀，就别怪我。 |
| K6-R5 | R/I-fought | 审讯官 (kneeling at 0 HP) | 我只问问题……不问旗号。帝国给钱，我就替帝国问…… |
| K6-R6 | R/I-fought | 审讯官 (dies) | 替我看看……外面的天还在不在。 |
| K6-R7 | R | 布伦 | ……死得太便宜他了。笼子的钥匙应该在他身上。 |
| K6-R8 | R | 卡雅 | 布伦·铁桦……我还以为今天早上你的脑袋已经落地了。 |
| K6-R9 | R | 布伦 | 差一点。多亏了这位朋友——还有一条龙。说出来你都不信。 |
| K6-R10 | R | 卡雅 | 龙？……难怪那帮帝国人吓得腿都软了。 |
| K6-R11 | R | 卡雅 | 牢房那边还关着我们的人。钥匙给我，我带他们从楼上找路出去。你们往里走——狱卒房后头有条老排水道。 |
| K6-R12 | R | 布伦 | 当心点，卡雅。活着回寒脊。 |
| K6-R13 | R | 卡雅 | 你也是，铁桦。还有你，陌生人——这份情，我记下了。 |
| K6-RD | R | 审讯记录 (optional, E 阅读) | ……本月共讯十七人。其中九人供词不实，已处置。 |
| K6-R14 | R | 布伦 | 十七个……里面有三个，我认得。 |
| K6-I1 | I | 伊沃 (low) | 那是奥斯维克，审讯官……他要杀了笼子里的人。 |
| K6-I2 | I | 伊沃 | 住手！ |
| K6-I3 | I | 审讯官 | 哟，书记官。不在桌子后面抄名字，跑到地牢里来做什么？ |
| K6-I4 | I | 伊沃 | 要塞守不住了。全员撤离，囚犯……就地释放。 |
| K6-I5 | I | 审讯官 | 谁的命令？ |
| K6-I6 | I | 伊沃 | 维罗将军的。 |
| K6-I7 | I | 审讯官 | 将军这会儿要么烧成了灰，要么正骑着马往南跑。我只问问题，不问旗号——你拿什么证明？ |
| K6-I8 | I | 伊沃 (holds out the paper) | 将军签过字的空白手令。书记官身上随时带着三张。 |
| K6-I9 | I | 伊沃 | 我现在就能在上面添一行字——"审讯官奥斯维克，临阵违令，就地处决。" |
| K6-I10 | I | 伊沃 | ……你想让我写吗？ |
| K6-I11 | I | 审讯官 (after 4 s of silence and the tremor) | ……好。好得很。这笔账我记着，书记官。 |
| K6-I12 | I | 审讯官 (throws the key) | 钥匙给你。想放就放——让这些耗子跟着要塞一块儿埋了吧。 |
| K6-I13 | I | 审讯官 | 小子，走！ |
| K6-I14 | I | 伊沃 (exhales) | ……那张纸是空的。将军从来没签过字。 |
| K6-I15 | I | 霜誓军斥候 | 一个帝国人……放我走？为什么？ |
| K6-I16 | I | 伊沃 | 今天我添了太多名字。不想再多添一个。 |
| K6-I16f | I-fought | 伊沃 (replaces I16) | 今天死的人，已经够多了。 |
| K6-I17 | I | 霜誓军斥候 | 我不会谢你。……但我会记住你的脸。我叫卡雅。 |
| K6-I18 | I | 卡雅 | 牢房里还有我们的人。钥匙给我。——你们去狱卒房后头的排水道吧。别跟着那个审讯官走，他那种人，走到哪儿都在给别人挖坑。 |
| K6-I19 | I | 伊沃 (hands over the ring) | ……拿去。别让我后悔。 |
| K6-IX1 | I | 审讯官 (player attacks) | 看来书记官的朋友更喜欢用刀讲道理。小子，拿家伙！ |
| K6-IX2 | I | 伊沃 | ……我本来想用一张纸解决的。 |

E2 barks:
- 审讯官: 别躲，我下手很轻的。 · 疼吗？这才刚开始。 · 叛军的骨头，也没多硬。
- 助手: 师傅救我！ · 别、别过来！ · surrender (≤ 30 % HP): 我投降！我只是给他烧火的！别杀我！

**K7 牢房** (optional; cut #2)

| id | Br | Speaker | Line |
|---|---|---|---|
| K7-01 | – | 老囚犯 | 门开着？……呵。开着又怎样。 |
| K7-02 | – | 老囚犯 | 我在这儿数过十一个冬天的雪——就从那个小窗口。外头早就没人记得我叫什么了。 |
| K7-R1 | R | 布伦 | 老人家，上头有条龙在烧城。待在这儿就是等死。 |
| K7-I1 | I | 伊沃 | 告诉我你的名字吧。我……我可以把它记下来。 |
| K7-I2 | I | 老囚犯 | 记下来做什么？念给墙听吗？ |
| K7-03 | – | 老囚犯 | 走吧，孩子们。这间牢房是我的，龙也拿不走。 |
| K7-R2 | R | 布伦 | ……北境的冬天，能把人熬成石头。 |
| K7-I3 | I | 伊沃 | 我抄过的那些名单里……大概也有过他的名字。 |

**K8 狱卒房 (E3)**

| id | Br | Speaker | Line |
|---|---|---|---|
| K8-R1 | R | 布伦 (whisper) | 嘘——那个狱卒背对着门，还在摆骰子。上头天都塌了，他倒是喝得沉得住气。 |
| K8-R2 | R | 布伦 | 蹲低，一步一步挪过去。等你站到他背后，再动手。 |
| K8-R3 | R | 布伦 (silent kill) | 干净。帝国人想砍你的头，真是瞎了眼。 |
| K8-R4 | R | 狱卒 (detected) | 谁？！……犯人跑出来了！ |
| K8-R5 | R | 布伦 | 被发现了——一起上！ |
| K8-I1 | I | 伊沃 (whisper) | 狱卒死了……有个霜誓军在翻他的箱子。他还没看见我们。 |
| K8-I2 | I | 伊沃 | 蹲下，从背后靠近。……我、我就在这儿看着。 |
| K8-I3 | I | 伊沃 (silent kill) | ……我从没见过有人杀人这么安静。你以前究竟是做什么的？ |
| K8-I4 | I | 霜誓军逃犯 (detected) | 帝国的追兵？！来啊！ |
| K8-I5 | I | 伊沃 | 动手！ |

**K9 排水道**

| id | Br | Speaker | Line |
|---|---|---|---|
| K9-R1 | R | 布伦 | 排水道的铁栅被人撬开过……有人先我们一步走了这条路。 |
| K9-R2 | R | 布伦 (tremor; collapse) | 退后——！ |
| K9-R3 | R | 布伦 | ……底下是空的。是岩洞。风是从那儿往上吹的。 |
| K9-R4 | R | 布伦 (takes a wall torch) | 有风，就有出口。火把我来拿，你看着脚下。 |
| K9-I1 | I | 伊沃 | 铁栅是新撬开的……奥斯维克走的就是这儿。也许还不止他。 |
| K9-I1f | I-fought | 伊沃 | 铁栅是新撬开的……有人先我们一步下去了。 |
| K9-I2 | I | 伊沃 | 小心——！ |
| K9-I3 | I | 伊沃 | 底下……是天然的岩洞。旧图纸上画过，我一直以为是工匠瞎画的。 |
| K9-I4 | I | 伊沃 (torch) | 我来举火把。至少这件事，我做得比你好。 |

**K10 营地 (E4)**

| id | Br | Speaker | Line |
|---|---|---|---|
| K10-Ra | R | 帝国士兵 (chatter) | 你说那东西会钻到这底下来吗？ |
| K10-Rb | R | 帝国盾兵 | 它那么大个，钻不进来。……应该钻不进来。 |
| K10-Rc | R | 帝国弓手 | 都闭嘴。听——上头又塌了一块。 |
| K10-Ia | I (bluff) | 霜誓军斧手 | 那个审讯官，叫得跟猪一样。 |
| K10-Ib | I (bluff) | 霜誓军斧手 | 早该有人给他放血了。可惜是在这种耗子洞里。 |
| K10-Ia' | I (fought) | 霜誓军斧手 | 托尔瓦德大人逃出去了没有？ |
| K10-Ib' | I (fought) | 霜誓军斧手 | 领主命硬，龙都烧不死他。 |
| K10-Ic | I | 霜誓军弓手 | 小声点。帝国的狗说不定还在后头追。 |
| K10-R1 | R | 布伦 (whisper; douses the torch) | 三个帝国兵，也是从要塞逃下来的。石台上那个拿着弓。 |
| K10-R2 | R | 布伦 | 绕到石台后面，先收拾弓手——剩下两个交给我们俩。 |
| K10-I1 | I (bluff) | 伊沃 (whisper) | 火堆边上……那是奥斯维克。他们杀了他。 |
| K10-I2 | I | 伊沃 (douses the torch) | 三个霜誓军，高处那个有弓。蹲低，绕到弓手后面……我数到三就冲。 |
| K10-R3 | R | 布伦 (after) | 就剩咱们了。……看，河对岸有座吊桥，被吊起来了。 |
| K10-I3 | I | 伊沃 (after) | ……他们是卡雅放出来的人。钥匙是我给她的。 |
| K10-ID | I (bluff) | 审讯记录 (E 搜查, on the body) | ……本月共讯十七人。其中九人供词不实，已处置。 |
| K10-I4 | I (bluff) | 伊沃 | 十七个名字。我会把它们带出去。 |

Alert barks: imperial soldiers 谁在那儿？！ · 要塞里的人追下来了——拿家伙！ Rebels: 帝国的狗追下来了！ · 一个都别放走！

**K11 拉杆**

| id | Br | Speaker | Line |
|---|---|---|---|
| K11-R1 | R | 布伦 | 链子从对岸一直牵到这根拉杆上。桥是从这边放的——拉它。 |
| K11-I1 | I | 伊沃 | 绞盘，拉杆——吊桥是从这边放的。你来拉吧，我的手到现在还在抖。 |
| K11-R2 | R | 布伦 (bridge lands) | 哈！修这座桥的人，比修要塞的靠谱。 |
| K11-I2 | I | 伊沃 (bridge lands) | 成了。……走，别在桥上停。 |
| K11-RF | R | 布伦 (60 s fallback) | 站着别动，我来拉！ |
| K11-IF | I | 伊沃 (60 s fallback) | 我、我来试试—— |

**K12 断桥**

| id | Br | Speaker | Line |
|---|---|---|---|
| K12-R0 | R | 帝国弓手 (off-screen) | 在那儿！吊桥那边！ |
| K12-R1 | R | 帝国弓手 | 长官，我射得中他们—— |
| K12-R2 | R | 书记官 | 放下弓。 |
| K12-R3 | R | 帝国弓手 | 可他们是叛军！ |
| K12-R4 | R | 书记官 | 我说，放下。……今天死在雾门镇的人，已经够多了。 |
| K12-R5 | R | 书记官 | ${name}。早上那份名单，你的名字是我后来添上去的。……往后，你的名字，得你自己去写了。 |
| K12-R6 | R | 布伦 | 这份情我记下了，帝国人。下回在战场上碰见，我让你先出手。 |
| K12-R7 | R | 书记官 | 但愿没有下回。——撤！回上面去，另找出路！ |
| K12-R8 | R | 布伦 | ……一个帝国的书记官。这世道，我是越来越看不懂了。 |
| K12-R9 | R | 布伦 | 走吧。这条河总得流到个有天的地方。 |
| K12-I0 | I | 霜誓军弓手 (off-screen) | 他们要过河了——追！ |
| K12-I1 | I | 霜誓军弓手 | 布伦，让我射死那只帝国耗子！ |
| K12-I2 | I | 布伦 | 住手。 |
| K12-I3 | I | 霜誓军弓手 | 他们差点砍了我们的头！ |
| K12-I4 | I | 布伦 (looks at the player) | 你旁边那位，今早也差点被砍了头。 |
| K12-I5 | I | 布伦 | ${name}。你跟错了人——不过，活下去。总有一天你会明白，北境该由谁来守。 |
| K12-I6 | I | 伊沃 | 铁桦！卡雅……她出去了吗？ |
| K12-I7 | I | 布伦 | 出去了。她说，有个帝国书记官放了她。……我起先还不信。——兄弟们，撤！ |
| K12-I8 | I | 伊沃 | ……我还以为，那支箭会射过来。 |
| K12-I9 | I | 伊沃 | 我们和他们之间，隔着一条河了。也好。往前走吧——岩洞总有个尽头。 |

### 5.4 Keep encounters

| id | Route | Hostiles and spawns (world) | Setup and behaviour |
|---|---|---|---|
| **E1** (hall ∪ G2: x 48.2…66, z −663.6…−654.2) | R | 帝国盾兵 (sword + kite shield) at (62.5, 38.13, −667.5); 帝国守卫长 (sword + kite shield) at (60.0, 38.13, −667.0). Both exit the barracks door 1.5 s after K3-R0. | Trigger: armour and weapon equipped, or the 45 s fallback. **Tutorial opponent** = 盾兵: the only enemy allowed to target the player for 30 s, wind-up 0.5×, damage ×0.8. Brun engages the 守卫长 at ×0.5 damage until the 盾兵 dies. After that it is 2v2. Retry marks: player (54.6, −657.0), Brun (53.6, −656.0). |
| | I | 霜誓军斧手 (axe) at (45.6, 38.1, −659.7); 霜誓军头目 (axe) at (45.6, 38.1, −658.4). Both come in through the postern → G2 → `g2_door` → hall. | Trigger: 6 s after the armour (K3-I0 scream), or 45 s. Tutorial opponent = 斧手. Ivo takes the 头目. Retry: player (60.5, −657.5), Ivo (61.5, −658.5). |
| **E2** (B3) | R; I if attacked | 审讯官 at (53.0, 32.13, −657.8) with dagger; 助手 at (54.0, 32.13, −655.6) with club | `ai.suspend` until K6-R3, or until the first player hit. The interrogator kites at 2–3 m and favours fast jab-cross (parry teaching). The assistant surrenders at ≤ 30 % HP. Retry: player (57.5, −656.4). |
| **E3** (J) | R | 狱卒 seated (`Sitting_Idle_Loop`) at (54.1, 32.13, −684.6), facing −Z | Hearing only until alerted. A backstab kills. If detected: a 1v2 fight, no fail state. |
| | I | 霜誓军逃犯 kneeling (`Fixing_Kneeling` loop 0.65–3.9 s) at (50.6, 32.13, −686.4), facing −Z; dead jailer at (52.5, −685.5) | Same |
| **E4** (gallery north ledge: x 38…60, z −721…−729) | R | 帝国士兵 (sword) sitting at `sitA`; 帝国盾兵 standing at `standB`; 帝国弓手 on `perch` | All start **unaware**; perception per §9. Backstab openers are allowed. One alert alerts all. The archer switches to a knife within 4 m. The companion climbs to the archer once the first melee enemy falls, or after 20 s. Retry: `cp_gallery`. |
| | I | 霜誓军斧手 ×2 (sitA, standB) + 霜誓军弓手 (perch). Bluff outcome: interrogator body at (51.0, 27.9, −724.8). | Same |

---

## 6. Chapter `exit` (出洞)

`id "exit"`, label 出洞, `seamless = true`. Calls `assets.setSegment("exit")` on prepare. Target length about 8 minutes.

### 6.1 Beat sheet

| Beat | ≈ Time | Trigger → content | Objective | Step after |
|---|---|---|---|---|
| X0 暗河 | 0:00–0:50 | Walk-and-talk from `gal_s_cp` toward the spider chamber. The companion leads with the torch. | 沿着河道深入岩洞 | – |
| X1 蛛巢 | 0:50–3:30 | Web A: the player cuts it with 3 hits of any attack or 1 heavy (60 s fallback: the companion cuts). Cocoon search (optional, hold E). Ambush: phase A, two small spiders from the burrows; phase B, the giant descends the chimney on silk over 1.6 s when both small are dead or after 20 s. Web B: the player cuts it. | 斩开蛛网 → 击败蜘蛛 → 斩开另一侧的蛛网 | **1** at `cp_spider` (fight retry), **2** at `cp_spider_done` |
| X2 狼穴 | 3:30–5:30 | Whisper briefing, sneak meter, stir at 0.5, wake at 1.0. Fight, flee (leash) or pass. Optional satchel. | 潜行绕过沉睡的巨狼（或与之一战） | **3** at `cp_den`, **4** at `cp_climb` |
| X3 长坡 | 5:30–6:40 | Climb (switchbacks, then the terraced rock stair from s 76). Wind bed from `climb_mid`. At `cp_light`: `setOutdoorVisible(true)`, sun blend begins. The companion stops at `bend` and lets the player go first. | 循着风找到出口 | – |
| X4 天光 | 6:40–8:10 | Within 2 m of `bend`, facing the mouth: `hud.flash(0.35, 2.0)` + exposure 1.6 → outdoor over 2 s. Platform: vista, bell, dragon finale, Lament reprise, closing lines, end card. | R: 前往溪谷的柳溪村，找到铁桦家的蜂场 / I: 随伊沃前往石桥堡 | **5** on the platform |

**X1 ambush timeline**:
- 0.0: trigger, within 6 m of `spider_c` (or 8 s after web A falls). Skitter sound.
- 0.6: companion bark.
- 1.0: small spider from `burrow_n`.
- 4.0: small spider from `burrow_s`. Music `music_spider`.
- Phase B: `lookToward(chimney, 0.6)`, giant drops on silk, `shake(0.015, 0.4)`, hiss, boss bar 洞穴巨蛛.

**X4 platform timeline** (`canMove=false` 0–12.5 s, look always allowed)

| t (s) | Event |
|---|---|
| 0 | Arrive within 3 m of (−15.0, −670.5). `lookToward(square + (0, 3, 0), 2.0)`. `stage.townFires.resume()` with 5 houses + tower + inn. `env.setMood(1)`. Wind bed. Line X4-1. |
| 2.5 | `audio/bell` tolls once, far off (gain 0.6). |
| 4 | `stage.dragons.pass(finale path)` from P0. |
| 7 | `wings` behind the player. The companion presses back to the rock (`Crouch_Idle_Loop`). |
| ≈ 11.5 | Dragon over the platform at P3: `shake(0.02, 1.5)`, dust gust, `lookToward(dragon, 0.6)` follows it. Line X4-2. |
| 12.5 | `canMove = true`. The companion stands. |
| ≈ 19 | Roar over the tower at P6. Line X4-3. |
| 21 | `playMusic("audio/music_cart", {fade: 6})`. |
| 23 → ≈ 68 | Closing lines (the companion faces the player; the player may walk the platform). |
| end | Toast, 4 s hold, `hud.fade(true, 2)`, `endCard()`. |

### 6.2 Dialogue: `exit` (stored in `exitScript.ts`)

**X0**

| id | Br | Speaker | Line |
|---|---|---|---|
| X0-R1 | R | 布伦 | 小时候，溪谷的老人讲过龙的故事。我一直当那是哄孩子睡觉的。 |
| X0-R2 | R | 布伦 | 故事里说，龙飞过的地方，连石头都会哭。 |
| X0-R3 | R | 布伦 | ……今天，我听见石头哭了。 |
| X0-R4 | R | 布伦 (at the fungus; cut with #1) | 这些发光的蘑菇，小时候我拿它们当灯笼。别吃——吃了你会看见死去的祖奶奶。 |
| X0-I1 | I | 伊沃 | 我在帝都念过史书。书上说，最后一条龙死在三百年前。 |
| X0-I2 | I | 伊沃 | 我在书记处抄了十年公文，从没有哪一份写过"龙"这个字。 |
| X0-I3 | I | 伊沃 | 要是书上写错了……那我这些年抄下来的东西，还有多少是真的？ |
| X0-I4 | I | 伊沃 | ……抱歉。我一紧张，话就多。 |

**X1**

| id | Br | Speaker | Line |
|---|---|---|---|
| X1-R1 | R | 布伦 | 蛛网……这么厚的网，可不是普通蜘蛛织得出来的。 |
| X1-R2 | R | 布伦 | 用刀砍开，别拿手扯。 |
| X1-I1 | I | 伊沃 | 这网有一人多高……我开始盼着书上写的全是错的了。 |
| X1-I2 | I | 伊沃 | 砍开它。我……我在后面给你照亮。 |
| X1-L | – | 信件 (cocoon search) | 北面山口有巨物掠过，翼展如帆，羊群尽失。驿站请示：可否上报？——批：勿传，免乱民心。 |
| X1-R3 | R | 布伦 | 半个月前就有人看见了。帝国把消息压了下来。 |
| X1-I3 | I | 伊沃 | 这是守备处的批文格式……这个字迹，是我们处长的。他早就知道。 |
| X1-R4 | R | 布伦 (phase A) | 墙缝里有东西——小的先来了！ |
| X1-R5 | R | 布伦 (phase B) | 上面！大的下来了！ |
| X1-I5 | I | 伊沃 (phase A) | 墙、墙里有东西在爬—— |
| X1-I6 | I | 伊沃 (phase B) | 头顶！它从上面下来了！ |
| X1-R6 | R | 布伦 (after) | 呸……我宁可再上一回断头台。 |
| X1-I7 | I | 伊沃 (after) | 我……我要把这个写进书里。用很大的字。 |

Spider barks:
- 布伦: 砍它的腿！ · 别让它扑到你身上！ · 呸！这玩意儿的血是绿的！
- 伊沃: 它要扑了——举盾！ · 火！它们怕火！ · 书上没写它们会跳！

**X2**

| id | Br | Speaker | Line |
|---|---|---|---|
| X2-R1 | R | 布伦 (whisper) | 嘘——蹲下。听见那喘气声没有？ |
| X2-R2 | R | 布伦 | 是头狼。个头赶得上一匹马，睡得正沉。我们的命，现在就挂在它的鼾声上。 |
| X2-R3 | R | 布伦 | 贴着左边的石壁走，慢点。别踩那些骨头。 |
| X2-I1 | I | 伊沃 (whisper) | 停……前面有东西在喘气。 |
| X2-I2 | I | 伊沃 | 狼……这么大的狼。我这把剑在它面前，就是根牙签。 |
| X2-I3 | I | 伊沃 | 贴着左边的石壁，蹲着走。轻点——求你了。 |
| X2-R4 | R | 布伦 (looking at the satchel within 10 m) | 那个包就在它鼻子底下……你真要去拿？ |
| X2-I4 | I | 伊沃 (same) | 那是猎人的背包。他大概……没能走出去。 |
| X2-R5 / I5 | – | 布伦 / 伊沃 (stir) | ……别动。 / ……别、别动。 |
| X2-R6 / I6 | – | (calm, < 0.2) | 好……它又睡了。走。 / 它……又睡着了。 |
| X2-R7 / I7 | – | (wake) | 醒了——别站在它正面！ / 你、你把它吵醒了！——散开！ |
| X2-R8 / I8 | – | (flee hint, 6 s after wake) | 往上跑！它不会离窝太远！ / 往上跑！它不会追出它的窝！ |
| X2-R9 / I9 | – | (passed unseen) | ……我憋了一口气，憋得眼前直冒金星。 / 我们过来了……我们居然过来了。 |
| X2-R10 / I10 | – | (killed) | 这身皮毛够做一件过冬的大氅。可惜，没工夫剥。 / ……从今往后，我再也不笑话猎人了。 |
| X2-R11 / I11 | – | (leashed) | 它回窝了。走，别回头！ / 它回去了……快走，趁它还没改主意。 |

**X3**

| id | Br | Speaker | Line |
|---|---|---|---|
| X3-R1 | R | 布伦 | 闻到没有？松脂味。是外面的风。 |
| X3-R2 | R | 布伦 | 从早上被扔上囚车起，我一直在想：要是能再看一眼天就好了。 |
| X3-R3 | R | 布伦 (at `bend`) | 你先走。是你一路把我们带到这儿的。 |
| X3-I1 | I | 伊沃 | 有风……是暖的。不——是烟。是镇子烧起来的烟。 |
| X3-I2 | I | 伊沃 | 出去以后，我得把今天的事一件件记下来。总得有人记下来。 |
| X3-I3 | I | 伊沃 (at `bend`) | 你先请。今天的头一口新鲜空气，该归你。 |

**X4**

| id | Br | Speaker | Line |
|---|---|---|---|
| X4-R1 | R | 布伦 | 雾门镇…… |
| X4-R2 | R | 布伦 (dragon overhead, whisper) | ……别出声。 |
| X4-R3 | R | 布伦 | ……它根本没低头看。在它眼里，我们跟石头没两样。 |
| X4-R4 | R | 布伦 | 领主大人是从塔楼另一头逃出去的，我亲眼看见。他会回寒脊……我得去找他。 |
| X4-R5 | R | 布伦 | 听着，${name}。顺着这道山脊往南，下到溪谷，有个村子叫柳溪。我爹的蜂场，就在村子东头。 |
| X4-R6 | R | 布伦 | 跟他说是布伦让你去的。他会给你一张床，一碗热汤……还有一杯溪谷最好的蜂蜜酒。 |
| X4-R7 | R | 布伦 | 在车上我说过，死前想再喝一口。现在看来——咱们得活着喝。 |
| X4-R8 | R | 布伦 | 还有……那个书记官要是也活着——算了。等我想好了，自己跟他说。 |
| X4-R9 | R | 布伦 | 去吧，朋友。从今天起，北境的天空不一样了。 |
| X4-I1 | I | 伊沃 | 诸神在上……整座镇子…… |
| X4-I2 | I | 伊沃 (dragon overhead) | 它……就在我们头顶上…… |
| X4-I3 | I | 伊沃 | 它连看都没看我们一眼。……对它来说，整座镇子不过是路过。 |
| X4-I4 | I | 伊沃 | 维罗将军要是还活着，一定会撤到石桥堡。龙回来了——这件事得由我亲手写，亲手送到。 |
| X4-I5 | I | 伊沃 | ${name}，跟我一起走吧。有我作证，没人会再把你押上刑台。 |
| X4-I6 | I | 伊沃 | 还有这个。 |
| X4-I7 | I | 伊沃 (unfolds the list; the stroke animates across the name) | 早上那份名单。你的名字是我添上去的……现在，我亲手把它划掉。 |
| X4-I8 | I | 伊沃 | 从今往后，你的名字只属于你自己。 |
| X4-I9 | I (`inv.letter`) | 伊沃 | 那封信……你还带着？留着吧。等到了石桥堡，我亲手寄。 |
| X4-I10 | I | 伊沃 | 布伦……他放过我们一次。我会在报告里写上这一笔——虽然不会有人爱看。 |
| X4-I11 | I | 伊沃 | 沿着山脚往东，顺着河走两天，就能看见石桥堡的塔楼。……走吧。 |

**Paper prop** (`DynamicTexture` 512×724 on a 0.21 × 0.30 m plane on `hand_l`):
- Heading: 雾门镇 · 今晨处决名单.
- Rows: 托尔瓦德·霜颌 寒脊领主 / 布伦·铁桦 溪谷人 / 罗文 山南人 / two filler names / handwritten `${name} ${homeland(a)}人 ——添`.
- At X4-I7 the stroke is redrawn progressively over 1.2 s.

**End card** (replaces PrologueStage.ts:285):
- 雾门镇 · 序章 · 完
- R: 你随布伦·铁桦逃出了雾门镇。北方，龙影未散。
- I: 你随书记官伊沃·塔兰逃出了雾门镇。你的名字，已从名单上划去。
- Summary line: 阵营 霜誓军/帝国 · 审讯室 {审讯官伏诛 / 一张空白手令 / 刀兵相见} · 巨狼 {未被惊醒 / 被击杀 / 从狼口逃生 / —} · 倒下 N 次
- 另一条路仍在等你：跟随{伊沃/布伦}
- Buttons:
  - **从要塞重玩（另一条路）** starts `keep` at step 0 with the same appearance and fresh flags, and K0 highlights the other NPC.
  - **返回主菜单**.
- Music: `music_cart` continues.

### 6.3 Exit encounters

| id | Hostiles and spawns | Behaviour |
|---|---|---|
| **E5 spiders** (chamber AABB x 9…27, z −757…−743; webs and leash keep them in) | 小洞蛛 ×2 at `burrow_n` and `burrow_s`; 洞穴巨蛛 down the chimney to `spider_c` | Approach (Spider_Walk, speedRatio = v/2.6) → circle 3–5 m for 1.5–3 s → bite or lunge → back off 1.5 m (Spider_Walk at speedRatio −1). Stagger is procedural (0.6 m push + 0.3 s wobble). Death: `Spider_Death`; corpses stay. At most 2 creature tokens on the player. Small spiders back off 1 s when within 2 m of the companion's torch. Retry: `cp_spider`. |
| **E6 wolf** (optional) | 巨狼 asleep on `wolf_bed`, facing `cp_den` | Sleep = `wolf_idle_01` looped 2.0–6.0 s, plus spine breathing ±2° at 0.25 Hz. **Stir** (meter ≥ 0.5): blend toward the Idle head-up pose at 0.3, growl (434049), companion whisper. **Wake** (meter ≥ 1.0, any damage, player within 2.0 m sneaking or 3.0 m otherwise, or a weapon clash within 12 m): stand-up segment 7.0–8.0 s → howl (380156) → fight. **Leash**: if its target is more than 18 m from the bed, or past `climb_s 23` (−33, −699), it snarls, walks back, and sleeps again after 20 s (`outcomes.beast = "fled"`). Aggro: last damager; switches to the companion 30 % of the time. Retry: `cp_den`. |

---

## 7. Encounter and companion behaviour summary

- **Tokens**: ≤ 2 on the player, ≤ 1 on the companion, re-evaluated at 2 Hz. E1 opening: 1 on the player for 30 s.
- **First wind-up aimed at the player** (once, `tips`): 0.4× slow motion for 0.5 s plus the tip 按住 右键 格挡.
- **Companion specials**:
  - **布伦 怒吼**: if an enemy has engaged the player ≥ 8 s, or player HP < 35 %, Brun forces that enemy onto himself for 6 s. Cooldown 15 s. Bark 冲我来！
  - **伊沃 盾墙**: if player HP < 30 %, Ivo steps between the player and the nearest attacker and blocks everything for 4 s. Cooldown 20 s. Bark 我、我挡着——快喝药！
- **Stealth zones** (J approach, camp approach, den): the companion crouch-walks at 0.9 m/s, stops when the player stops, and makes no noise (a deliberate cheat).
- **Torch**: the companion carries a wall torch on `hand_l` (`Idle_Torch_Loop`) from K9 to `cp_light`, holding pool slot 0. It is doused (slot 0 released) at K10 and X2 and relit afterwards.

---

## 8. Combat tuning

**Player**

| Stat | Value |
|---|---|
| HP | 100 (+15 with 林鹿护符). Out-of-combat regen 4/s after 6 s without damage. No regen in combat. |
| Stamina | 100. Regen 24/s after 0.8 s; 12/s while blocking. |
| Poise | 50, refills 2 s after the last hit. At 0: `Hit_Stomach` 0.5 s stagger. |
| Armour (damage multiplier) | 霜誓军皮甲 ×0.85 (rebel route, offence kit) · 守备队皮甲 ×0.80 (imperial route, defence kit) |
| Light chain (LMB) | `Sword_Light_A` (0.367 s, window 0.13–0.30) → `Light_B` (0.433, 0.20–0.27) → `Light_C` (0.867, 0.42–0.50, ×1.5). The next input buffers from 40 % of the clip; otherwise the `_Rec` clip plays, cancellable into block after 0.15 s. Movement ×0.3. |
| Heavy (hold LMB ≥ 0.30 s) | `Sword_Heavy_A` at 0.85× (window ≈ 0.51–0.62 s), then `_Rec` (cancellable after 0.4 s). Against a blocking target: **guard break** (target `Idle_Shield_Break` 1.07 s) and 50 % of the damage goes through. |
| Block (hold RMB = Mouse2) | `Sword_Block` frozen at 0.40 s, or `Idle_Shield_Loop` with a shield. Raised after 0.12 s; covers ±70° in front; move speed 1.6 m/s. Damage taken ×0.30 (weapon) or ×0.10 (shield). Stamina cost raw × 0.8 (weapon) or × 0.5 (shield). At 0 stamina: guard break, `Hit_Chest` 0.8 s, and the remaining damage applies. |
| Parry | Block pressed ≤ 0.18 s before the hit lands: 0 damage, 0 stamina, attacker staggers 1.1 s (`Hit_Head`), spark + clang + 90 ms hit-stop. The player's next hit within 1.1 s does ×1.5. **Not parryable**: arrows, Kick, wolf pounce. |
| Sneak attack | Unaware humanoid hit from behind (±60° of its back): **one-hit kill** (`Death02`). Wolf asleep: ×2, and it wakes. Suspicious target: ×2. |
| Potion (Q) | +50 HP over 1.5 s. `Consume` 1.33 s at ×0.5 speed, no attack or block, 3 s cooldown. Critical-path supply: 3 (leader 1 + storeroom 2). |
| Death | Encounter reset (§3.5); adaptive after 2 deaths. |

| Weapon | Light (A/B · C) | Heavy | Reach | Arc | Poise damage (L/H) | Stamina (L/H) |
|---|---|---|---|---|---|---|
| 铁剑 (FPM Sword_Bronze, retinted steel) | 14 · 21 | 30 | 1.8 m | ±55° | 15 / 50 | 8 / 24 |
| 战斧 (`ph/wooden_axe_03`; clips at 0.9×) | 16 · 24 | 36 | 1.6 m | ±45° | 20 / 65 | 9 / 26 |
| 拳头 (fallback only) | 4 · 6 | 8 | 1.1 m | ±40° | 5 / 15 | 5 / 15 |
| 鸢盾 (`ph/kite_shield`, imperial kit) | – | – | – | – | – | – |

**Enemies.** All human wind-ups play at **0.6× up to the hit frame** with a glint and a grunt, then 1×. Light = `Sword_Regular_A` (hit 0.24 s, about 0.40 s tell) → `B` (hit 0.27). Heavy = `Sword_Heavy_A` (hit 0.45, 0.75 s tell).

| Archetype | Used in | HP | Poise | Light / heavy | Special | Block | Interval |
|---|---|---|---|---|---|---|---|
| 帝国盾兵 (sword + kite) | R E1, R E4 | 70 | 40 | 10 / 18 (25 %) | **The shield absorbs 45 % of player lights** (0 damage, chain interrupted) → teaches heavies | heavies break it | 1.8–2.6 s |
| 帝国守卫长 (sword + kite) | R E1 | 90 | 55 | 12 / 22 (every 3rd) | – | 50 % | 1.8–2.4 |
| 帝国士兵 (sword) | R E4, R K12 | 60 | 35 | 10 / 18 | – | 20 % | 1.6–2.4 |
| 霜誓军斧手 (axe) | I E1, I E4 | 65 | 35 | 12+12 combo / – | **Lunge** `Sword_Dash_RM` from 4–6 m, 16 damage, cooldown 6 s, parryable → teaches parry and punish | 10 % | 1.4–2.0 |
| 霜誓军头目 (axe) | I E1 | 85 | 50 | 13 / 24 | lunge | 15 % | 1.5–2.1 |
| 审讯官 (dagger) | R E2, I E2' | 75 | 30 | `Punch_Jab`→`Punch_Cross` 7+7 | `Kick` 12 + 1.5 m knockback (not parryable) | 0 | 1.3–1.9 |
| 审讯助手 (club) | E2 | 40 | 15 | `Sword_Attack` 8 (hit 0.40) | surrenders ≤ 30 % HP | 0 | 2.4 |
| 狱卒 / 霜誓军逃犯 | E3 | 55 | 30 | 9 / 16 | – | 10 % | 2.0 |
| 弓手 (either faction) | E4 | 45 | 15 | Arrow 10 at 35 m/s. Draw 1.2 s with a glint at 0.6 s. The shield negates it within a 70° cone; a weapon block takes ×0.5. | Knife 6 (`Punch_Jab`) within 4 m | – | 3.0–4.0 |
| 小洞蛛 ×2 (scale 0.55) | E5 | 30 | 20 | Bite 8 (`Spider_Attack` at 0.7×, hit 0.40 → 0.57 s tell, reach 1.4) | Lunge 10 (`Spider_Jump`, hit 0.52, 3–5 m, cooldown 5) | – | 1.6–2.2 · 3.2 m/s |
| 洞穴巨蛛 (scale 1.0, about 2.6 m span) | E5 | 150 | 100 (only heavies and parries stagger it) | Bite 16 + venom 2/s × 4 s (reach 2.2) | Lunge 20 (4.5 m, cooldown 6) | – | 2.0–2.6 · 2.6 m/s |
| 巨狼 (0 A.D. ×1.5 of a real-world wolf, 0.45 m per unit; baseline per §0 #7's note) | E6 | 140 | 80 | Bite 18 (`Attack1` at 1.25×: hit ≈ 0.76 s; reach 2.4, ±50°) | Pounce 24 (Run ≤ 1.2 s → `Attack2` hit ≈ 0.80 s; knockdown unless shield-blocked; cooldown 6; run 7 m/s) | – | 2.2–2.8 |

**Companions** (essential; down at 0 HP, kneel 6 s, rise at 50 %):
- 布伦: HP 200, axe 11 per hit, 70 % hit chance, interval 1.8–2.4 s, block 25 %.
- 伊沃: HP 200, sword 8 per hit, 60 % hit chance, interval 2.2–3.0 s, block 55 %.
- In E1 both deal ×0.5 to their target for the first 30 s.

**Time-to-kill check**:
- 铁剑 vs 帝国盾兵 (70 HP, 45 % of lights absorbed): about 2 heavies + 2 lights. With Brun splitting the enemies, E1 lasts about 30–50 s.
- A soldier's light deals 8.5 to the player in rebel armour, so the player survives 12 hits.
- Wolf: 140 HP is about 4 heavies plus lights; its bite deals 15–16 after armour, so 6 hits kill the player.

**Teaching ladder** (each tip once, recorded in `flags.tips`)

| Mechanic | Introduced | Reinforced | Tested |
|---|---|---|---|
| Light / heavy / block | E1 (tutorial opponent) | E2 (R) / E4 | spiders, wolf |
| R lesson: heavy breaks guard | E1 盾兵: tip 盾兵挡得住轻击——按住左键 重击可以破防 | E4 盾兵 | – |
| I lesson: parry and punish | E1 斧手 lunge: tip 斧手会突进——看准时机格挡招架，再趁其踉跄反击 | E4 斧手 | spider bites |
| Parry | first block: tip 在对方出手的一瞬间格挡＝招架，可令其踉跄 | E2 jab-cross | spiders, wolf |
| Stamina | tip at stamina < 25: 耐力不足时无法重击，格挡也更容易被破 | E2 | wolf |
| Potion | storeroom: tip 按 Q 饮用治疗药水 | E4 | E5, E6 |
| Sneak + backstab | E3: tip 按 C 潜行（设置中可改为切换）· 从背后接近未察觉的敌人，左键一击制敌 | E4 opener | wolf: tip 潜行时脚步最轻；走动会惊动它，奔跑会吵醒它 |
| Ranged | E4: tip 弓箭无法招架——举盾，或躲到石柱后面 | – | – |
| Draw | weapon pickup: tip R 拔出/收起武器; first draw: tip 左键 轻击（连按连招）· 按住左键 重击 | – | – |

---

## 9. Perception and stealth

**Humans**
- Sight cone 110° when unaware, 160° when alert. Range 15 m indoors and in the cave. Eye height 1.6 m → target chest 1.2 m, checked with `rayCastStatic`.
- Sight rate per second = (1 − d/15) × light (0.5 if the light at the player < 0.2, else 1) × (0.35 if sneaking) × (1.3 if moving).
- Hearing (NoiseBus):

  | Noise | Radius |
  |---|---|
  | Sneak-move | 2 m |
  | Walk | 8 m |
  | Run | 12 m |
  | Sprint | 16 m |
  | Landing | 8 m |
  | Weapon clash | 20 m |

  Rate = (1 − d/r) × 0.9 per second. Decay −0.15 per second.
- Thresholds: ≥ 0.5 **suspicious** (turn, investigate the last noise); ≥ 1.0 **alert** (shout; allies within 15 m become alert).
- The HUD eye shows while sneaking or whenever awareness > 0.

**Wolf** (noise only): dm/dt = Σ wᵢ·clamp(1 − d/rᵢ, 0, 1) − 0.10.

| Source | Radius | Weight |
|---|---|---|
| Sneak-move | 3 m | 0.25 |
| Walk | 9 m | 0.6 |
| Run | 14 m | 1.0 |
| Sprint | 20 m | 1.6 |
| Swing or clash | 20 m | 1.5 |
| Potion | 4 m | 0.3 |
| Pick-up (satchel) | 4 m | 0.5 |
| Bone step (one-shot) | – | +0.35 |
| Companion | – | 0 |

Check on the den path (closest approach 5.5 m):
- Sneaking never wakes it.
- Walking past at 6 m gains about +0.1/s and reaches stir at around 0.6, which is a warning, not a wake.
- Running wakes it in about 2 s.
- Picking up the satchel (2.1 m away) adds about +0.27 over `PickUp_Kneeling`. It stirs if the player was already noisy.

---

## 10. Required assets

Every new id goes into `tools/fetch-extra.mjs` and `tools/credits-extra.mjs`. New Poly Haven slugs go into `tools/sources.mjs` and the hard-coded `phIds` list in `build-assets.mjs` (around line 387).

### 10.1 Geometry and textures
| Asset | Source (verified) | Segment |
|---|---|---|
| `keep/interior` (+ `_col` + anchors) | procedural, `tools/gen/keepinterior.mjs` | keep |
| `cave/mesh` (zones A–E), `cave/anchors.json`, outcrop | procedural, `tools/gen/cave.mjs` (port of v4) | keep (A), exit (B–E) |
| `fx/water_n` | procedural, `tools/gen/watertex.mjs` (integer-wavevector sines) | keep |
| `fx/webs` atlas (orb, corner, sheet, cocoon wrap) | procedural SVG → sharp → KTX2 `colorHQ` (`webtex.mjs`) | exit |
| Procedural props (`tools/gen/procprops.mjs`, with a new `torus()` in `shapes.mjs`): lever + winch + pulley, drawbridge (3 collider states), prisoner cage, cell bars, shackles and chains, rope cuffs, recurve bow (tube + string), wall-torch prop, slab, bones, straw beds, broken drain grate | own code | keep / exit |
| Textures, PH CC0 1k Diffuse/nor_gl/arm: `stone_brick_wall_001`, `rock_tile_floor`, `dark_wooden_planks`, `weathered_planks`, `rock_face_03`, `rocks_ground_08`, `ganges_river_pebbles`, `mossy_rock` (last 25 m of the climb and the outcrop) | api.polyhaven.com | keep / exit |
| Reused textures: `castle_wall_slates`, `old_planks_02`, `rusty_metal_02` | existing | – |
| Optional textures, cut first: `roots` (den), `dark_rock_02` (spider) | PH | exit |

### 10.2 Props
- **Quaternius Fantasy Props MegaKit [Standard]**, CC0 (`License_Standard.txt`), itch upload **13887750**. Download with ranged zip extraction (`research/itch_zipget.mjs`).
  - Models: Sword_Bronze, Chest_Wood (animated `Chest_Open`), WeaponStand, Peg_Rack, Potion_2, Shelf_Small_Bottles, Bed_Twin1, Table_Large, Bench, Chair_1, Stool, Barrel, Crate_Wooden, Torch_Metal, Lantern_Wall, Cauldron, Chain_Coil, Key_Metal, Scroll_1, Book, Bag, Pouch_Large, Dummy.
  - Merge everything into **one** kit GLB with the 4 trim sets at 1024 KTX2.
  - Retint the `_Vertex` COLOR_0 to steel. Strip or whiten COLOR_0 on materials not named `_Vertex` (37 models would otherwise render near-black). Add `occlusionTexture` = ORM R. Mute the palette with k ≈ 0.8.
- **Poly Haven CC0**: `wooden_table_02` (new, 196 tris), `stone_fire_pit` (new), `rock_face_02` (new, outcrop brow). Existing: `kite_shield`, `wooden_axe_03`, barrels, crates, buckets, `boulder_01`, `rock_face_01`, `rock_moss_set_01/02`.
- **Optional (cut #1)**: Quaternius Stylized Nature MegaKit, CC0, upload **11055123**: `Mushroom_Common`/`Mushroom_Laetiporus` with an emissive tint.

### 10.3 Characters and creatures
- Clips: §3.4 (`chars/anim_combat`, keep segment).
- **Spider**: Quaternius **Easy Enemy Pack**, CC0, `itch("https://quaternius.itch.io/animated-easy-enemies", 1254673)`.
  - Use `FBX/Spider.fbx` and convert FBX → glb with **assimpjs**, which becomes a devDependency.
  - Fixes: strip `HumanArmature|`, drop `FB_ngon_encoding`, normalise the ×100 scale, force OPAQUE with alpha 1.
  - Clips: Spider_Idle 4.17, Walk 0.83, Attack 0.75 (hit 0.40), Death 1.04, Jump 0.71 (hit 0.52).
  - Body colours: giant black, small brown.
  - Write the LICENSE note by hand; the zip has none.
- **Wolf**: **0 A.D. wolf**, Wildfire Games, **CC BY-SA 3.0**. Base URL `https://raw.githubusercontent.com/PhantomMatthew/ZeroAD-Godot/main/godot/assets/animations/quadraped/`.
  - Files: `wolf_{walk,run,attack_01,attack_02,idle_01,idle_02,death_01}.glb`. Use a **clip glb as the base**, not `meshes/skeletal/wolf.glb`.
  - Texture `animal_wolf_grey.png` from `0ad/0ad/master/binaries/data/mods/public/art/textures/skins/skeletal/`.
  - Re-base clip times. `idle_01` lie loop is 2.0–6.0 s, stand-up 7.0–8.0 s.
  - The credit **and a share-alike notice** are required. If the mirror disappears, fall back to the upstream `.dae` files.
- *As built* (`tools/gen/creatures.mjs`; see Appendix "Pipeline outputs", Creatures):
  - Assets `creatures/spider`, `creatures/wolf` and the optional `creatures/wolf_fur_brown`.
  - Every wolf clip is rotation-only. The lying and dying clips and the bite (`Attack1`) are fitted to the ground.
  - `wolf_idle_01` ships as `LieDown` / `Sleep` / `StandUp`.
  - The spider walks at 1.305 m/s at rate 1, not 2.6.

### 10.4 Audio
All Freesound sounds are CC0 and were checked live: page licence, uid, and HQ preview HTTP 200. Previews are already downloaded in `/tmp/claude-0/research/fs/` as `fs_{id}_{uid}-hq.ogg`. The `FS` array and credit lines are ready in `/tmp/claude-0/-home-user/723fb141-388f-585a-9830-e42e4105f74b/scratchpad/snippet.txt`. **Loudnorm flattens everything, so per-cue runtime gain is required** (footsteps 0.25, drips 0.3, torch 0.4, ambience beds 0.35).

| Cue id | Source (id/uid, trim) | Used in |
|---|---|---|
| `sfx_swing_1..3` | 840716, 840717, 840715 / 18136826 | all melee |
| `sfx_swing_heavy` | 367182/5065048 | heavies |
| `sfx_hit_flesh_1..3` | 547042, 547036, 547035 / 7614679 | sword hits |
| `sfx_hit_axe` | 522091/11537497 layered with 452554/612689 | axe hits |
| `sfx_block_1..3`, `sfx_parry` | 616493, 616495, 616494 / 702542; 326867/4077311 | block, parry |
| `sfx_shield_hit` | 636102/11705708, 372877/6944346 | shield blocks |
| `sfx_draw`, `sfx_rope_cut` | 577619/13023338 (full; and a 0.6 s trim) | draw, K1 |
| `vo_pain_1..4`, `vo_death_1..3` | 547203, 547202, 547201, 547200; 547182, 547181, 547189 / 129727 | humans |
| `vo_attack_1..5` | 474651/9250976 takes [0–0.62] [1.29–1.73] [2.41–2.74] [3.50–4.17] [4.66–5.18] | humans |
| `sfx_bodyfall` | 504626/4437257 | deaths |
| `steps_stone_1..10`, `steps_mail_1..3` | 517122, 517121, 517125, 517137, 517136, 517135, 517134, 517117, 517124, 517123 / 5026978 (skip 517126); 384881, 384882, 384887 / 984733 | interior and cave footsteps |
| `sfx_door_wood` | 452608/612689 [0.48–0.97], [11.09–11.81] | postern, doors |
| `sfx_lock`, `sfx_gate_slam`, `sfx_iron_gate` | 734641/13973196; 159552/71257; 207137/2568776 [0.41–1.48] | gate, cage, cell gate |
| `sfx_chest`, `sfx_pickup` | 771164/789424; 347174/6324381 | loot |
| `sfx_beam_crash` | 584891/13194852 [0.36–1.12] | K1 postern beam |
| `sfx_rumble`, `sfx_rockfall` | 712918/15139380; 381645/5486695 [0.32–3.70] + 567249/7108319 | tremors, K9, K12 |
| `sfx_lever`, `sfx_chain_mech` | 506146/1282624; 784229/9813501 (trim 8 s) + 199282/71257 (record "CC0 since 2026-07-30") | K11 |
| `sfx_bridge_crash` | 508546/5026978 [0.72–7.25] | K12 |
| `amb_torch` (loop), `amb_dungeon` | 637523/612689 (20 s); 530161/2683450 (60 s) | keep beds |
| `amb_cave`, `amb_drips`, `amb_stream`, `amb_cave_wind` | 553080/9250976; 609161/938246; 552485/9847211; 852822/18763192 (60 s) | cave beds, climb |
| `spider_hiss`, `spider_skitter`, `spider_attack`, `spider_death`, `sfx_web` | 459476/6232598 takes + 758900/15895934; 443723/7262854, 202108/3756348; 672710, 672712 / 14685597; 559621/8216881 + 515619/6769489; 659428/5287430 | E5, webs |
| `wolf_breath`, `wolf_growl`, `wolf_snarl`, `wolf_howl` | 122183/71257 (pitch 0.8); 434049/181941; 342204/3908740; 380156/2940947 | E6 |
| Existing: `roar_a/b/c`, `wings`, `bell`, `wind`, `burning`, `music_cart`, `music_tense` | – | K0, K12, X4 |

| Music id | Source | License |
|---|---|---|
| `music_fight` | RandomMind "Medieval: Battle", `https://opengameart.org/sites/default/files/battle_8.mp3` | CC0 |
| `music_explore` | RandomMind "Medieval: Exploration" (`assets-src/audio/Exploration.mp3` already present; **add the fetch line** for `Exploration_0.mp3` and the credit) | CC0 |
| `music_spider` | cinameng "Descent" (`descent.mp3`, 68.6 s loop) | CC0 |
| `music_beast` | Kevin MacLeod "Strength of the Titans" (`https://incompetech.com/music/royalty-free/mp3-royaltyfree/Strength%20of%20the%20Titans.mp3`). Credit exactly: `"Strength of the Titans" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 https://creativecommons.org/licenses/by/4.0/` | CC BY 4.0 |

**Gaps**: potion gulp and heartbeat have no researched CC0 source. Ship them silent until one is picked.

**Rejected**: craigsmith uploads 483228/483224; 336888 (mixes CC-BY sources); lendrick 77632–77637; 760636; 414167; 517126; 634775; 497193.

*As built* (`tools/gen/audio.mjs`; see Appendix "Pipeline outputs", Audio):
- Every cue above ships.
- The gaps are filled: `sfx_heartbeat` (146765) and `sfx_potion` (534336), both CC0, checked live.
- Additions: `wolf_death` (734841), `spider_chatter` (202108 as the nest bed), and `_2`/`_3` variants where a cue lists two sources or takes.
- Keep/exit one-shots are peak-normalised (−2 dBTP). Loops get one constant gain toward −18 LUFS, with an equal-power cross-fade and wrap padding.
- Each audio entry carries a manifest `gain`. One-shots keep the table gain above; loops' gains are corrected by measurement. The runtime multiplies it into its volume, instead of hard-coding one.
- The 11 keep/exit loops carry `loopStart`/`loopEnd`, which the runtime must apply.
- `music_spider` loops 39 bars (66.857 s): its last bar cross-fades into the first, which keeps the beat grid.
- Every audio source is pinned by sha256 (`tools/sources-audio.sha256`).

### 10.5 Audio by beat
| Beat | Music state | Beds | Key one-shots |
|---|---|---|---|
| K0 | `music_battle` (existing) | panic, wind | wings, roar_b, rockfall (crenellation) |
| K1–K2 | fade to none at the door | stop `wind` + `panic` (3 s); start `amb_torch` | door, rope_cut, chest |
| K3 E1 | `music_fight` | torch | combat set |
| K4–K5 | none | torch | chest, pickup, rumble |
| K6 | `music_tense` (low) → `music_fight` if a fight | `amb_dungeon` | door kick, iron gate, lock |
| K7–K8 | none | dungeon, drips | – |
| K9 | none | dungeon → cave | rumble, rockfall |
| K10 | none → `music_fight` on alert | `amb_cave`, `amb_stream` | – |
| K11–K12 | `music_explore` → **silence at the impact** | cave, stream | lever, chain_mech, bridge_crash, roar_c (low-passed) |
| X0 | `music_explore` | cave, drips | – |
| X1 | `music_spider` | cave | spider set, web |
| X2 | silence; `wolf_breath` loop; `music_beast` on wake | cave | wolf set |
| X3 | `music_explore` swells | `amb_cave_wind` from `climb_mid` | – |
| X4 | silence → bell → **`music_cart` reprise** | wind (restarted), burning (distant) | wings, roar_a |

### 10.6 Segments and budgets
- `keep` (prefetched during `dragon` at tier 2; `pos` hint [60, −662]): interior, cave A, anim_combat, FPM kit, interior textures, keep audio. Estimated start pack **≈ 8.4 MB** (limit 15).
- `exit` (prefetched during `keep`; `pos` hint [−10, −730]): cave B–E, spider, wolf, webs, `mossy_rock`, exit audio. **≈ 2.4 MB**, plus streamed music.
- **Keep step 0 needs no new assets.**
- *As built* (full build, 2026-10-06; brotli): keep start pack 8.63 MB, exit 1.29 MB.
  - `tools/build-assets.mjs` fails the build if keep's start pack is over 15 MB or exit's over 6 MB, or if an asset's segment is not in `SEGMENTS`.
  - It also fails if a shipped asset has no credits rule or lacks a credit it needs (§14 build gates).
  - See Appendix "Pipeline outputs", Audio.
- Frame budgets (GTX 1060 at 60 fps / Iris Xe at 30 fps on low):

  | Item | Budget |
  |---|---|
  | Visible triangles inside | ≤ 250k |
  | Draw calls | ≤ 150 |
  | Lights | fixed at 5 (2 pool slots on low) |
  | `CharacterVirtual` instances | ≤ 6 |
  | Ragdolls | ≤ 2 |
  | Brain / perception rate | 10 Hz / 5 Hz |
  | FireFx emitters per zone | ≤ 3 hero FireFx; sconces are sprites |
  | Outdoor world | hidden inside |

---

## 11. Checkpoints, resume, `skip()` and `dispose()`

Positions are world coordinates. Underground Y comes from anchors or keep-local values and is placed with `place3`.

**`keep`**

| Step | Player (pos, yaw) | Companion | World state |
|---|---|---|---|
| 0 | (60, 38.2, −648), 0 | brun (56, −649), scribe (60.5, −650.8) | Doors closed. Dragon circuit. Town fires. Outdoor. |
| 1 | R (52.0, 38.13, −658.8), 1.57 · I (60, 38.13, −656.5), 0 | R (50.6, −658.8) · I (60, −658.3) | Inside, entry blocked (R beam / I `blocker_gate`), **bound**, unchosen NPC removed, profile `hall`, outdoor hidden, dragon hidden |
| 2 | R (54.6, 38.13, −657.0), −1.57 · I (60.5, 38.13, −657.5), 1.57 | R (53.6, −656.0) · I (61.5, −658.5) | Unbound and geared (loadout filled if missing). E1 armed. |
| 3 | (62.0, 38.13, −657.5), −1.39 | (61, −659) | E1 bodies removed; keyring; potions ≥ 1; I: `g2_door` closed |
| 4 | (67.65, 32.13, −662.8), 3.14 | (68.5, −660.0) | Storeroom looted; profile `basement` |
| 5 | (55.5, 32.13, −660.5), 0.45 | (56.8, −660.8) | Cage open. Kaja, interrogator and assistant removed (body at the camp if bluff). `outcomes.torture` set. |
| 6 | (54.1, 32.13, −684.0), 0 | (55.2, −683.0), torch lit | E3 resolved; drain collapsed; ramp static |
| 7 | `cp_gallery` (51.0, 28.10, −714), −0.25 | (52.2, −713.0) | Profile `cave`; bridge **raised**; E4 armed |
| 8 | `lever_stance` (44.0, 27.95, −724.0), 0 | (45.5, −723.5) | E4 cleared; lever up |

**`keep.skip()`** (synchronous; cave colliders already built in `prepare()` via `ensureUnderground`):
1. `alive = false`; `stage.dragons.hide()`.
2. Faction ??= the NPC the player is facing, else `"rebel"`.
3. Fill the loadout. R: sword, armour ×0.85. I: sword + kite shield, armour ×0.80. `potions = max(n, 3)`, keyring, `bound = false`.
4. Despawn all `keep_*` AI, Kaja, gate guard, old prisoner, unchosen NPC, interrogator and assistant. Set `outcomes.torture ??= faction === "rebel" ? "killed" : "bluff"`.
5. Doors closed and blockers on; drain collapsed; bridge **broken** (collider swap, debris frozen); lever down.
6. Profile `cave`; outdoor hidden; beds `amb_cave` + `amb_stream`; music `music_explore`.
7. Teleport the player to `gal_s_cp` (47.5, 27.05, −738.5) yaw 0.20, and the companion to `comp_s` (49.2, 27.10, −739.0) with its torch.

**`exit`**

| Step | Player (pos, yaw) | Companion | State |
|---|---|---|---|
| 0 | `gal_s_cp`, 0.20 | `comp_s` | Bridge broken; webs intact |
| 1 | `cp_spider` (31.5, 27.70, −749.0), 1.57 | (33.0, −748.5) | Web A as per flags; E5 armed |
| 2 | `cp_spider_done` (12, 27.70, −749.5), 1.57 | (13.5, −749.0) | Spiders and webs removed |
| 3 | `cp_den` (−16.5, 31.55, −729), 2.45 | (−15.5, −730.2) | Wolf asleep, or removed if `beast === "killed"`; meter 0 |
| 4 | `cp_climb` (−28, 33.60, −709), 2.70 | (−27.0, −711.0) | Wolf per flags (a leashed wolf is back asleep) |
| 5 | platform (−15.0, 56.05, −670.5), −1.68 | (−17.6, 56.05, −672.0) | Outdoor + town fires + mood 1; replay X4 from the dragon cue |

**`exit.skip()`**:
- Remove the creatures, webs and the torch light.
- `beast ??= "skipped"`; `stage.dragons.hide()`; stealth HUD off.
- Outdoor on, town fires resumed, mood 1.
- Teleport to step 5. `PrologueStage` then shows the end card.

**`dispose()`** (both chapters):
- Destroy encounters (CapsuleMovers, ragdolls), interactables, zones and the chapter's pool claims.
- Stop chapter beds. Clear `hud.use`, `stealth`, `vitals`, `objective`.
- `ensureUnderground()` assets persist until the player returns to the menu.
- Neither chapter disposes the stage-owned dragon or town fires.

---

## 12. Soft-lock audit

| Situation | Mitigation |
|---|---|
| K0: player never chooses | No timer, nags, toast repeats; skip hidden (`canSkip` false) |
| K0: player wanders away | > 35 m: fireballs ahead + 回来！ · > 60 m: fade and return |
| K1: underground assets late | `hud.loading` + companion jiggles the latch until ready |
| K2: no weapon after 45 s | Companion tosses a sword (auto-equip) and armour |
| K4: leader's body unreachable (ragdoll) | 30 s → companion opens the storeroom (K4-RF/IF) |
| E1–E4: player dies | Encounter reset in place; adaptive difficulty after 2 deaths |
| K6 rebel: assistant surrenders | Counts as defeated; killing him later only sets `assistant = "killed"` |
| K6: cage key out of reach | 20 s → companion hands it over |
| K6 imperial: player leaves mid-bluff | Scene completes; key lands at Ivo's feet |
| E3: backstab detected | Small fight; no fail state |
| E4: archer perch | 0.4 m rock steps; the companion climbs after 20 s |
| Fall into the stream (any time) | Respawn plane → last bank, no damage |
| K11: lever never pulled | 60 s near the lever → companion pulls it |
| K12: companion stuck | 20 s → teleport to `comp_s` out of view; the collapse waits for both |
| X1: web not cut | 60 s → companion cuts it |
| X1: giant spider stuck | Leashed to the chamber; web B dissolves 120 s after E5 starts |
| X2: wolf | Leash 18 m / `climb_s 23`; essential companion; waking, killing, fleeing and passing are all valid |
| X3: stair | Risers ≤ 0.35–0.40 m (step-up 0.45) |
| X4: platform edge | Boulder lip + rails + respawn below y 50 |
| Resume anywhere | `flags.looted` prevents duplicate loot; every step has a full state table (§11) |
| Quicksave mid-fight | Saves the encounter's checkpoint step |

---

## 13. Fixes to earlier chapters (part of "优化前面的bug")

**Systems**
1. `SEGMENTS`: drop `"choice"` (manifest.ts:2).
2. `input.down()` reads mouse buttons; block = `Mouse2`; swallow the click that re-locks the pointer (Game.ts:65); sneak `ControlLeft` → `KeyC` with a toggle option.
3. `Character.play` one-shot offset (characters.ts:137): `offset = loop ? Math.random() : 0`.
4. `DragonChapter.dispose()` (dragon.ts:427–431) disposes FireFx and stops the flight: the fires pop and the dragon freezes at the seamless handover. Move both to stage ownership (§3.8). Also stop or hand over the `wind` bed: dragon.ts:231 starts it and dispose stops only `panic`.
5. `DragonChapter.skip()` doesn't place Brun or the scribe. Place them at their gate marks (step-0 table).
6. End card (PrologueStage.ts:285) still says 阵营选择、要塞与出洞将在之后的版本中开放. Replace with §6.2.
7. `FireFx` constructor always adds 2 PointLights (fire.ts:62). Replace with LightPool claims and fixed lights from boot.
8. `characters.mjs`: assert that requested clips exist (the Standard fallback silently drops 16), dispose the 63 orphan joints, and rebase root motion. (*As built:* `Sword_Block`'s −0.08 m root offset is compensated by its pose, so it is not a shift. It is kept, and the new sword clips are pinned at the same offset; see Appendix "Pipeline outputs".)
9. Foot sliding: normalise walk/crouch speeds to the native 0.95 / 0.6 m/s.
10. `execution.ts attachAxe` rotation `(0, 0, π/2)` puts the handle along the palm normal. Use `BoneSocket` with `(0, 0.7071, 0.7071, 0)`.
11. Credits and provenance:
    - fetch and credit `Exploration.mp3`;
    - delete the orphan `assets-src/textures/castle_brick_07`;
    - replace the craigsmith `collapse` (487142) and `collapse_small` (675900) sources with 508546 and 712918;
    - review the arrow (675821) and hooves (479790) sounds, which come from the same series.
12. Add `tools/check-lines.mjs`. It fails the build if any script or chapter string contains a banned phrase: 你总算醒了 · 越过边境 · 一条船上 · 北境真正的王 · 乌鸦 · 长桌 · 银阁 · 第二次机会 · 进塔楼 · 八条腿 · 趴下 · 飞走了 · 从背后给它 · 手痒 · 回头路 · 名单上没有这个人 · 遗物送回 · 认识过一个姑娘 · 帝国的城墙 · 灰鬃 · 维雷 · 卢西安 · 马雷克.

**Canon and labels**
- 灰鬃 → **铁桦** (muster.ts:97).
- 维雷将军 → **维罗将军** (execution.ts:136, 137, 142, 224).
- execution.ts:180 and :218: the scribe NPC speaks under the label 帝国士兵. Change the label to **书记官**.

**Line rewrites** (Helgen paraphrases → original). Line numbers refer to the current files.

| File:line | Current | Replacement |
|---|---|---|
| cartScript:33 | 嘿，你。你总算醒了。 | ……还喘着气？那就好。这一路颠得，我还以为你撑不过山口。 |
| cartScript:34 | 想偷偷越过边境，是吧？…… | 你是在山口林子里被逮住的吧？帝国那天撒了网，网里不止我们，还有那个偷马的。 |
| cartScript:35 | 该死的霜誓军。要不是你们闹事…… | 都怪你们这些发了誓的疯子。帝国满山搜你们，顺手把我这种小人物也兜了进来。 |
| cartScript:36 | 我本来已经偷到马了。…… | 那匹灰马都快被我驯服了，再给我一个晚上，我就过了河。 |
| cartScript:38 | 现在我们是一条船上的人了，贼。 | 绳子绑在你手上和绑在我手上，是同一个结，贼。 |
| cartScript:41 | 注意你的嘴。……北境真正的王。 | 说话放尊重点。那是托尔瓦德·霜颌，寒脊每座山头都认得这个名字。 |
| cartScript:42 | 托尔瓦德？霜誓军的首领？…… | 霜颌……那个在寒脊烧了帝国税仓的人？……连他都被捆上了车…… |
| cartScript:44 | ……前面等着我们的，多半是乌鸦。 | 不知道。不过看这条路的方向……他们没打算让我们走回来。 |
| cartScript:54 | 瞧，城墙上那个穿红披风的，是帝国的将军——卡西乌斯·维罗。 | 城墙上披红斗篷的那个，就是卡西乌斯·维罗。帝国派到北境的一把刀。 |
| cartScript:55 | 还有站在他身边的那几个精灵。银阁的使者。…… | 城门上又加了一道新闸。帝国这回是真想把我们关死在北境。 |
| cartScript:56 | 雾门镇。我年轻时在这儿认识过一个姑娘…… | 雾门镇……我头一回卖蜂蜜，就是在这儿的集市上。被人骗了个精光。 |
| cartScript:58 | 真奇怪。以前看到帝国的城墙，我还会觉得安心。 | 小时候我以为这道墙是用来挡狼的。现在才知道，它挡的是我们。 |
| cartScript:59 | 先祖在上，冬母在上……谁来救救我…… | 不……不……我只偷了一匹马……一匹马而已…… |
| muster:91 | 看来路走到头了。 | ……车停了。剩下的路，得自己走。 |
| muster:92 | 名单上的人，听到名字就上前一步。 | 念到谁，谁就到前面来。别让我念第二遍。 |
| muster:94 | 能和您一起走到最后，是我的荣幸，领主大人。 | 领主大人。不管今天怎么收场，我都不后悔跟了您。 |
| muster:104 | 不！我不是霜誓军！你们搞错了！我不能死在这儿！ | 我只是偷了一匹马！一匹马！你们不能为一匹马要我的命！ |
| muster:131 | 还有谁想跑？ | 下一个想试试弓手准头的，站出来。 |
| muster:139–140 | 等等。你。上前来。 / ……你是谁？ | 你。……这张脸，我没登记过。 / 报上名字。 |
| muster:149 | 队长，名单上没有这个人。怎么处理？ | 队长，这个人……名单上找不到。 |
| muster:150 | 别管什么名单。押去断头台。 | 那就添上。到了刑台底下，谁还查名单。 |
| muster:151 | 遵命……我们会把你的遗物送回${homeland}。 | (plays `Interact`, writing) ……${name}，${homeland}人。添上了。……对不住。我只管抄写，不管对错。 |
| muster:152 | 跟着队长走，囚犯。 | 去吧。队长在等。 |
| execution:136 | 寒脊的人把你当英雄，可英雄不会在谈判桌上拔刀。 | 托尔瓦德·霜颌。你烧了三座税仓、砍了两个督军，寒脊管这叫起义。帝国管这叫账。 |
| execution:137 | 你点燃的这场战争……今天，它在这里结束。 | 这笔账，今天在这块木墩上结清。 |
| execution:142 | 风声而已。继续。 | 山里的雪崩罢了。别停。 |
| execution:143 | 遵命，将军。女祭司，为他们送行。 | 是。女祭司，念吧——念短点。 |
| execution:146 | 在你们踏上最后的道路之前，愿众神垂怜，愿你们的灵魂—— | 愿你们在雪下安睡，愿你们的名字—— |
| execution:154 | 够了！要动手就快点，我受够了你们的神。 | 省省吧，女祭司。我的神不住在你们的庙里。动手吧。 |
| execution:156 | ……如你所愿。 | ……那就让雪替你祈祷。 |
| execution:161 | 替我向长桌旁的兄弟们问好。 | 你们记住我的脸。寒脊会来讨的。 |
| execution:180 | (label 帝国士兵) 又来了！你们听见没有？ | (label **书记官**) ……又是那声音。你们都没听见吗？ |
| execution:181 | 下一个！……那个不在名单上的。 | 下一个——名单最后添上的那个。 |
| execution:224 | 哨兵！哨兵，是什么—— | (label 维罗将军) 塔上的！看见什么了—— |
| dragon:283 | ……起来！快起来！诸神不会给我们第二次机会！ | ${name}！别躺着——再躺下去，就真起不来了！ |
| dragon:284 | 跟我来，进塔楼！快！ | 塔楼！石头墙烧不透——走！ |
| dragon:295 | 传说里的东西……它真的回来了。 | 我在寒脊听了一辈子的歌……没有一首说它会这么大。 |
| dragon:296 | 管它是什么，先活下来！上楼，从上面找路出去！ | 管它是什么，活下来再说！楼上有窗——往上爬！ |
| dragon:325 | 看见那家旅店没有？……我们随后就来！ | 对面旅店的房顶烧穿了——跳！我带领主大人从楼梯绕下去，咱们在楼下碰头！ |
| dragon:346–347 | 你还活着！ / 跟紧我，想活命就别掉队！ | ${name}？……你命真硬。 / 贴着我走，别离开三步以内。 |
| dragon:357 | 退后！贴着墙！ | 别动——等它把火喷完！ |

The muster rewrite **must** keep the scribe adding the name. K1-I7, K12-R5 and X4-I7 depend on it.

---

## 14. Prioritised implementation plan

Framework first. Each item lists its acceptance check.

**P0: Fixes and foundations**, which unblock everything
1. P0.1 `SEGMENTS`; P0.2 input (mouse `down`, `Mouse2`, swallow, `KeyC` + toggle, migration, new actions and pad mapping); P0.3 `Character.play` offset. *Check:* unit test of `input.down("block")` with `mouseButtons = 4`; Ctrl never bound by default.
2. P0.4 `stage.flags` in `PrologueSave`, `snapshotFlags`, `Chapter.canSkip`, hidden 跳过. *Check:* save/load round-trip in `tests/chain.mjs`.
3. P0.5 `DragonDirector` + stage-owned town fires + wind-bed handover + `DragonChapter.skip` placing the NPCs. *Check:* `tests/dragon.mjs` continuing into a stub `keep` shows no fire pop and a flying dragon.
4. P0.6 canon, labels and the §13 rewrite table (including the muster name-adding beat); P0.7 `check-lines.mjs`; P0.8 credits and provenance fixes; P0.9 foot-slide speeds.

**P1: Engine core** (`src/engine`)
1. P1.1 Physics: `rayCastStatic`, body registry + door tags, `TERRAIN_HOLES` (render skip + `cNoCollisionValue`), **`CapsuleMover` extracted; the player switched to it first** (*check:* `tests/jump.mjs` and the dragon chapter's inn jump still pass), `Debris`.
2. P1.2 Fixed 5 lights from boot, `maxSimultaneousLights = 5`, `LightPool`, FireFx `lights:0`, `Zones`, `setInterior`, `setOutdoorVisible`. *Check:* no shader compiles logged after load in any chapter.
3. P1.3 Animation pipeline: `anim_combat`, root-motion sidecar, asserts, orphan cleanup, `addClips`.
4. P1.4 `BoneSocket`, equipment, sheathing, finger override; `createPlayerBody(outfit)`; `playScripted`.
5. P1.5 Combat: `Vitals`, attack tables, `CombatSystem` (swept hit test, block/parry/poise/guard-break, tokens), `PlayerCombat`, armed third-person camera.
6. P1.6 HUD additions; `Interactables`; Director `bark` + hold-E skip.
7. *Demo check:* `?debug&arena` sandbox (flat floor + 2 humanoid dummies + 1 spider) for tuning. This doubles as the framework demo.

**P2: AI**
1. P2.1 `Perception` + `NoiseBus` + `BeastMeter`; P2.2 `HumanoidBrain` (archer, surrender, unaware, suspend); P2.3 `Creature` + `CreatureBrain` (spider, wolf); P2.4 `Companion` (breadcrumbs, combat, specials, torch, essential); P2.5 `Encounter` (reset/retry/adaptive).
2. *Check:* arena e2e. 2v2 resolves with no stuck NPCs for 120 s; death reset restores the snapshot.
3. **P2b Navmesh (non-blocking):** Recast TileCache worker + IndexedDB cache + crowd/CapsuleMover sync + off-mesh table + debug mesh. *Check:* town navmesh builds in < 1.5 s in a worker; partial-path detection is in place.

**P3: Content generation and assets**
1. P3.1 `keepinterior.mjs` + `buildKeep` edits (postern opening, remove the `dark` box, door leaves) + `KEEP_HOLE`.
2. P3.2 `cave.mjs` (port of v4): `anchors.json`, validator, zones, outcrop + `EXIT_HOLE`, water ribbon, webs, chimney, perch, terraced stair.
3. P3.3 `procprops.mjs` (lever, winch, bridge states, cage, bars, chains, cuffs, bow, torch, slab, bones, grate, paper prop).
4. P3.4 FPM kit merge (`propkit.mjs`) + Poly Haven additions; P3.5 `creatures.mjs` (spider via assimpjs, wolf merge); P3.6 audio fetch/trim/gain table + music + credits; P3.7 manifest segments, `pos` hints, size asserts.

**P4: Chapters**
1. P4.1 `keepScript.ts` / `exitScript.ts` (all of §5.3 and §6.2).
2. P4.2 `keep.ts` (K0–K12, encounters data, debug hooks); P4.3 `exit.ts` (X0–X4); P4.4 end card + replay of the other path.

**P5: Verification**
1. `tests/keep.mjs` and `tests/exit.mjs` (patterned on `tests/dragon.mjs`). For **both** branches:
   - drive by toasts and teleports;
   - debug hooks `stage.chapter.debugChoose("brun"|"scribe")`, `stage.combat.debugKillAll()`, `__game.stage.flags`, `?debug&chapter=keep&from=<step>`;
   - screenshot per checkpoint;
   - resume from every step;
   - `skip()` at every step reaches the next chapter or the end card with no console errors;
   - the bluff and fought variants of the imperial torture room.
2. Performance: FPS and draw calls per zone on WebGPU and `?webgl`, at low and high quality, against §10.6.
3. Build gates: cave validator, clip asserts, `check-lines.mjs`, manifest size, credits coverage (every new asset id has a credit; the CC BY-SA wolf includes its share-alike notice).

**Cut list** (apply in this order if the schedule slips):
1. Fungus and mushroom dressing.
2. Old prisoner (K7).
3. Barracks footlocker letter and X4-I9.
4. Archers become melee. Drop the bow and arrows; K12-R1/I1 become 长官，他们就在对岸—— / 布伦，让我追过去！
5. Gate guard. E1 imperial is triggered by timer plus an off-screen shout; K3-I1/I5 lose their reference to the guard.
6. Outcrop tunnel connection → white-out at `stub84` (no `EXIT_HOLE`).
7. Spider lunge and venom.
8. Wolf satchel and charm.
9. Adaptive difficulty tier 2.
10. Water ribbon → static dark plane.

**Never cut:** the input fixes, the E-prompt choice, both torture-room variants, the K12 standoff, the ending payoffs (mead line, name strike, Lament reprise), checkpoints and skip.

---

## 15. Source map

| Element | Source |
|---|---|
| Engineering backbone (segments, light set, anchors + validator, `CapsuleMover`, `BoneSocket`, breadcrumbs, `rayCastStatic`, wolf, budgets, cut list, verification) | tech |
| Choice pressure, warrant bluff, unchosen companion leading the pursuers, slab-caused collapse, mead and name-strike payoffs, the scribe's names motif, cocoon letter, rewrite table, balcony vista | cinematic |
| Faction-mirrored lessons, teaching ladder, tips, adaptive difficulty, soft-lock audit, companion specials, backstab tutorial, satchel risk/reward, letter variant, end-card replay hook, mercenary-interrogator lines (moved into the rebel fight) | gameplay / tech |
| Done fresh in this synthesis | v4 cave layout and anchors (re-measured); dragon-path and vista clearance checks; door/continuity redesign (main gate + postern, Brun's men as the imperial-route E1, interrogator body at the camp, drain pre-opened); Brun → 铁桦; scribe → 伊沃; dropped the 八条腿 and 趴下 lines |
---

## Appendix: Pipeline outputs

What the asset pipeline actually emits for these chapters, for the runtime integrator. Each unit adds its own subsection.

### Character animation (`chars/anim_*`)

Built by `tools/gen/characters.mjs`, which holds the clip lists and ids, and `tools/gen/animclips.mjs`, a game-agnostic module for picking clips, retargeting them, checking the clip contract and extracting root motion. Rebuild with `node tools/build-assets.mjs --only=chars/`. That rebuilds `chars/male`, `chars/female` and `chars/horse` too; they come out byte-identical.

| Manifest id | Type | Segment | Priority, `pos` | Raw / brotli | Content |
|---|---|---|---|---|---|
| `chars/anim_base` | glb | cart | 96 | 1.57 MB / 683 KB | The same 50 shipped clips in the same order. **Rebuilt, hash changed** only because the 63 orphan UAL2 joint copies are gone (129 → 66 nodes). Every channel of every clip, `Sword_Block` included, was compared key by key with the shipped file and is identical. |
| `chars/anim_combat` | glb | **keep** | 94, [60, −662] | 1.12 MB / 426 KB | The 44 new clips, 47.8 s in total. |
| `chars/anim_rootmotion` | json | **keep** | 94, [60, −662] | 6 KB / 1.3 KB | Root-motion curves for 14 clips. Load it with `loadJSON("chars/anim_rootmotion")`; the id has no `.json` suffix, like `cart/route`. |

**GLB structure** (`anim_base` and `anim_combat` are identical in layout):
- One scene. Its root node is `Armature` (identity transform). Under it is `root`, with rest rotation (−0.7071, 0, 0, 0.7071), then `pelvis` and the rest of the 65 joints of the character skeleton: `spine_01..03`, `neck_01`, `Head`, `clavicle/upperarm/lowerarm/hand_{l,r}`, the fingers `*_01..03` and `*_04_leaf`, and `thigh/calf/foot/ball/ball_leaf_{l,r}`.
- No meshes, skins or materials. It requires `EXT_meshopt_compression`.
- Each clip has 67 LINEAR channels: rotation on all 65 joints, plus translation on `root` and `pelvis`.
- The AnimationGroup name is the clip name. Clip names are unique across `anim_base` and `anim_combat`; the build checks this.
- `CharacterFactory.addClips(container)` only needs `for (const g of container.animationGroups) this.clips.set(g.name, g)`. `Character.group()` already retargets by node name.

**`anim_combat` clips** (seconds): Crouch_Bwd_Loop 2.000 · Crouch_Enter 0.833 · Crouch_Exit 0.833 · Crouch_Left_Loop 2.000 · Crouch_Right_Loop 2.000 · Hit_Shoulder_L 0.533 · Hit_Shoulder_R 0.500 · Jog_Bwd_Loop 0.933 · Jog_Left_Loop 0.933 · Jog_Right_Loop 0.933 · Kick 1.100 · PickUp_Table 0.833 · Punch_Cross 1.000 · Punch_Jab 0.867 · Push_Enter 0.667 · Push_Exit 1.200 · Push_Loop 2.667 · Sword_Attack 1.533 · Sword_Enter 1.300 · Sword_Exit 1.300 · Bandage_Loop 0.667 · Bow_Aim_Down 1.333 · Bow_Aim_Up 1.333 · Chest_Open 1.367 · Consume 1.333 · Farm_PickingTree 2.233 · Idle_Shield_Break 1.067 · Shield_OneShot 0.833 · Sword_Dash_RM 1.567 · Sword_Heavy_A 0.733 · Sword_Heavy_A_Rec 1.000 · Sword_Light_A 0.367 · Sword_Light_A_Rec 0.500 · Sword_Light_B 0.433 · Sword_Light_B_Rec 0.567 · Sword_Light_C 0.867 · Sword_Regular_A 0.433 · Sword_Regular_A_Rec 0.967 · Sword_Regular_B 0.533 · Sword_Regular_B_Rec 1.033 · SwordLight_C_Rec 0.700 · Walk_Bwd_Loop 1.333 · Walk_L_Loop 1.333 · Walk_R_Loop 1.333.

**`chars/anim_rootmotion` format:**
```json
{ "version": 1, "bone": "root", "space": "…", "keys": "[t, x, y, z, yaw]",
  "clips": { "Sword_Light_A": { "asset": "chars/anim_combat", "duration": 0.36667, "delta": [0, 0, 0.3143, 0],
                                "keys": [[0, 0, 0, 0, 0], [0.03333, 0, 0, 0, 0], [0.06667, 0, 0, 0.0251, 0], …] }, … } }
```
- **Space.** Character model space, which is the local space under the character's root TransformNode (the scene is right-handed, so there is no axis flip). The curve is taken in the root bone's parent space. The build asserts that every node above `root` (`Armature`) is an identity transform, so that this is model space. +Z is forward, +X is the character's left, +Y is up, in metres. `yaw` is in radians about +Y; positive turns +Z toward +X, a left turn. Every clip starts at `[0, 0, 0, 0, 0]` in its own start frame.
- **Keys.** These are the 30 fps source keys. Keys that linear interpolation already reproduces within 0.1 mm are dropped, so interpolate linearly. `t` is clip time; at `speedRatio` s, wall time is `t / s`. `delta` is the net motion at the end of the clip.
- **Runtime use** (§3.4). Each frame:
  1. Take Δ = curve(t₁) − curve(t₀), handling the clip end.
  2. Rotate (x, z) by the actor's current yaw.
  3. Feed Δ/dt to the `CapsuleMover` as velocity, clamped to 3 m/s and zeroed within 0.9 m of the target.

  In these clips the root bone holds a fixed translation (the pin, below) and its rest rotation. If the curve is ignored, an attack plays in place and does not teleport.

  **Watch the 3 m/s clamp.** Some lunges are much faster than 3 m/s at their peak:
  - `Sword_Dash_RM` moves 0.83 m in the single frame 0.200–0.233 s (25 m/s), and 2.8 m by 0.333 s.
  - `Sword_Heavy_A` peaks at 12.9 m/s around 0.50–0.53 s.
  - Light and Regular attacks peak at about 3.7 m/s.

  A hard per-frame clamp therefore shortens the travel. At 60 fps, `Sword_Dash_RM` drops from 3.69 m to 1.06 m and `Sword_Heavy_A` from 1.39 m to 0.97 m. Pick one of these:
  - carry the clamped remainder over to later frames;
  - clamp only the overshoot past the 0.9 m stop distance.
- **Entries:**

| Clip | Asset | Duration (s) | Net Δz (m) | Keys |
|---|---|---|---|---|
| `Sword_Light_A` | `chars/anim_combat` | 0.3667 | 0.3143 | 12 |
| `Sword_Light_A_Rec` | `chars/anim_combat` | 0.5 | 0 | 2 |
| `Sword_Light_B` | `chars/anim_combat` | 0.4333 | 0.3622 | 14 |
| `Sword_Light_B_Rec` | `chars/anim_combat` | 0.5667 | 0 | 2 |
| `Sword_Light_C` | `chars/anim_combat` | 0.8667 | 1.4178 | 27 |
| `SwordLight_C_Rec` | `chars/anim_combat` | 0.7 | 0 | 2 |
| `Sword_Regular_A` | `chars/anim_combat` | 0.4333 | 0.8245 | 14 |
| `Sword_Regular_A_Rec` | `chars/anim_combat` | 0.9667 | 0.3088 | 25 |
| `Sword_Regular_B` | `chars/anim_combat` | 0.5333 | −0.0526 | 17 |
| `Sword_Regular_B_Rec` | `chars/anim_combat` | 1.0333 | 0.3698 | 28 |
| `Sword_Heavy_A` | `chars/anim_combat` | 0.7333 | 1.3851 | 23 |
| `Sword_Heavy_A_Rec` | `chars/anim_combat` | 1 | 0.344 | 30 |
| `Sword_Dash_RM` | `chars/anim_combat` | 1.5667 | 3.6922 | 20 |
| `Sword_Block` | `chars/anim_base` | 1.2333 | 0 | 2 |

  - All x, y and yaw values are 0.
  - The zero-motion entries are kept so that "has an entry" means "the build pinned this clip's root".
  - `Sword_Block` is all zero, so earlier chapters do not need the keep-segment sidecar.
- **Root motion left in place.** `Turn90_L` and `Turn90_R` in `anim_base` still turn the root 90° inside the clip. This is unchanged; they are unused, and the build logs them. The other 31 clips in `anim_combat` are checked to be in place (root within 1 mm and 0.1° of rest).

**Root pin and footprints.** The root bone of a curve clip is pinned, not zeroed:
- `Sword_Dash_RM` is pinned at (0, 0, 0), because it starts at root 0 like `Idle_Loop`.
- Every other entry is pinned at (0, 0, −0.07584). This is the constant root offset that `Sword_Block` holds in UAL2 and that `Sword_Heavy_A` starts at. The build reads it from `Sword_Block`. The UAL2 sword set bakes a matching +7.58 cm forward offset into its pelvis and leg pose, and its `_Rec` clips end 7.6–7.9 cm ahead of the idle footprint relative to their root. At a pin of 0, all of them would stand 7.6 cm ahead of `Idle_Loop` and of the capsule.
- The pin does not change the curve. All clips of one chain share a pin, so chain joins are unaffected.

So every attack entry and exit stands on `Idle_Loop`'s frame-0 footprint, which `Sword_Idle` and `Idle_Shield_Loop` share. Idle ↔ attack, `_Rec` → Idle and Idle ↔ `Sword_Block` blends do not slide the feet. The build checks this with forward kinematics on the built files, as the horizontal offset of ball_l / ball_r from `Idle_Loop` frame 0:

| Pose | ball_l / ball_r (cm) | Note |
|---|---|---|
| `Sword_Block` at 0, at 0.40 s (held guard) and at the end | 0.2 / 0.0 | Identical to the shipped clip. |
| `Sword_Heavy_A`, `Sword_Dash_RM` start; `Sword_Dash_RM` end | 0.0 / 0.0 | |
| `Sword_Light_A` start | 5.9 / 0.3 | At frame 0 the left foot is already 5.9 cm into its step, as in the source. |
| `Sword_Regular_A` start | 1.2 / 1.0 | From the source: its root track sits about 1 cm off the rest of the set. |
| `_Rec` ends (Light A/B/C, Regular A/B, Heavy A) | ≤ 0.3 / ≤ 0.3 | Exception: `SwordLight_C_Rec` ends with the left foot 1.2 cm sideways. |

**Chain joins.** These are measured from the end of one clip to the start of the next, in capsule-local space, with the controller carried along the curve. The build logs every declared chain.
- **Seamless (≤ 0.5 cm):** Light_A → Light_A_Rec, Light_B → Light_B_Rec, Regular_A → Regular_A_Rec, Regular_B → Regular_B_Rec, Heavy_A → Heavy_A_Rec.
- **One frame apart:** Light_A → Light_B, Light_B → Light_C and Regular_A → Regular_B. UAL2 cut these pieces one frame apart, so fast joints jump by one frame of motion:
  - the right foot by 6.8 cm in Light_A → B;
  - the sword hand by 11.5 cm in Light_B → C and by 12.3 cm in Regular_A → B.

  Measured against a one-frame extrapolation, they join within 2.4–6.1 cm. The usual 0.1 s cross-fade hides this.
- **Pop: `Sword_Light_C` → `SwordLight_C_Rec`.** The source pose is discontinuous: the pelvis jumps 0.21 m (forward and 8 cm down), the left foot 0.18 m and the sword hand 0.42 m. Root-motion extraction cannot fix this; it is not a bug in the curve or the pin.
  - No frame of `Sword_Light_C` matches the first pose of `SwordLight_C_Rec`, and starting `SwordLight_C_Rec` later does not help.
  - The other exits are worse. At the body, `Sword_Light_B_Rec` is 0.66 m away and `Idle_Loop` 0.55 m.
  - **Cross-fade `Sword_Light_C` → `SwordLight_C_Rec` over at least 0.2 s (0.25 s recommended).**

**Build contracts.** The build fails if any of these is broken:
- Every requested clip exists exactly once in its source file.
- No clip is requested twice, and `anim_combat` does not repeat an `anim_base` clip.
- Every `ROOT_MOTION` clip produced a curve.
- `anim_combat` clips without a curve are in place.
- An extracted clip does not tilt the root.
- Every node above the root bone is an identity transform, and a pinned clip has a root translation channel to pin.
- `Sword_Block`'s root translation in UAL2 is constant, because the sword-set pin is read from it.
- **Footprints.** On the built files, the nearer foot of each pose in the table above is within 1 cm of `Idle_Loop` frame 0. A wrong pin moves both feet; a swing foot moves only one. Pinning at 0 fails with 6.4–7.9 cm.
- **Chains.** The clips of a declared chain share a pin. No join pops more than 0.1 m after allowing one frame of motion, except the joins listed in `CHAIN_POPS`. Today that is only Light_C → SwordLight_C_Rec.

Without `assets-src/chars/anim_full/UAL*.glb` the build now fails and tells you to run `node tools/fetch-extra.mjs`. Before, it silently shipped 16 fewer clips.

**Deviations from §3.4:**
- `PickUp_Table` is a UAL1 clip, not UAL2. It is taken from UAL1, and the count stays 44 (20 UAL1 + 24 UAL2).
- `anim_combat` is 426 KB brotli, not the ≈ 330 KB estimate. Attacks are fast, so resampling drops fewer keys: 8.9 KB/s here against 6.9 KB/s for `anim_base`. The keep start pack is still far under its limit.
- `chars/anim_base` had to change, but only for the orphan cleanup. Clip names, order and all clip data are the same, so runtime code is unaffected.
- §3.4 said to zero the root translation and called `Sword_Block`'s −0.08 m root a bug to fix. Both were wrong. The UAL2 sword pose compensates for that offset, and zeroing it put the feet 7.6 cm ahead of the idle footprint. The root is pinned at the offset instead (see "Root pin and footprints"). The curves are unchanged.

### Keep exterior, interior and terrain holes (`town/buildings`, `keep/interior`, `keep/anchors`, `cart/terrain`)

Built by `tools/gen/townbuildings.mjs` (`buildKeep`, `buildPosternLeaf`), `tools/gen/keepinterior.mjs` (self-contained: layout data, meshing, bake, validation, glTF) and `tools/gen/terrainHoles.mjs` (used by `tools/gen/terrain.mjs`). Rebuild with `node tools/build-assets.mjs --only=cart/terrain,town/buildings,keep/interior`; `--only` now takes a comma-separated list.

| Manifest id | Type | Segment | Priority, `pos` | Raw / brotli | Content |
|---|---|---|---|---|---|
| `keep/interior` | glb | **keep** | 95, [60, −662] | 2.36 MB / 2.08 MB | Rooms G1–G5 and B1–B5, the 10 cells, 5 door leaves, colliders, 100 anchor nodes. 37.8k render triangles. |
| `keep/anchors` | json | **keep** | 95, [60, −662] | 25 KB / 6 KB | Every anchor, door (the postern included), zone, blocker and room in keep-local **and** world coordinates. Load with `loadJSON("keep/anchors")`. |
| `town/buildings` | glb | muster | 96 (unchanged) | 3.75 MB / 3.67 MB (+0.14 MB) | The keep node changed (below); every other building is byte-for-byte the same geometry. |
| `cart/terrain` | glb | cart | 100 (unchanged) | 1.62 MB / 1.03 MB | `terrain_4_1` lacks the 96 quads (2 m grid) of `KEEP_HOLE.render`. Manifest field `_holes: ["keep"]`. |

**Frame.** Everything in `keep/interior` is in the keep-local frame of `buildKeep`: +X east, +Y up, −Z north, origin on the keep base at its centre. World = (60 + x, 37.73 + y, −662 + z). The ground-floor top is local 0.4 (world 38.13); the basement floor is local −5.6 (world 32.13). **Parent the GLB's root `keep_interior` under the keep holder** (`town.keep`, placed at `heightAt(60, −662) − 0.2`), so the interior and the shell share one transform. The JSON `world` values use 37.73; the runtime heightfield gives 37.74.

**`town/buildings` keep changes:**
- The `keep` node is now a **mesh-less group at the origin**, with the children `keep_shell` (mesh) and `keep_postern` (hinge). `keep_postern` has one child, `keep_postern_leaf` (mesh). Before, `keep` was a mesh node. Quantisation had moved its origin to the bbox centre (0, 7.25, 0.1), and `piece()` in town.ts recentres a piece on that node, so the shell stood 0.1 m north of its frame. It now stands exactly in its frame, as the interior does. Other buildings are untouched: `tower_breach` still has its quantisation offset (3.2, 7.55, 0), so `piece()` probably still shifts it by −3.2 m in x. This is a runtime issue to check; it was not changed here.
- The `dark` box in the gate passage is gone.
- The gate opening now starts at local 0.42: a stone threshold 2 cm proud of the hall floor. The terrain in the passage reaches 0.40, and the hole stops 1 m short of the outer face, so the threshold stays above it. The runtime door leaves stand with their bottom at about local 0.2, so the threshold hides their lowest 0.22 m. That already shows on the closed gate in the muster, execution and dragon chapters, and the leaves clip while they swing. **Raise the leaves to ≥ 0.42** (item 1 of the integration checklist below).
- The corner turrets (`TURRET` in `townbuildings.mjs`: 3.2 m boxes on the corners, y 0…15) reach 0.4 m past the inner wall faces, to x ±11.4, z ±7.4. The shell is unchanged. The interior wraps each stub in a 0.4 × 0.4 m pilaster (see the deviations), so no shell stone shows inside a room.
- **West postern:** opening z 2.3…3.7, y 0.4…2.8 through x −13…−11.8, with a 0.1 m sill outside. `keep_postern` sits at (−11.86, 0.4, 2.3), on the north jamb at the inner face. The closed leaf runs +Z from it. **Rotating `keep_postern` about its local +Y by +π/2 swings the leaf inward (+X).** Textures are `dark_wooden_planks` (512) and `rusty_metal_02` (256).
  - The leaf is a child of `keep`, so today it merges into the keep's static body: closed, and correct for K0.
  - To open it, find `keep_postern` under `town.keep` and split the `keep_postern_leaf` meshes out of the keep group in `ensurePhysics`, as is done for `keepDoors`. Give them their own body tagged `postern`, unfreeze their world matrices, and use `BodyFollower`.
- The main-gate leaves stay the runtime `large_castle_door` instances (`keep_door_hinge_±1`, tags `keep_door_l/r`). No procedural leaves were added, because they would have doubled the existing ones. The passage behind them is clear: the hall keeps x −2…2, z ≥ 6.2 free, and the leaves reach about z 6.35 when open at 85°.

**`keep/interior` node tree** (`keep_interior` → …):

| Node | What | Runtime use |
|---|---|---|
| `keep_gf`, `keep_stair`, `keep_bs` | Render meshes, one primitive per material: `ki_castle`, `ki_brick` (stone_brick_wall_001), `ki_floor` (rock_tile_floor), `ki_wood` (dark_wooden_planks), `ki_planks` (old_planks_02), `ki_iron` (rusty_metal_02, metallic). | Show `keep_gf` + `keep_stair` in zone `K_GF`, `keep_stair` + `keep_bs` in `K_BS`. Set `hasVertexAlpha = false` (COLOR_0 is VEC4 UNORM8, alpha 1), `maxSimultaneousLights = 5`, `receiveShadows` as you prefer. |
| `keep_gf_col`, `keep_stair_col`, `keep_bs_col` | Collider meshes, POSITION only, **no material**. Unsubdivided boxes (walls and ceilings 0.2 m thick behind each face, the ground-floor slab, pillars, corner pilasters, rubble, shelving, cell fronts, vault segments) plus **one ramp per stair flight** (35.54°, through the middle of the treads; the steps themselves have no collider). 2,664 triangles in total. | `setEnabled(false)` every node whose name ends in `_col`. Build static Jolt meshes from their world geometry, as `appendWorldGeometry` does. The ground-floor slab in `keep_gf_col` covers x 47.5…72.5, z −670.5…−653, top 38.13, except over the stairwell, as §3.1 requires. |
| `door_g2`, `door_store`, `door_stair`, `door_torture`, `door_cells` | Hinge nodes at the hinge axis, at floor level. They are **identity when closed**. Children: `<name>_leaf` (mesh) and `<name>_col` (box collider). | Body tag = JSON `doors.<tag>`. **Open by setting the hinge's `rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), t · openYaw)`** (t from 0 to 1). The `_col` child moves with it (`BodyFollower`, or toggle the body). The postern works the same way, but its hinge `keep_postern` is in `town/buildings` (JSON `doors.postern`). |
| `drain_plug` → `drain_plug_mesh`, `drain_plug_col` | A black card plus a box at the far end of the drain mouth (z −688.6). | Remove both once `cave/mesh` is shown (K9). Until then it stops the void showing through, and stops walking into it. Its tag suggestion is `blocker_drain`. |
| `anchors` → `anchor_<name>` | Empty nodes: translation = local position; rotation = yaw about +Y (local −Z is the facing); zones (`anchor_zone_<id>_<i>`) and blockers carry their **half extents as scale** of a unit cube [−1, 1]³. | Same data as the JSON (prefer the JSON: it has the world values and metadata). |

**Doors** (tags from §3.1; `openYaw` signed, radians, about +Y in the right-handed frame):

| Tag | Node | Opening (local) | Hinge (world) | Closed → opens toward | `openYaw` | Initial |
|---|---|---|---|---|---|---|
| `g2_door` | `door_g2` | x −6.6…−6.0, z 4.3…5.7 | (53.95, 38.13, −657.68) | +Z → hall (+X) | +π/2 | closed |
| `store_door` | `door_store` | x 6.0…6.6, z 3.0…4.4 | (66.54, 38.13, −657.62) | −Z → storeroom (+X) | −π/2 | **locked** |
| `stair_door` | `door_stair` | x 9.0…10.4, z 0.6…1.2 | (70.38, 38.13, −660.86) | −X → storeroom (+Z) | +π/2 | closed |
| `torture_door` | `door_torture` | x −1.0…−0.4, z 4.9…6.3 (basement) | (59.06, 32.13, −657.08) | +Z → B3 (−X) | −π/2 | closed |
| `cell_gate` | `door_cells` (bars) | x −7.1…−4.7, z −2.0…−1.4 (basement) | (52.96, 32.13, −663.95) | +X → cell corridor (−Z) | +88° (1.5359) | **open**: set t = 1 at load. Open, it lies along the corridor's west side (x −7.08…−7.00, z −1.97…−4.28), clear of the masonry and of west cell 1's bars. |
| `postern` | `town/buildings` `keep_postern` | west wall z 2.3…3.7 | (48.14, 38.13, −659.7) | +Z → G2 (+X) | +π/2 | closed. JSON `doors.postern` has `asset: "town/buildings"` and `collider: null`; build its body from `keep_postern_leaf`'s meshes. |

The G3 barracks doorway (x −0.7…0.7 at z −2.2…−1.6) is open and has no leaf. The cell doors are part of the static bars: all are closed except **west cell 3**, which stands open 70° into the cell for the loot potion.

**`keep/anchors` JSON** (`version: 1`):
- `frame`: origin, yaw convention, parenting note. `levels`: `gf` / `bs` local and world heights.
- `anchors.<name>`: `{kind, local, world, yaw?, room, …}`.
  - `yaw` uses the game convention, atan2(−dx, −dz) of the facing: −Z = 0, west = π/2, east = −π/2.
  - `room` is the air box the anchor stands in, or `"outside"`.
  - Kinds:
    - `light` (25): has `light` (sconce / brazier / fire / candle) and `lightHint` `{intensity, range, color}`. Sconces add `wall` (the bracket point, local and world) and `normal`. The position is the flame, 0.22 m off the wall.
    - `prop` (17) and `use` (9, interactables): have `prop`, a *suggested* asset. `kit/<Model>` is the FPM kit, `ph/<id>` an existing manifest id, `procprops/<name>` the procedural-props unit. Some also have `items` and `route`.
    - `spawn` (4), `mark` (22), `cp` (8): `cp_*` carry `companion`, a **world** [x, y, z].
    - `camera` (2): the K1 bonds shots, with `lookAt` in world coordinates.
    - `blocker` (3): `half` extents and a `tag`.
    - `ext` (5): the outdoor K0 marks from §4.1.
- `doors.<tag>`: `{asset, node, leaf, collider, hinge{local, world}, closedDir, openDir, openYaw, width, height, initial, opening{min, max}}`. `asset` is `keep/interior` for the five interior doors and `town/buildings` for `postern`, whose `collider` is `null`.
- `zones`: `K_GF`, `K_BS`, `E1`, `E2`, `E3`, as lists of `{min, max, worldMin, worldMax}`. The `K_GF` / `K_BS` boundary is local y −1.0 (world 36.73), halfway down flight A, so the tremor point is already in `K_BS`.
- `rooms`: every air box, local and world. **For `cave.mjs`:** B5 is x 49…59, z −688…−682, floor 32.13, ceiling 35.53. The drain mouth is x 52.9…55.3, z −688.6…−688, y 32.13…34.73. The cave tunnel should start beyond z −688.6 or subtract these boxes.
- `vault`, `stairs`, `stats`.

**Names you will look up** (all in `anchors`):
- **Lights:** `light_brazier_w/e`, `light_hall_w/e/n1/n2`, `light_g2_fire`, `light_g2_s/e`, `light_g3_1/2`, `light_g4`, `light_g5_top/mid`, `light_b1`, `light_b2_1/2`, `light_brazier_b3`, `light_b3_s/w`, `light_b4_1/2`, `light_b5_s/e`, `light_j_candle`.
- **Interactables:** `use_weaponstand_imp`, `use_locker_imp`, `use_chest_reb`, `use_weaponstand_reb`, `use_footlocker`, `use_store_potions`, `use_records`, `use_cell_potion`, `use_j_chest`.
- **Spawns:** `spawn_e1r_shield/captain`, `spawn_e1i_axe/leader`.
- **Checkpoints:** `cp_k1_reb/imp`, `cp_k2_reb/imp`, `cp_k3` … `cp_k6`.
- **Bond spots:** `mark_bond_*`.
- **Retry marks:** `mark_e1r_retry_*`, `mark_e1i_retry_*`, `mark_e2_retry_player`.
- **Torture room:** `mark_interrog`, `mark_assistant`, `mark_b3_companion`, `mark_key_land`.
- **Cells and J:** `mark_oldman`, `mark_whisper`, `mark_jailer`, `mark_fugitive`, `mark_dead_jailer`, `mark_drain`.
- **Other marks:** `mark_tremor`, `mark_crushed_guard`, `mark_postern_inside`.
- **Blockers:** `blocker_gate` (4 × 5 × 0.3 at z −653.9), `blocker_postern` (the K1 beam), `blocker_drain`.

**Baked vertex colour.** COLOR_0 = AO × (0.35 cool ambient + warm falloff) × grime × noise, clamped to [0, 1].
- **AO:** 5 probes at 0.15–1.3 m against a union-of-boxes SDF, including the vault and solid objects.
- **Warm falloff:** from every `light` anchor, (1 − d/R)^1.6. Radii: sconce 6.5 m, brazier 9, fire 8, candle 3. Each contribution is occlusion-tested, so no light leaks through walls.
- **Grime:** walls are 40 % darker at the floor, fading out by 0.6 m. Floors are ×0.86, ceilings ×0.82. Soot lies above sconces and braziers.

The bake assumes the anchors' lights are lit. Mean vertex luminance is about 0.3.

**Build validation** (fails the build):
- Anchor names are unique.
- Every mark, spawn, cp, use and prop anchor stands in a room, on a floor (probed, ±6 cm). Marks, spawns and cps have a clear 0.25 m body at 0.9 m height.
- Prop footprints do not overlap. Props from different routes may share a spot.
- Door hinges lie inside their openings.
- **Doors swing clear.** This covers every interior leaf and the postern, at t = 0, ¼, ½, ¾ and 1. More than 0.12 m from the hinge axis, the leaf's collider box must not overlap any static collider box (oriented-box SAT, 3 mm tolerance). Every leaf vertex must stay in room air: not in masonry, not inside a solid and not inside a static collider. At the hinge the leaf may turn into its jamb by at most half its thickness, because its axis lies on the jamb face. No prop or interactable footprint may lie in the sweep.
- **Ground floor over the terrain hole.** Every 0.25 m sample of the keep's effective collider hole (x 48…72, z −670…−654) is probed down from GF + 5 cm. The first collider must be the floor at GF (± 3 cm), or something standing on it. Inside the G5 stairwell it must be a ramp, the mid landing, the core, the railing or the NE pilaster. The bare stairwell floor at BS counts only at the foot of flight B.
- **The keep shell stays outside the rooms.** `buildKeep()` is run, and its triangles are sampled at ≤ 0.1 m. No sample may lie in room, door or passage air outside every solid.
- These checks were mutation-tested. Each of the following fails the build: no pilasters, the slab lowered 1.4 m, no slab, no ramp A, and the old cell-gate pose at 100° or at 90°.
- Render triangles are 25–45k. Outside 30–40k gives a warning.

**Checked after the build** (scripts in the session scratchpad, not shipped):
- First build: all 75 previous manifest ids existed. Only `cart/terrain` and `town/buildings` changed hash. Review fixes (`--only=keep/interior`): all 77 ids exist, and only `keep/interior` and `keep/anchors` changed hash. `town/buildings` is unchanged: `TURRET` only names the existing numbers, and the `buildKeep` output hash is the same.
- `terrain_4_1` has 0 triangles left inside the hole.
- Walk test with ray casts against the decoded `*_col` triangles, doors open: gate → hall → storeroom → both flights → B1 → B2 → B3 → cell gate → B4 → B5 → drain, plus G2/postern, the barracks and west cell 3. Every sample has a floor. The largest step up is 0.107 m and step down 0.178 m (limits 0.45 / 0.5). Head room is ≥ 2.10 m, and nothing blocks at 0.5/1.0/1.6 m. The main path was re-run after the fixes: step up 0.107, step down 0.143, head room 2.40, nothing blocks.
- Corner renders from the decoded GLBs: the shell is drawn in a flag colour, and the doors are optionally opened by `openYaw`. G5 (from flight A, from the mid landing, and looking up the NE corner), G2 SW, G2n NW and G4 SE all show 0 shell pixels. The only shell visible from inside is the postern's own jamb reveal (3.5 cm deep beside the closed leaf), and the cell gate lies flush along the corridor wall.

**Runtime integration checklist (keep).** These are the runtime changes the pipeline outputs need, in `src/**`, owned by the runtime engineer:
1. **Main-gate leaves:** raise the `large_castle_door` instances in `src/world/town.ts` (`keep_door_hinge_±1`, tags `keep_door_l/r`) so their bottom is at ≥ keep-local 0.42, the top of the new gate threshold. Today it is ≈ 0.2. This fixes the hidden bottom on the shipped closed gate and the clipping while they swing.
2. **Interior parenting:** parent `keep_interior` under `town.keep`, then `setEnabled(false)` every `*_col` node and build static bodies from them.
3. **Doors:** register one body per `doors.<tag>` (tags from §3.1) and open via the hinge node's `RotationAxis(Up, t · openYaw)`. `cell_gate` starts at t = 1. `store_door` starts locked.
4. **Postern:** in `ensurePhysics`, split `keep_postern_leaf` out of the keep's static body, tag it `postern`, and drive it from `doors.postern` (hinge, `openYaw`). Use no hard-coded numbers.
5. **Drain:** remove `drain_plug` when `cave/mesh` is shown (K9).
6. **Materials:** on the `ki_*` materials set `hasVertexAlpha = false` and `maxSimultaneousLights = 5`. Show `keep_gf` / `keep_stair` / `keep_bs` per zone `K_GF` / `K_BS`.

**Terrain holes.** `tools/gen/terrainHoles.mjs` mirrors `src/world/terrainHoles.ts`; keep the two tables identical.
- `cart/terrain` cuts a hole only when its `cover` asset ships. That set is the `HOLE_COVERS` constant in `build-assets.mjs`, and today it holds only `keep/interior`. This matches `activeTerrainHoles` at runtime.
- A gate fails the build when the manifest ships a cover whose hole is not cut, or the reverse.
- When `cave/mesh` ships, add `"cave/mesh"` to `HOLE_COVERS` and rebuild with `--only=cart/terrain,cave/…`. Until then `EXIT_HOLE` is closed in both the render mesh and the collider. *(Done, then changed: the geometry that covers and floors the hole is `cave/outcrop`, so `EXIT_HOLE.cover` in `tools/gen/terrainHoles.mjs` and `HOLE_COVERS` now name `cave/outcrop`, and `cart/terrain` cuts `EXIT_HOLE`. `src/world/terrainHoles.ts` still names `cave/mesh` until the runtime mirrors it. See "Cave and balcony outcrop" below.)*

**Deviations:**
- **Asset ids** are `keep/interior` + `keep/anchors`, as in §10.1 and the runtime's `KEEP_HOLE.cover`. The pipeline task had named it `town/keep_interior`.
- **Main-gate leaves** were not rebuilt (see above). The task asked for procedural leaves in `buildKeep`, but the runtime already has openable leaves.
- **Moved marks:**
  - Brun's E1 rebel retry mark (§5.4) moved from (53.6, −656.0), which lies inside the G1/G2 partition, to (55.4, −656.6).
  - The imperial WeaponStand moved from (64.6, −655.0), which overlapped the east brazier at (64.8, −655.4), to (65.55, −656.75) against the east partition, still facing −X.
- **Wall thickness:**
  - The design had a zero-thickness wall at x −1.0 between B2 and B3. B2 now starts at x −0.4, giving the 0.6 m wall the torture door sits in.
  - The same applies at z −1.4 between B3 and B4. The cell corridor now starts at z −2.0, and the cell gate sits in that wall.
- **Corner pilasters.** The shell's corner turrets reach 0.4 m inside the walls. The interior adds a pilaster at each corner: `pilaster_sw` in G2, `pilaster_nw` in G2n, `pilaster_se` in G4, and `pilaster_ne` + `pilaster_ne_low` in G5. Each is 0.4 × 0.4 m, sits 2 cm proud of the stub, runs floor to ceiling, is baked, and has a collider. G5's stands on the mid landing; it is brick below GF and castle above, like the stairwell walls. The exterior silhouette is unchanged.
- **Cell gate:** it opens 88°, not past perpendicular. The hinge is 6 cm in from the corridor's west face (x −7.04), and the leaf is 2.31 m wide.
- **Heights the design left open:** the hall is 6.0 m clear (ceiling 6.4, plank ceiling on joists, a girder over the pillars). G2, G3, G4 and G5 are 4.0 m clear. G2's collapsed bay (z < −665) is open to 6.0 m, with broken boards, rubble and fallen beams, and no roof hole.
- **Cell bars and the barred cell gate are in `keep/interior`.** §10.1 lists "cell bars" under `procprops.mjs`, so that unit only needs the cage, shackles and the other loose props.
- **Postern leaf textures** add 0.14 MB to the `muster` start pack, which is now 12.14 MB.

### Cave and balcony outcrop (`cave/*`, `fx/water_n`)

Built by `tools/gen/cave.mjs`. It is self-contained: layout data, the rock field, meshing, validation and glTF. Two helpers sit beside it: `tools/gen/webtex.mjs` makes the web atlas and `tools/gen/watertex.mjs` makes the water normal map. Rebuild with `node tools/build-assets.mjs --only=cave/`, which takes about 52 s (31 s for the field, meshing and validation, the rest for the checks of the decoded GLBs and encoding). The `cave/` step also emits `fx/water_n`. `cart/terrain` cuts `EXIT_HOLE`, because `HOLE_COVERS` holds its cover. Rebuild it only when `terrainHoles` changes.

**`EXIT_HOLE.cover` is `cave/outcrop`.** The outcrop's skin caps the hole, and since this round it also ships the mouth in front of the plug, render and collider. `tools/gen/terrainHoles.mjs` and `HOLE_COVERS` name it. The runtime's table (`src/world/terrainHoles.ts`) still names `cave/mesh`. Both ship, so the runtime opens the collider exactly where the render terrain is cut. The build reads the runtime's covers and **fails** if they would disagree with the render cut. It **warns** while the two tables differ: `warning: terrain hole "exit": src/world/terrainHoles.ts names cave/mesh as its cover …`. The runtime engineer should mirror the change in src. The unit test `holes.test.ts` keeps passing, because it only asks `activeTerrainHoles(() => true)` for both holes.

The cave reads the keep's drain room from `keepinterior.mjs` when it builds. If the drain changes, rebuild both: `--only=keep/,cave/`. A gate in `build-assets.mjs` fails the build otherwise (see Joins). The build is reproducible: identical sources give byte-identical outputs, `cave/anchors` included, because it carries no timings. `node tools/check-cave-mutations.mjs` (`npm run check-cave`) re-runs the mutation test of the validator (see Validation).

| Manifest id | Type | Segment | Priority, `pos` | Raw / brotli | Content |
|---|---|---|---|---|---|
| `cave/mesh_a` | glb | **keep** | 93, [50, −715] | 124 KB / 94 KB | Zone A (the entry tunnel and the gallery), its collider, the water ribbon and the perch steps. 8.1k render triangles (7.5k cave, 0.56k water), 2.4k collider. |
| `cave/mesh` | glb | **exit** | 95, [−10, −730] | 452 KB / 357 KB | Zones B–E **behind the mouth plug** and their colliders, the terraced stair up to the plug, web walls A/B, corner webs, cocoons, egg sacs and the den fissure. The 1024² web atlas is embedded. 18.9k render triangles (16.4k cave, 2.5k dressing), 5.2k collider. |
| `cave/outcrop` | glb | **muster** | 90, [−17, −673] | 106 KB / 78 KB | **`EXIT_HOLE.cover`.** It holds the outcrop's skin, including the platform, and the **mouth stub**: the cave in front of the plug, with its rock, the top 4 stair slabs and their ramp collider. It also holds the deck's enclosure (rails plus walls) and the mouth plug. 6.3k render triangles and 2.6k collider triangles. It binds only the moss set, through materials `outcrop_rock` (the skin) and `cave_moss` (the stub). |
| `cave/anchors` | json | **keep** | 95, [50, −715] | 29 KB / 9 KB | Anchors, walk paths, zones, volumes, webs, stair, perch, outcrop, dressing, lights, materials, joins and build stats. Load it with `loadJSON("cave/anchors")`. |
| `cave/tex/{rock,ground,pebbles}_{d,n,arm}` | ktx2 | keep | 92 / 90 / 88, [50, −725] | 1.07 MB | Poly Haven CC0 `rock_face_03`, `rocks_ground_08` and `ganges_river_pebbles`. `_d` is 1024² colour, `_n` is 512² normal (OpenGL / `nor_gl`), `_arm` is 512² linear (R = AO, G = roughness, B = metal). |
| `cave/tex/moss_{d,n,arm}` | ktx2 | **muster** | 92 / 90 / 88, [−17, −673] | 0.35 MB | `mossy_rock`, in the same layout. It ships with `cave/outcrop`, which binds it. `cave/mesh` (exit) uses it from there. |
| `fx/water_n` | ktx2 | keep | 90, [48, −731] | 50 KB | 512² normal map that tiles in u and v (integer-wavevector sines, OpenGL convention). |

The start packs (brotli) after this build (`--only=cave/`, manifest `db3f9b551886`) are:

| Segment | Start pack | Change from the cave's arrival |
|---|---|---|
| menu | 0.02 MB | – |
| cart | 8.54 MB | the hole changes `cart/terrain` by +1.5 KB |
| muster | **12.57 MB** | +0.43 MB: the outcrop 0.08 MB and the moss set 0.35 MB |
| execution | 2.90 MB | – |
| dragon | 4.84 MB | – |
| keep | **3.79 MB** | +1.22 MB |
| exit | **0.37 MB** | `cave/mesh` alone |

The previous round's summary gave "exit 0→0.73 MB, muster 12.14→12.20 MB". Those numbers predate the move of the moss set to muster and are superseded. This round changed only `cave/*` (all four ids got new hashes; `cave/mesh` lost 17 KB to `cave/outcrop`, which gained 29 KB). `cart/terrain` is byte-identical, because the hole it cuts is unchanged, and all 94 earlier ids still exist.

**Frame.** Everything is in **world coordinates**. Add each container at the origin. Do not parent it, and do not use `piece()`, which recentres. Mesh nodes carry a translation and a uniform scale from `KHR_mesh_quantization`, so build bodies from world geometry, as `appendWorldGeometry` does. Every anchor `y` is the shipped collider's height at that x/z, so a `place3` ray lands within 3 mm of it. The build checks this against the decoded GLBs.

**Rock field.** The rock is a signed distance field, meshed once with surface nets at 0.5 m, so the cave, the outcrop skin and the mouth share edges. Its parts:
- **v4 air:** the design §4.3 splines, chambers and stream, with noise 0.55 m on walls and 0.12 m on floors.
- **Extra air:** the chimney (a capsule Ø2.5 m from y 34.8 to 39 at (18, −750.5)) and the drain junction.
- **Perch:** the rock box.
- **Ground:** everything below the terrain − 0.5 m.
- **Outcrop:** see below.

Each triangle is classified by the term that makes it:
- cave → zones A–E;
- outcrop → `cave/outcrop`;
- ground → dropped (the terrain mesh renders it).

Simplification is joint, to 35 % for render and 12 % for colliders, then the result is split. Every render mesh **and** every collider also carries a one-triangle ring of its neighbours' triangles. Each mesh is quantised on its own, and the ring covers the millimetre cracks that leaves at the seams. Do not filter those duplicates out.

**`cave/mesh_a`** (root `cave_a_root` → …), **`cave/mesh`** (root `cave_root` → …), **`cave/outcrop`** (root `outcrop_root` → …). The roots were renamed from `cave_a` / `cave` / `outcrop`, because `cave_a` and `cave_A` differed only by case. The build now fails if two node names across the three files differ only by case. Look nodes up by exact name.

| Node | What | Runtime use |
|---|---|---|
| `cave_A` … `cave_E` | Render meshes, one primitive per material: `cave_rock`, `cave_floor` (normal.y ≥ 0.72, stair and perch treads), `cave_bed` (A only), `cave_moss` (D/E: the last 25 m of the climb, stair risers, and every triangle that touches the outcrop, floor included). `cave_E` also has an `outcrop_rock` primitive, which is its ring of outcrop triangles. They carry POSITION, NORMAL, TEXCOORD_0 and COLOR_0, where COLOR_0 = baked SDF AO × variation × wet darkening near the stream, VEC4 UNORM8 with alpha 1. | Visibility set `cave_X` per zone (see Zones). Set `hasVertexAlpha = false`. |
| `cave_A_col` … `cave_E_col` | Collider meshes, POSITION only, no material: the 12 % mesh plus explicit pieces. The stair has one ramp height field, through the tread middles (19 risers of 0.352 m, s 76 → 92.4, ramp ≤ 30°). The perch has one 40° ramp through its 8 steps (rise 0.378 m) and no step colliders. | `setEnabled(false)`, then build one static mesh body per node. They are permanent. |
| `cave_water` | The stream ribbon at y 23.7, 0.6 m wider than the channel and 2 m past both ends into the rock. TEXCOORD_0 = (arc length / 2, across / 2) m. TEXCOORD_1 = (0…1 along the flow, 0…1 across), where foam is near v 0 and 1. There is no COLOR_0 and no collider. The flow runs from x 64 to x 32, which is **west**. | Material `cave_water`, alpha blend 0.75. Bind `fx/water_n` and scroll it (below). The slow and splash volume is `volumes.water`. |
| `web_A`, `web_B` → `web_X_cards`, `web_X_col` | Three alpha cards 0.15 m apart, the middle one an orb web and the outer two sheets, plus one box collider (12 triangles). They are sized to the measured section, not 4.4 × 3.6: A is 5.9 × 5.15 m and B is 7.45 × 5.55 m. | Body tag `web_A` / `web_B`. To cut: dissolve the cards, then remove the body. JSON `webs.<id>` gives the box centre, half extents, axes, normal and size. |
| `cave_webs` | 16 corner webs: orb or corner cards in pockets of the spider chamber and both doors. | Cosmetic. |
| `cocoon_courier` → `cocoon_courier_mesh`, `cocoon_courier_col` | The courier's cocoon, lying along the wall at anchor `cocoon` (r 0.38, 1.8 m), plus a box collider. | Hold-E target. Hide or replace it when cut open, and remove its body. |
| `cave_cocoons`, `cave_eggs` | Four hanging cocoons, and five egg sacs by `burrow_s` (material `cave_eggsac`, emissive teal, `KHR_materials_emissive_strength` 1.8). | Cosmetic. Light hint `lights.light_eggs`. |
| `den_fissure` | An emissive 6 × 1.2 m card on the den ceiling (material `cave_fissure`). | Pair it with the spot light `lights.light_den_fissure`. Cosmetic. |
| `outcrop_rock` | The outcrop skin and the flat platform (primitive `outcrop_rock`), and the **mouth stub** (primitive `cave_moss`). The stub is every cave triangle in front of the plug's plane, plus 1.5 m behind it so that its floor runs under the plug box and its walls behind the card. It includes the top 4 of the 19 stair slabs. There is also a one-triangle ring of zone E triangles where the stub meets `cave_E` (material `outcrop_rock`/`cave_moss`, the same textures, tile, UVs and vertex colours as the E triangles under them, so the doubled triangles render identically). The skin's lower border runs at least 5 cm under the render terrain everywhere (0.07 m at the highest), so the two meet without a crack. | **Show with the town (outdoor set) from the muster chapter on.** It covers `EXIT_HOLE`, which `cart/terrain` cuts from the start. With the plug, it closes the mouth by itself: `cave/mesh` is not needed for anything seen or walked on from the town. Its textures `cave/tex/moss_*` ship in muster too, so it is fully textured from the first frame it is shown. Keep it visible in zones D–E. |
| `outcrop_col` | The outcrop's collider: the skin, the platform deck (flat at 56.05, within 4 cm) and the stub's floor and walls. The stair ramp cells in front of the plug are here too, and also in `cave_E_col`. | Static body. Build it with the town. |
| `outcrop_rails_col` | The deck's invisible enclosure, four boxes up to y 66 (`outcrop.rails.walls`). **S** (z −667, x −21.8…−11) and **E** (x −11, z −675.2…−667) are the rails over the open edges, ≥ 1.2 m above the deck (they run to 66). **W** (x −21.8, over the shoulder) and **N** (z −674, from y 59.2, 1.2 m thick into the hood) stop anyone on the outcrop's top from dropping onto the deck or into the mouth. | Static body, with the town. |
| `outcrop_mouth_plug` → `_mesh`, `_col` | A black card 8.3 × 6.55 m plus a box (half extents 0.2 × 3.27 × 4.15, covering the whole tunnel section in its plane), 3.5 m inside the mouth, facing out, at (−19.07, 57.98, −676.63). | Shown until `cave/mesh` is in: behind it the tunnel is empty while only the outcrop is loaded. Remove both (tag suggestion `blocker_mouth`) when `cave/mesh` is shown. In the fallback (cut #6) keep it as the void card. |

**Materials and textures.** The rock materials in the GLBs are **untextured**. Their `baseColorFactor` is the mean colour of their diffuse, roughness is 1 and metallic is 0. TEXCOORD_0 is world position ÷ tile, in texture repeats, box-projected:
- floors, the bed and ceilings use XZ;
- walls use X or Z, following the tunnel direction (radially in chambers), and switch to the face's own axis where that would stretch.

Each material's glTF `extras`, which Babylon puts in `material.metadata.gltf.extras`, read `{textures: {albedo, normal, orm}, tile, source}`. The ids are `cave/tex/*`, and `outcrop_rock` uses the moss set. To bind:
- `albedoTexture` = `loadKTX2(albedo)`, and `albedoColor` = white.
- `bumpTexture` = `loadKTX2(normal)`, with **`invertNormalMapX = false`, `invertNormalMapY = true`**. That is what the glTF loader sets for `nor_gl` maps in this right-handed scene, but it does so only when the file has a normal texture.
- `metallicTexture` = `loadKTX2(orm)`, with `useAmbientOcclusionFromMetallicTextureRed`, `useRoughnessFromMetallicTextureGreen` and `useMetallnessFromMetallicTextureBlue` all true.

The textures are shared by `cave/mesh_a`, `cave/mesh` and `cave/outcrop`, so load each id once. The moss set ships in muster with the outcrop. Every texture a GLB binds ships in its own segment or an earlier one. A triplanar plugin (like `TerrainSplatPlugin`) can use the same ids and ignore the UVs. Floor and wall are separate materials, so give both materials the same N.y blend so that their shared edges match.

`cave_water` has `extras.textures.normal = "fx/water_n"`: bind it as `bumpTexture` with the same inversion flags and scroll `uOffset` at about 0.3/s along u. Ideally use two samples at different scales.

The webs material `cave_web` has its atlas embedded: alpha blend, double-sided, emissive 0.05. Turn off depth write at runtime. `cave_cocoon` uses the same atlas, opaque. `loadGLB` already applies the light budget.

**`cave/anchors` JSON** (`version: 1`):
- **`anchors.<name>`:** `{kind, pos [x, y, z], zone, sdfFloor?, clear?, yaw?, faces?, use?}`.
  - `yaw` is the game convention atan2(−dx, −dz).
  - `pos.y` is the collider floor. On the stair that is the ramp, 0.2–0.45 m above the rock floor `sdfFloor`.
  - `breach` stands in the keep's drain passage, so it has no cave collider under it.
  - `bones_3` moved 0.5 m from (−23.5, −712.8), which is inside the den wall, to (−23.53, −713.3); see `stats.movedAnchors`.
- **`paths.walk.<tunnel>`:** the tunnel centre floors every 2 m, as collider heights. Chain entry → toSpider → toDen → exit. The chain runs from `breach` to `balcony_mouth` with no gap over 2 m, except one crossing of `paths.chasm` (x 30…66, z −735.7…−727.3, the drawbridge gap). The build checks this. Use the points for breadcrumbs and `walkPath`. `paths.den_path` holds the 4 den sneak points; the closest approach to the wolf is **5.17 m**, not 5.5.
- **`zones.A`…`E`:** `{boxes: [{min, max}], neighbours, show: ["cave_X"], profile}`. Define them **in order A, B, C, D, E with equal priority**, because overlaps resolve to the earlier zone. Neighbours are A–B, B–C, C–D and D–E. The profile is "cave", except E, which is "climb-out". The boxes are binned along the tunnels; the build checks that every walk sample resolves to its own zone, or to the neighbour within 4 m of a seam. Zone E's last box covers the outcrop top (x −26…−9, y 50…64, z −684…−664). Hand off to K_BS / `drain_plug` at `breach`.
- **`volumes`:**
  - `respawn_gallery`: y < 25.5 over the chasm, to the bank last stood on (`lever_stance`/`gal_s_cp`).
  - `respawn_outcrop`: y < 50 over the outcrop's skin plus 1 m (x −26.79…−6.5, z −676…−662.42), to `platform`. It reaches the skin's east face at x −7.5, not just the design footprint (x ≤ −9). It stops at z −676 because the climb runs below 50 m further north. It is a safety net only: the enclosure check shows the capsule cannot leave the deck.
  - `water`: the slow and splash box, surface 23.7, bed 23.1.
  - `spider_arena` and `chasm`.
- **`webs`, `stair`, `perch`** (`box`, `steps`, `ramp`) **and `outcrop`:**
  - `platform`: y 56.05, x −19…−11, z −674…−667.
  - `rails`: `open` (the S and E edges), `walls` (S, E, W, N boxes: `a`, `b`, `y`, `t`, `side`), `minHeight` 1.2.
  - `mouthStub`: the plug's plane (point and normal) and `behind` (1.5 m). Cave geometry in front of it ships in `cave/outcrop`.
  - `enclosure`: the fill counts of the enclosure check (below).
  - `mouthPlug`, `hole` (`cover: "cave/outcrop"`), `scatterExclusion`.
  - `vista`: per target the distance, yaw, clearance and where the line leaves the deck.
  - `viewCorridor`.
  - `props`: the `brow` suggestion `ph/rock_face_02` at (−19, 60.5, −674.6), and 5 `lip_*` boulder positions on the S/E edges, outside the view corridor.
- **`dressing`** (cocoons, eggs, fissure), **`lights`** (`light_camp_fire`, `light_eggs`, `light_den_fissure`, with `hint` intensity, range and colour), **`materials`** and **`nodes`** (node → asset, kind, zone).
- **`joins.drain`:** the keep's drain rectangle the cave was clipped to (world `keep.min`/`keep.max`, plus `clipZ`). `build-assets.mjs` compares it with `keep/anchors` `rooms.drain`.
- **`stats`:** validator measurements. These include `probes` (minimum clearance and half-width, with where they occur) and `connectivity` (centreline samples and the chasm crossing). Timings are only logged, so the file is reproducible.

**Anchors** (world; y = collider floor):

| Anchor | x, y, z | Clear | Note |
|---|---|---|---|
| `breach` | 54, 32.15, −688.5 | 2.6 | in the keep's drain (keep floor) |
| `ramp_foot` | 54, 30.24, −697 | 4.3 | |
| `cp_gallery` / `comp_gallery` | 51, 28.15, −714 / 52.2, 28.43, −713 | 4.85 | CP7, yaw −0.25 |
| `gal_entry_mouth` | 49.5, 27.01, −721.5 | 5.3 | |
| `camp_fire` | 53.5, 27.97, −724 | 4.4 | prop; light `light_camp_fire` |
| `sitA` / `standB` | 52, 27.75, −722.8 / 54, 28.01, −725.5 | 4.1 / 5.05 | both face `camp_fire` |
| `interrog_body` | 51, 27.29, −724.8 | 6.2 | design said 27.9: the ledge falls to the west |
| `perch` / `perch_foot` | 55, 30.11, −727.6 / 49.85, 27.05, −727.2 | 3.6 / 7.65 | perch faces `gal_entry_mouth` |
| `lever` / `lever_stance` / `comp_lever` | 44, 27.98, −725 / 44, 27.98, −724 / 45.5, 27.51, −723.5 | | stance yaw 0 (CP8) |
| `winch` | 44.8, 27.73, −725.8 | | |
| `bridge_n` / `bridge_s` | 48, 26.95, −726.5 / 48, 27.11, −736.5 | 7.55 / 7.2 | |
| `bridge_hinge` / `slab_drop` | 48, 27.0, −735.6 / 48, 34.8, −731.5 | | fixed y; crown 35.56 above the raised tip |
| `gal_s_cp` / `comp_s` | 47.5, 27.06, −738.5 / 49.2, 27.14, −739 | 6.0 | exit CP0, yaw 0.2 |
| `web_A` / `cp_spider` / `comp_spider` | 27, 27.63, −749.5 / 31.5, 27.73, −749 / 33, 27.70, −748.5 | | CP1 yaw 1.57 |
| `spider_c` | 18, 27.55, −750 | 12.5 | open up the chimney |
| `chimney_mouth` / `chimney_top` | 18, 34.8, −750.5 / 18, 39, −750.5 | | the giant drops from the mouth |
| `burrow_n` / `burrow_s` / `cocoon` | 15, 28.42, −745.5 / 21, 28.52, −755 / 22, 28.45, −754 | | |
| `web_B` / `cp_spider_done` / `comp_spider_done` | 10.5, 27.86, −749.2 / 12, 27.79, −749.5 / 13.5, 27.72, −749 | | CP2 yaw 1.57 |
| `cp_den` / `comp_den` | −16.5, 31.56, −729 / −15.5, 31.40, −730.2 | 4.25 | CP3 yaw 2.45 |
| `wolf_bed` / `satchel` / `den_centre` | −22, 32.85, −718 / −20.5, 33.47, −716.5 / −24, 32.47, −720 | | the wolf faces `cp_den` |
| `bones_1..3` | (−24.5, 32.48, −721), (−26.8, 32.79, −715.5), (−23.53, 33.12, −713.3) | | props |
| `den_path_1..4` | (−19, 32.06, −726), (−25.5, 33.19, −723.5), (−27.5, 33.00, −718), (−27, 33.13, −712.5) | | |
| `cp_climb` / `comp_climb` | −28, 33.73, −709 / −27, 33.41, −711 | 4.5 | CP4 yaw 2.7 |
| `climb_s23` / `climb_mid` | −33, 35.48, −699 / −46, 40.73, −681 | | leash limit; wind bed |
| `cp_light` / `stub84` | −25, 51.28, −684 / −21.9, 53.32, −681.3 | 5.9 / 5.75 | stair (ramp heights) |
| `bend` | −21, 54.08, −680 | 5.75 | zone D/E seam |
| `balcony_mouth` / `platform` / `comp_platform` | −17.5, 56.05, −673.5 / −15, 56.05, −670.5 / −17.6, 56.05, −672 | | platform yaw −1.68 (CP5) |
| `vista_eye` | −15, 57.7, −670.5 | | camera |

**Joins this module owns.** The build fails if any of these breaks:
- **Drain mouth.** The cave is clipped exactly at z −688.58, 2 cm into the keep's drain passage. Its opening is the keep's rectangle (x 52.9…55.3, y 32.13…34.73) inset by 1 cm, so the two neither crack nor share a coplanar strip. 2.5 m into the cave, the drain-box floor (32.15) drops 0.34 m onto the tunnel floor.
- **`EXIT_HOLE`.**
  - The tunnel meets the terrain only inside `EXIT_HOLE.render`.
  - Every point of the hole is under the outcrop. The outcrop adds a cap over the hole that follows the terrain + 1.3 m; the terrain inside the hole reaches 68 m, above the hood.
  - The runtime height field survives a few triangles outside `samples`, along the mouth's west wall. The pipeline models it exactly (4 m `heightAt`, 512/255 m sample grid, either quad diagonal) and the tunnel floor there follows those triangles + 3 cm, so none of them reaches into the tunnel.
- **Skin and terrain mesh.** The outcrop skin's lower border lies at least 5 cm under the render terrain (`tools/gen/terrain.mjs`, 2 m grid, same triangulation) at every one of its 327 border vertices; at the highest it is 0.07 m under. The ground term sits 0.5 m under the terrain. But on the steep west slope (gradient ≈ 1.3), surface nets put the crease between the outcrop and the ground up to a cell away from the true crease, up to 0.6 m *above* the terrain. Dropping the ground triangles there left a sliver crack, which hillside eyes saw into at grazing angles. Ground triangles that reach above the render terrain inside the outcrop's box now stay with the skin (125 triangles).
- **The town-chapter set** (muster through keep: `cave/outcrop` shown with the town, `cave/mesh` not loaded). This is checked on the decoded `cave/outcrop` with the runtime terrain collider modelled with `EXIT_HOLE` cut:
  - **Render closure.** 55 eyes look at the 879 zone-E surface points within 14 m of the mouth and at points in the air behind the plug (48,345 rays). The eyes are a grid on the deck, the square, the forecourt, the keep top, the street, the tower, the inn, and 24 hillside points 16 and 28 m around the outcrop. Each ray's first front face must come before the ray enters the void (rock deeper than 0.25 m, or cave air outside the stub). Measured: 0 fails.
  - **Floors.** Every standable floor of the field outside the plug is checked: rock below, 1.75 m of room, slope ≤ 50°, sampled every 0.5 m and every 0.25 m within 10 m of the mouth. Each needs an `outcrop_col` or terrain collider within 0.45 m, or within 0.2 m of the up-facing render floor that the player sees there. A field floor with no render floor within 0.6 m outside the tunnel is counted, not failed. This happens for 2 points on a 0.6 m sliver of the cap's north rim, which the simplifier removed from both meshes. Measured: 3721 floors, 0 missing (3 matched by the render floor, 2 unshown).
- **Enclosure.** A flood fill runs the player's capsule over the decoded colliders (`MOVER`: step 0.45, slopes ≤ 50°, 1.8 m tall, jump 1.11 m; 0.25 m columns; segments between columns blocked by any non-terrain triangle at 0.3, 0.9 and 1.5 m). From `platform`, it must stay on the deck and the stub, or drop into `respawn_outcrop`. It must never reach the terrain, leave the outcrop, fall through every collider or reach the edge of the 44 × 50 m area. From every terrain cell on the area's border (the whole open slope), it must never reach the deck or the stub. Measured: 1132 nodes from the platform, all on the deck or the stub. 33,884 nodes from the hillside, 3520 of them on the outcrop's top, none on the deck or the stub. This is design §12 X4 ("boulder lip + rails + respawn below y 50") made checkable: the platform cannot be walked onto from the town, nor walked off into the open world.
- **Rails.** Along the open S and E edges, every 0.25 m, the rails must stand ≥ 1.2 m above the deck just inside, with no gap under them. Measured: 9.86 m (they run to y 66).
- **Gates.** Each removable gate box (`web_A_col`, `web_B_col`, `outcrop_mouth_plug_col`) must cover its tunnel section. The section is flood-filled in the box's mid-plane from the field. No point with a capsule radius of air may lie outside the box, and the section must close within 7 m. Measured: 0 outside for all three (sections of 20, 28 and 32 m²).
- **Perch.** The decoded `cave_A_col` must carry a walk from `perch_foot` east to the perch top (30.15) with steps ≤ 0.45 m. Measured: steps ≤ 0.09 m.
- **Openings.** The cave opens to the sky only at the mouth. Every walk sample has rock overhead except the last 1.5 m.
- **Walkability, on the field and its colliders.** The centreline is sampled every 0.5 m. Each sample takes the **largest vertical air gap** of its column, from 2.5 m below the design floor to 2.5 m above its clear height. A sample fails if:
  - its column has no air (**sealed**);
  - the gap has no floor in the window (**hole**);
  - the gap is under 2.6 m (**low**);
  - the half-width is under 0.9 m (**narrow**). Half-width is measured **across the tunnel tangent**, at 1.2 m above the floor, to the nearer wall;
  - there is no collider on the floor.

  Only `paths.chasm` and the keep's drain passage (entry, z > −688.88) are exempt. Lines 1 m to either side are also checked where they stand in the open. Everywhere: steps are ≤ 0.45 up and ≤ 0.5 down, head room is ≥ 2.2 m, and there is rock overhead except in the last 1.5 m.
- **Connectivity.** The centreline samples are chained breach → entry → toSpider → toDen → exit. Every run of failed samples is an error, except two: the drain passage at the very start, and **one** chasm run whose banks are ≤ 12 m apart with the line between them over the water. Tunnels must meet end to start (≤ 0.75 m apart, step ≤ 0.45 m). The chain must start within 1 m of `breach` and end within 1 m of `balcony_mouth`.
- **Walkability, on the decoded GLBs.** This check runs before anything is emitted. It uses the shipped colliders, quantised, without the removable web, cocoon and plug bodies. Every anchor must sit within 3 cm of a collider. The walk chain is sampled every 0.25 m, ending at `balcony_mouth`. There must be a collider everywhere, the same step and head-room limits apply, and the only gap allowed is one bank-to-bank crossing of `paths.chasm`. Any other gap over 2.05 m fails; there is no distance-based skip.
- **Drain join, across steps** (`tools/build-assets.mjs`, `tools/lib/joins.mjs`). This gate runs before the manifest is written. `cave/anchors` `joins.drain.keep` must equal `keep/anchors` `rooms.drain` within 2 mm. The cave's opening (`stats.breach.bbox`) must also fill that room within 8 cm. This catches a `--only=keep/` build that changes the drain while reusing the old cave, and the reverse. The error message gives the fix: `--only=keep/,cave/`.
- **Drawbridge and slab envelope** (procprops). Raised 0–60°, broken at −35°, and the slab's drop all stay ≥ 0.48 m from the rock. The slab's top may touch the dome, which it breaks out of.
- **Vista.** Lines to the keep top, square, tower and inn clear the outcrop by ≥ 0.31 m. They leave the deck at its SE corner, 0.8–1.4 m above it, so keep tall props 1.5 m from `outcrop.viewCorridor`.
- **Scatter.** The outcrop lies inside `SCATTER_EXCLUDE` (`tools/gen/scatter.mjs`, r 19 m around (−18, −676)). It is applied after each instance's random draws, so `cart/scatter` is byte-identical.

**Validation** (fails the build):
- **Design §4.3 limits:**
  - cover ≥ 1.5 m outside x > −27, z > −686 (measured 6.62);
  - clearance ≥ 2.6 m, as the largest air gap of the centreline column (measured 4.02 at entry s 4.5; the keep's 2.6 m drain is exempt);
  - half-width ≥ 0.9 m across the tangent, to the nearer wall (1.15, at entry s 2 just inside the drain);
  - untreated slope ≤ 35° (entry 27.8°, toSpider 14.0°, toDen 15.2°, exit 24.2°; the stair is treated);
  - wrong winding ≤ 1 % (0.26 %).
- **Plus:**
  - the walk path continuous from `breach` to `balcony_mouth` except across the chasm;
  - anchors on floors;
  - riser ≤ 0.4;
  - perch ramp ≤ 45°;
  - platform flat within 8 cm;
  - chimney open;
  - the joins above.
- **Plus, on the decoded GLBs (before anything is emitted):** the walk; the town-chapter set (render closure and floors), the enclosure, the rails, the gates and the perch ramp (see Joins); and no two node names across the three GLBs that differ only by case.
- **Mutation-tested** by `node tools/check-cave-mutations.mjs` (`npm run check-cave`). Each mutation edits a copy of `cave.mjs` and runs `buildCave` up to its first emit. The build must fail **with the expected message**, and the unmutated source must pass. There are 21 runs, four at a time, about 50 s each, so the whole test takes about 4 minutes. Nothing is written to `public/`. Each of these fails the build:
  - no cap over the hole (`EXIT_HOLE is not covered`);
  - no mouth constraint (`the runtime terrain collider reaches into the tunnel`);
  - no stair ramp (`stair ramp … vs rock floor`);
  - a drain box 10 cm too wide (`cave vertices at the drain plane lie outside the keep's opening`);
  - the hood lowered to 56.5 (`no ceiling above the floor`);
  - **sealed exit:** an 0.8 m wall at s ≈ 50 (`walk path breach → balcony_mouth broken: exit s 50…50.5 (sealed ×2)`);
  - **sealed toDen:** a 1 m wall at (−6, −741) (`… toDen s 26…26.5 (sealed ×2)`);
  - **sealed exit with the field validator off:** the decoded-GLB walk alone fails (`walk: gap of … m outside the chasm between exit …`, `no decoded collider`);
  - **narrowed toSpider:** control half-width 0.45 between the chambers (`half-width 0.60 m < 0.9 across the tunnel at toSpider`);
  - **pinched toDen:** two rock pillars leave a 1.4 m waist (`half-width 0.75 m < 0.9`);
  - **low toDen:** the ceiling at 2.2 m over 3 m (`clearance 2.02 m < 2.6`);
  - **skin_crack:** the ground triangles at the crease are dropped as before (`the outcrop skin's border is not under the render terrain at 54 of 327 vertices … worst 0.63 m above`);
  - **stub_in_cave:** the stub ships in `cave/mesh` again, which is the first review's finding (`muster set (cave/outcrop without cave/mesh): 920 of 34980 rays toward zone E reach the void`);
  - **stub_no_collider:** the stub's render stays in the outcrop but its collider goes to `cave_E_col` (`muster set: … standable floors outside the mouth plug have no collider within 0.45 m`);
  - **hood_short:** the hood ends at x −15, as in the first review, so the deck's N edge continues as a shelf onto the hillside (`enclosure: the capsule … from the platform leaves the rails' envelope`);
  - **no_W_wall:** no wall over the shoulder (`enclosure: the capsule from the hillside reaches the mouth`);
  - **rails_low:** the S and E rails 0.2 m high (`rails: only 0.11 m above the deck`);
  - **no_perch_ramp:** no perch ramp collider (`perch: the decoded ramp does not climb from perch_foot to the perch top`);
  - **web_narrow:** web boxes a quarter of their width (`gate web_A: its box … does not cover the tunnel section in its plane`, and the same for web_B);
  - **plug_narrow:** the plug box a quarter of the tunnel's width (`gate outcrop_mouth_plug: its box … does not cover …`).

  `hood_low` now lowers the hood of the current outcrop (`max x −7.8`). Removing the platform slab fill is not caught, and it is harmless: the outcrop's cut already fills the deck.

**Raw → shipped:** 72.0k triangles → 30.3k render (A 7.5k, B 3.5k, C 4.0k, D 8.0k, E 0.8k, outcrop and stub 6.3k) → 10.2k collider. The field, meshing and validation take about 31 s. The checks of the decoded GLBs and the encoding take about 20 s more.

**Runtime integration checklist (cave).** These are runtime changes in `src/**`:
1. **Outcrop with the town. This is a blocker for shipping this manifest.** `cart/terrain` cuts `EXIT_HOLE`, and the runtime opens the collider there because its cover ships. Until `ensureTown` loads `cave/outcrop`, the game has an uncovered 10 × 8 m hole into the void on the hillside 75 m west of the keep. It is visible from the square and is a fall-through.
   - Load `cave/outcrop` in `ensureTown`, in muster and every later chapter. Add `outcrop_rock` to the outdoor visibility set. Bind its materials' `extras.textures` (`outcrop_rock` and `cave_moss`, both `cave/tex/moss_*`, which ship in muster with it).
   - Build `outcrop_col`, `outcrop_rails_col` and `outcrop_mouth_plug_col` with the town's static bodies.
   - In `src/world/terrainHoles.ts`, set `EXIT_HOLE.cover` to `"cave/outcrop"` to mirror `tools/gen/terrainHoles.mjs`. That makes the build's warning go away. The hole then opens only when the geometry that covers it ships.
2. **`ensureUnderground`.**
   - Load `cave/mesh_a` (keep) and `cave/mesh` (exit) plus `cave/anchors`.
   - `setEnabled(false)` every `*_col`, and build one static body per collider node.
   - Tags: `web_A`, `web_B`, the courier cocoon and `blocker_mouth` for the plug.
3. **Textures.** Bind `extras.textures` per material as above, sharing the textures between both GLBs. Set `hasVertexAlpha = false` on the rock materials.
4. **Zones.** Define A–E from `zones`, in order. `show: cave_X` toggles the render node, and the neighbours stay shown. Colliders stay on.
5. **Mouth.** When `cave/mesh` is shown, hide `outcrop_mouth_plug` and remove its body, and remove `drain_plug` in the keep (K9). Keep `outcrop_rock` and `outcrop_col` on: the stub in front of the plug is only in them, and `cave_E` and `cave_E_col` meet them edge to edge, with a one-triangle ring.
6. **Water.** Bind and scroll `fx/water_n`. Use the volumes for respawn and slow.

**Deviations:**
- **Moss textures in muster.** §10.6 lists `mossy_rock` under exit. It ships in **muster**, because the outcrop, shown with the town from muster on, binds it. Muster's start pack grows by 0.35 MB and exit's shrinks by the same. The rock, ground and pebble sets stay in keep, and the outcrop binds none of them.
- **Asset split.** §10.1 has one `cave/mesh` (zones A–E). It ships as:
  - `cave/mesh_a`, zone A, in segment keep;
  - `cave/mesh`, zones B–E behind the mouth plug, in exit;
  - `cave/outcrop`, in **muster**. The hole is cut in `cart/terrain` from the first chapter, and the outcrop is visible from the square, so it has to come with the town. It carries the mouth in front of the plug (the stub), so it closes and floors the mouth by itself, and it is `EXIT_HOLE.cover`. §3.1's table says the hole is covered by the "outcrop footprint", and the earlier build named `cave/mesh`.
- **Textures.**
  - The cave textures are standalone `cave/tex/*` assets, bound from material extras. They are not embedded, because embedding would have duplicated them in two segments.
  - The web atlas is embedded in `cave/mesh` (material `cave_web`). There is no separate `fx/webs` asset.
- **Outcrop shape.**
  - The box reaches down to y 36. With the design's 46.5 bottom it floats over the SE terrain, which falls to 40.
  - It has a large warp, a taper and bedding.
  - It adds a **west shoulder** (to y 58.6) that walls the platform's west side, and a **cap over the whole hole**.
  - The **hood** runs east to the cliff (x −23…−7.8, not −15). Before, the box's top continued the deck's N edge east of x −15 as a level shelf, 56.2–56.9, onto the hillside, so the platform could be walked onto from the town.
  - The rails are an **enclosure**: S and E rails over the open edges plus W and N walls over the rock sides, all to y 66. §4.4 has only "invisible 1.2 m rails" on the open edges. The walls stop anyone who reaches the outcrop's top from the hillside from dropping onto the deck.
  - **No overhang at the ground line.** Ground triangles at the crease with the steep west slope stay with the skin, so its border is under the terrain mesh (see Joins).
  - Its skin spans x −25.8…−7.5 and z −683.8…−663.4, which is the design footprint plus 1.5 m on the east (the hood). It stays inside `SCATTER_EXCLUDE` with a 1 m margin; the build checks this.
- **Perch.** The ledge falls from 27.95 at the box to 27.1 at x 50, so the flight is 8 risers of 0.378 m starting at x 50.35, not 0.4 m steps from 52.8. Its collider is a 40° ramp.
- **Web walls** are sized to the tunnel section (A 5.9 × 5.15 m, B 7.45 × 5.55 m), not 4.4 × 3.6.
- **Water** flows west, along the channel from x 64 to x 32. §4.3 says "flowing south".
- **Anchor values.** `den_path` passes the wolf at 5.17 m, not 5.5. `interrog_body` stands at 27.29, not 27.9. `bones_3` is moved, as noted above. `chimney_base` is split into `chimney_mouth` and `chimney_top`.
- **Scatter exclusion** is 19 m, not 10, to cover the outcrop's footprint. No scatter stood within 25 m of it, so nothing changed.
- **Respawn** (`respawn_outcrop`) covers the skin plus 1 m (x to −6.5), not the design footprint (x ≤ −9), and stops at z −676.
- **Not built here:**
  - the brow `ph/rock_face_02` and the lip boulders (anchors and suggestions only, for the props unit);
  - the drawbridge, lever, winch, slab, bones and camp fire (procprops and props units; anchors only);
  - the `roots` den texture (optional, cut).

### Props (`kit/fpm`, `procprops/*`, `props/meta`, Poly Haven additions)

Built by one build step, `props/`: `tools/gen/props.mjs` runs `tools/gen/propkit.mjs` (the Quaternius kit) and `tools/gen/procprops.mjs` (the procedural props), then writes `props/meta`. Two helpers sit beside them: `tools/lib/handheld.mjs` (attach recipes and a forward-kinematics check of them against the UAL source clips) and `tools/lib/zipget.mjs` (ranged zip extraction plus the itch.io handshake, used by `tools/fetch-extra.mjs`). `shapes.mjs` gains `torus()` and `tube()`. Rebuild with `node tools/build-assets.mjs --only=props/`, which takes about 9 s with a warm KTX cache. `--only=kit/` and `--only=procprops/` select the same step: the step declares the prefixes it emits as aliases. An `--only` entry that selects no step now prints a warning, because it rebuilds nothing. The step reads the shipped `cave/anchors`, `cave/mesh_a` and `keep/anchors`, so it runs after `cave/` and `keep/interior` (built or reused). It also loads `tools/gen/cave.mjs` for the rock field, and the build fails if that module does not load. The new Poly Haven models are ordinary `ph/<id>` steps.

Sources: `FPM_KIT` in `tools/sources.mjs` lists the 34 kit models, the trim textures and the licence. `tools/fetch-extra.mjs` pulls only those files (about 39 MB) out of the 150 MB zip into `assets-src/props/fpm/` using ranged requests (itch upload 13887750). `zipExtract` checks every entry's inflated size and CRC-32 against the zip's directory. The fetch then checks all 82 files against `tools/sources-fpm.sha256`, which is in `sha256sum` format; the files on disk were verified against the zip's CRC-32s when it was pinned. The licence (`License_Standard.txt` → `LICENSE.txt`) is one of the 82 files. If the zip lacks it, the fetch fails instead of skipping it quietly. `PH_MODELS` adds `wooden_table_02`, `stone_fire_pit` and `rock_face_02`, and `PH_TEXTURES` adds `weathered_planks` (the deck). Credits: `quaternius-fpm` is in `tools/credits-extra.mjs`. The Poly Haven ids are credited automatically through the `PH` table and the `phIds` list (`weathered_planks` was added to it).

| Manifest id | Type | Segment | Priority, `pos` | Raw / brotli | Content |
|---|---|---|---|---|---|
| `kit/fpm` | glb | **keep** | 92, [60, −662] | 1.85 MB / 1.46 MB | 34 Fantasy Props MegaKit models, 46.4k triangles, 5 materials. Trim sets at 1024² (colour and normal) plus 512² ORM, the cloth set at 512², the page texture at 256² (see Deviations). Four chest clips. |
| `procprops/keep` | glb | **keep** | 91, [52, −700] | 1.03 MB / 0.65 MB | 21 procedural props, 39.9k triangles (the gallery set piece is 26.5k, mostly chain links), 11 colliders. |
| `procprops/exit` | glb | **exit** | 90, [−22, −718] | 44 KB / 29 KB | The den's three bone piles, 3.8k triangles, vertex colour only. |
| `props/meta` | json | keep | 93, [60, −662] | 32 KB / 8 KB | Resolution table, per-prop data, attach recipes, world placements and joins (below). Load it with `loadJSON("props/meta")`. |
| `ph/wooden_table_02` | glb | keep | 90, [60, −662] | 142 KB / 138 KB | 196 triangles, 512² textures. The hall's cover tables. |
| `ph/stone_fire_pit` | glb | keep | 88, [53.5, −724] | 224 KB / 218 KB | Simplified to 2.9k triangles, 512² textures. The cave camp. |
| `ph/rock_face_02` | glb | **muster, streamed** | 60, [−19, −675] | 718 KB / 710 KB | Simplified to 4.4k triangles, 1024² textures. The outcrop brow. |

Start packs (brotli) after the first build (`--only=props/`, manifest `453014cd35b7`): keep **6.27 MB** (3.79 MB before; limit 15), exit **0.39 MB** (0.37 before). Muster stays at 12.57 MB, because the brow streams. The other segments are unchanged. All 94 earlier ids still exist with unchanged hashes. Seven ids are new.

After the review fixes (`--only=props/`, manifest `68300d7447b0`), the start packs are unchanged at keep 6.27 MB and exit 0.39 MB. All 101 ids still exist. Only `kit/fpm` (the stand's `leanRest`), `procprops/keep` and `props/meta` changed.

**Conventions** (both GLBs; repeated in `props/meta.conventions`):
- **One top-level node per prop.**
  - It sits at the origin with an identity transform. Instantiate it by name: `kit/fpm#Barrel` or `procprops/keep#cage`. `gear.ts`'s `instantiate(world, "id#node")` already does this.
  - Geometry is on `<node>_mesh` leaf children, so mesh quantisation only moves those.
  - Colliders are `*_col` nodes: POSITION only, no material. Hide them and build static bodies from their world geometry. Their glTF extras carry `tag` (and `state` on the bridge decks).
  - Anchors are empty nodes.
  - Moving parts are pivot nodes whose identity is the rest pose: door closed, lever at rest (leaning about 55° toward the puller, not upright), deck lowered.
- **No mesh is shared between nodes.** A glTF mesh used twice becomes a Babylon InstancedMesh tied to the other node, which breaks per-node instantiation. The build fails if a mesh is shared.
- **Facing.** Placeable props face **−Z**, the anchors' facing convention: `rotation.y = yaw` turns local −Z to the facing. The kit models face +Z in the source and are turned 180°. Held items keep their source axes, which the runtime recipes assume (`Sword_Bronze`: handle +Y, edge +X). Wall props (`Torch_Metal`, `Lantern_Wall`, `Peg_Rack`, `Shelf_Small_Bottles`, `sconce`) have their back on the plane z = 0.
- **glTF extras.** Each top-level node's extras (Babylon: `node.metadata.gltf.extras`) carry the same data as `props/meta`.
- **Colours.** COLOR_0 is VEC3 UNORM8, so there is no vertex alpha and `hasVertexAlpha` needs no fix. `loadGLB` applies the light budget.

**`kit/fpm`** (`tools/gen/propkit.mjs`):
- **Models.**
  - Weapons and held items: Sword_Bronze, Axe_Bronze, Shield_Wooden.
  - Lights: Torch_Metal, Lantern_Wall, Candle_1.
  - Containers: Barrel, Crate_Wooden, Crate_Metal, Chest_Wood, Bag, Pouch_Large.
  - Furniture: Table_Large, Chair_1, Bench, Stool, Bed_Twin1, WeaponStand, Peg_Rack, Shelf_Small_Bottles, Dummy.
  - Metalwork: Chain_Coil, Cage_Small, Cauldron, Key_Metal.
  - Bottles: Potion_1/2/4, Bottle_1, SmallBottle, SmallBottles_1.
  - Small items: Scroll_1, **Book** (source `Book_7`, laid on y = 0), Mug.
- **Fixes over the source files** (research/props.md "Build gotchas"):
  - COLOR_0 on materials not named `_Vertex` becomes a grey multiplier at 30 % of its luminance deficit. It is dropped where it is all white.
  - The weapons' bronze tints are retinted: the blade to steel, the fittings to iron and the grip to leather. The shield's rim and boss become iron.
  - Each material also binds the ORM image as occlusion.
  - The palette is muted through `baseColorFactor` (furniture 0.8, metal 0.85, props 0.9, cloth 0.78).
- **Materials:** `fpm_furniture`, `fpm_metal`, `fpm_props`, `fpm_cloth`, `fpm_page`.
- **`Chest_Wood` is rigid, not skinned.** The source skin is rigid: the base is 100 % `Chest_Bottom` and the lid 100 % `Chest_Top`.
  - Nodes: `Chest_Wood` → `Chest_Wood_body` → `Chest_Wood_mesh` and the hinge `Chest_Wood_lid` (at (0, 0.429, 0.314), the back edge) → `Chest_Wood_lid_mesh`.
  - The four clips are retargeted to `Chest_Wood_body` and `Chest_Wood_lid` and renamed **`Chest_Wood_Open`, `Chest_Wood_Opened`, `Chest_Wood_Close`, `Chest_Wood_Closed`**. This avoids a clash with the UAL body clip `Chest_Open`.
  - The rest pose is closed. Either play the clip (an animation group of the container), or set `Chest_Wood_lid.rotationQuaternion = RotationAxis(+X, t · 2.1358)` (122°, opens backward).
  - `Chest_Wood_loot` marks where a looted item sits.
- **Anchors** (empty children, named `<Model>_<anchor>`):

  | Model | Anchors |
  |---|---|
  | `Torch_Metal`, `Lantern_Wall`, `Candle_1` | `_flame` |
  | `Cauldron` | `_fire` (the brazier flame) |
  | `Table_Large` | `_top` (y 0.815) |
  | `Chair_1`, `Bench`, `Stool` | `_sit` (seat height) |
  | `Bed_Twin1` | `_lie` |
  | `WeaponStand` | `_slot_0`…`_slot_4` at x −0.35, −0.17, 0, 0.17, 0.35 **on the floor (y 0)**, under the five notches of the top bar (y 0.84) that hold the weapons upright. The slots are turned 90° about Y so a blade's flat faces along the bar. An upright weapon stands with its lowest point on its slot (`placements.weapon_stands` lifts it already). Also `_lean` (0, 0, −0.55), on the floor in front of the stand, where a shield's tip goes. Meta `leanRest` gives the front of the top bar, where the shield rests (z −0.137, y 0.81…0.86). |
  | `Shelf_Small_Bottles` | `_top_0`, `_top_1` (on the top board, for the two `Potion_2`) |

**Attach recipes** (`props/meta.held`, keyed `asset#node`; also in each node's extras `held`).
- A recipe is what `attachToSocket(item, BoneSocket(bone), recipe)` takes. The model-space `grip` point lands on the grip centre (∓0.03, 0.095, 0). Hand +Z is the grip axis toward the business end, and hand +Y points toward the fingers.
- Each recipe was checked by forward kinematics on the UAL source clips; a failed check fails the build. They were also rendered on the posed base body in Blender (sword, torch, shield, bow).

| Item | Bone | `rotation` | `position` | Grip (model) | Checked |
|---|---|---|---|---|---|
| `kit/fpm#Sword_Bronze` | `hand_r` | (0.5, 0.5, 0.5, 0.5), as §3.3 | (−0.03, 0.095, −0.026) | (0, 0.026, 0): under the guard. The leather grip runs y −0.109…0.076. | blade up in `Sword_Attack` @0.4: 25° |
| `kit/fpm#Axe_Bronze` | `hand_r` | (0.5, −0.5, −0.5, 0.5) | (−0.03, 0.102, 0.291) | (0.007, −0.291, 0): 9 cm above the butt; the blade (−X) toward the knuckles | head up in `Sword_Attack` @0.4: 25° |
| `kit/fpm#Shield_Wooden` | `hand_l` | (0.5, −0.5, −0.5, 0.5) | (0.041, 0.095, 0) | (0, 0, 0.011): the vertical bar on the back; the face is +Z | faces forward in `Idle_Shield_Loop` (7°) and `Shield_OneShot` (5°) |
| `procprops/keep#torch` | `hand_l` | (0.7071, 0, 0, 0.7071) | (0.03, 0.095, −0.14) | (0, 0.14, 0); the flame anchor `torch_flame` is at (0, 0.62, 0) | flame up in `Idle_Torch_Loop`: 18° |
| `procprops/keep#bow` | `hand_l` | (0.7071, 0, 0, 0.7071) | (0.03, 0.095, 0) | (0, 0, 0) | back faces forward (12°) and upper limb up (1°) in `Bow_Aim_Neutral` |
| `procprops/keep#paper_warrant` | `hand_l` | (0.5, −0.5, 0.5, 0.5) | (0.06, 0.155, 0) | (0, 0.03, 0.06): the sheet is held in front of the hand | written side faces forward in `Interact` @0.8: 21° |
| `ph/kite_shield` | `hand_l` | (0.5, −0.5, −0.5, 0.5), as §3.3 | (−0.001, 0.095, −0.05) | (0, 0.05, −0.031): the model has no handle, so the fist sits 3.5 cm behind the back at its centre; the face is +Z | faces forward in `Idle_Shield_Loop` (7°) and `Shield_OneShot` (5°). The entry carries `tune: true`: tune the position by eye. |
| `ph/wooden_axe_03` | `hand_r` | (0, 0.7071, 0.7071, 0), as §3.3 | (−0.03, 0.095, 0.15) | | not re-measured; **`scale` 1.25**, also on its stand |
| `kit/fpm#Potion_2`, `kit/fpm#Key_Metal`, `procprops/keep#key_ring` | see the meta | | | | upright; no clip pins their roll, so tune by eye |
| `procprops/keep#cuffs_rope` | `cuffs_rope_l` on `hand_l`, `cuffs_rope_r` on `hand_r` | identity | (0, 0.008, 0) | | The coil clears both base bodies' wrists, checked on the skins' bind pose: it is filled to 0.99 (male) and 0.88 (female) of its inner section. `BoneSocket` ignores bone scale, so a forearm the appearance sliders thicken may touch it. |

**Runtime note on the sword:** `gear.ts` estimates the sword's grip from its bounds at pommel + 0.09, which is y −0.118. That is 14 cm below the measured grip (0.026) and puts the hand on the pommel. Use `props/meta.held["kit/fpm#Sword_Bronze"]`. The `ph/wooden_axe_03` entry copies the §3.3 recipe, which was not re-measured. The `ph/kite_shield` entry keeps the §3.3 rotation and has a measured, numeric position; every `held` recipe now has a numeric `position`. Some recipes also have a `scale`, which the runtime must apply.

**`procprops/keep`** (top-level nodes):

| Node | What | Runtime use |
|---|---|---|
| `gallery_bridge` | The gallery set piece, in **world axes with its origin on the cave anchor `bridge_hinge`** (48, 27, −735.6). Place it there with yaw 0 (`placements.gallery_bridge`). It contains the deck, hinge frame, pulleys, chains, winch, lever and slab, all placed from the cave anchors at build time. | See "Gallery set piece" below. |
| `cage` | The prisoner cage, 2.0 × 2.2 × 2.0 m. Children: `cage_frame`, `cage_col` (6 static boxes; door opening left open), hinge `cage_door` at (−0.45, 0, −1.0) with `cage_door_mesh` and `cage_door_col` (tag `cage_door`), and `cage_inside`. | Door on the −Z face; at `prop_cage` (yaw −π/2) it faces +X. Open with `cage_door.rotationQuaternion = RotationAxis(Up, t · π/2)`; it opens outward. |
| `strap_chair` | Chair with arm, ankle and chest straps; `strap_chair_col`, `strap_chair_sit`. | `prop_strap_chair` |
| `shackles` | Wall plates, rings, wrist chains and cuffs, and an ankle chain. The wall is at z +0.3. `shackles_cuff_l/r` are at (∓0.30, 1.25, 0.10). | `prop_shackles_corpse`: pose the corpse's wrists at the cuff anchors. |
| `bars_panel` | Barred panel 1.0 × 2.4 m (bars r 15 mm every 0.12 m, like the cell fronts), with `bars_panel_col` (tag `bars`). | Spare blocker. |
| `chain_link`, `chain_strip`, `chain_hang` | One link; a 1 m chain along +Y with 8 links, which tiles seamlessly end to end; a 2 m chain hanging from a ceiling ring. | Live chains; dressing. |
| `cuffs_rope` → `cuffs_rope_l`, `cuffs_rope_r` (mirrored) | Rope coils for the K1 bonds. | Recipes above; remove them when the bonds are cut. |
| `bow` | Recurve bow: limbs ±Y, string on +Z, back −Z. Children: `bow_limbs`, `bow_string` (a separate mesh), `bow_nock` (string centre, brace 0.198 m), `bow_string_top` / `bow_string_bottom` (where the string leaves the limbs), `bow_rest`. | While drawing, hide `bow_string` and draw `bow_string_top` → hand → `bow_string_bottom`. |
| `arrow` | Along **+Z**, tip at +0.42, nock at −0.39: the same convention as `src/prologue/fx/arrow.ts`. | Can replace the built-in arrow template. |
| `torch` | Hand torch: shaft +Y, `torch_flame` at (0, 0.62, 0). | Companion's torch (K9–X3) |
| `sconce` | Wall bracket plus torch, baked into **one vertex-coloured primitive** (`sconce_mesh`, material `pp_vcol`, 792 triangles), so each sconce costs one draw call. Origin on the light anchor's **`wall`** point, wall plane z = 0, facing −Z. `sconce_flame` (0, 0, −0.22) lands exactly on the light anchor. | Placed on all 20 sconce lights (`placements.sconces`): 20 draw calls, against the 60 the textured version needed. All sconces share `pp_vcol`, so the runtime can merge or thin-instance them per zone if draw calls run short. |
| `sconce_empty` | The same bracket without its torch (`sconce_empty_mesh`, `sconce_empty_flame`). | K9: replace the sconce whose torch the companion takes with `sconce_empty` (same transform), and hang a `torch` on the companion. |
| `straw_bed` | Straw mound and loose strands, 1.8 × 0.9 m, long along X; double-sided straw material; no collider. | `placements.straw_beds`: one along the back wall of each of the 10 cells |
| `drain_grate` | The bent and broken grate in the drain mouth. Origin at the opening's bottom centre on the B5 wall face; the bars are 8 cm inside. The middle is forced open (x ±0.62, full height). `drain_grate_col` holds the two side clusters (tag `drain_grate`), leaving 1.40 m between them. | `placements.drain_grate` (54.1, 32.13, −688.0), yaw 0 |
| `paper_warrant`, `paper_letter` | Sealed sheet 0.21 × 0.30 m: written front (−Z), blank back, procedural parchment. Sealed letter packet. | K6 bluff (Ivo, `hand_l`); footlocker and cocoon letter |
| `dice` | Two bone dice; origin on the table top. | `placements.dice` on the jailer's table |
| `brazier_irons` | Three branding irons for the B3 brazier (`kit/fpm#Cauldron`), sharing its anchor. | `prop_brazier_b3` |
| `key_ring` | Ring with three keys; origin at the ring. | The `keyring` item. The thrown single key can be `kit/fpm#Key_Metal`. |

**Gallery set piece** (`gallery_bridge`; data in its extras and `props/meta.procprops.keep.gallery_bridge`):
- **Deck.**
  - Pivot `bridge_hinge`. Set `rotationQuaternion = RotationAxis(+X, angle)`: **raised −1.0472** (−60°), **lowered 0** (identity), **broken +0.6109** (+35°).
  - The deck is 1.8 × 0.25 × 8.8 m, with its top at hinge + 0.15. The lowered deck meets the banks with a 0.15 m step at the north end and 0.12 m at the south.
  - Children:
    - `bridge_deck_south` (the first 5.2 m);
    - six **`bridge_plank_0…5`** (0.6 m each, the north 3.6 m). Each node sits at its plank's centre, and its extras give `debris.half` (0.91, 0.13, 0.3) and `massHint`;
    - the chain eyes `bridge_tip_w` and `bridge_tip_e`.
  - To break the deck: hide the six planks, spawn `Debris` boxes at their world transforms, then swing the hinge to `broken`.
- **Colliders**, one per state, all static: `bridge_deck_raised_col`, `bridge_deck_lowered_col` and `bridge_deck_broken_col` (tags `bridge_deck_{raised,lowered,broken}`, per §3.1). Enable one at a time. Always on: `bridge_frame_col` (the hinge blocks beside the deck), `winch_col` and `lever_col`.
- **Chains.**
  - The tip chains run to two pulleys on the dome above mid-span, at x ∓1.4, 0.5 m north of the raised deck's tip eyes (z −730.9).
    - Their height comes from the rock field: the build finds the ceiling above each bracket's footprint and puts the plate's top 4 cm into the rock at the footprint's highest point. Now that is y 34.955 (west) and 35.087 (east), with the ceilings at 35.435 and 35.567. `extras.pulleys` records both.
    - The slab (2.4 m wide, measured half-width 1.221) falls between them; the build checks it clears the pulleys' inner cheeks (1.3).
  - From the pulleys, `bridge_haul_chains` run down to the winch drum. They are always shown and pass 2.4 m or more above the north ledge.
  - Per-state static chains: `bridge_chain_raised`, `bridge_chain_lowered`, and `bridge_chain_broken` (hanging 3.1 m from the sheaves).
  - While the deck moves, hide them and draw each chain from `bridge_sheave_w/e` to `bridge_tip_w/e`. Use `n = max(1, round(L))` `chain_strip` instances, each scaled by L/n along Y.
- **Winch.**
  - The `winch` node sits on the cave anchor `winch`. It is turned (yaw 2.58) so the drum's axis (winch-local +X) lies across the haul.
  - `winch_drum` (pivot at the drum axis, 0.78 m up) carries the drum, coiled chain, ratchet and crank; spin it while the deck moves.
  - The stone foundation is sunk into the sloping ledge; the build checks that the floor lies between its bottom and top across its footprint.
- **Lever.**
  - The `lever` node sits on the cave anchor `lever` (world axes). Pivot `lever_pivot` is at lever-local (0.1, 1.0, −0.4), axis +X.
  - **Identity is the rest pose.** In it the handle leans about **55° from vertical toward the puller** (`extras.lever.restAngle` 0.9527 rad from +Y toward +Z): `lever_grip` is at (0, 0.707, 0.994) from the pivot. Pulling adds up to **+0.6457** rad, which turns the handle further down toward the puller, ending about 2° below horizontal.
  - The shaft now ends 5 cm past the grip, at radius 1.27 (it was 1.34). With the full overhang, the end came within 0.13 m of the puller's right thigh and spine bones at full pull. The build now checks the handle's outer part (radius 0.9 to the end) against the pelvis, spine, thigh, calf and upper-arm bones over the whole pull, and requires at least 0.17 m. The current clearances are 0.20 m (`thigh_r`) and 0.22 m (pelvis, spine); see `extras.lever.bodyClear`.
  - `lever_grip` is the grip point, at radius 1.22, 5 cm short of the handle's end.
  - The pivot was fitted to `Farm_PickingTree`'s right-hand grip path with the puller on `lever_stance` facing −Z. The hand grabs at **1.06 s** and pulls until **1.68 s**.
  - `extras.lever.clip.curve` gives the handle angle per clip second. Driven by it, `lever_grip` stays within **0.18 m** of the hand (`handGap` 0.179). **Expect that gap to show.**
    - Most of the gap is sideways: the hand drifts from x −0.09 to +0.17 m across the lever's plane during the pull (`extras.lever.lateral`). The radial error is small.
    - A planar lever cannot follow that drift. A best-fit lever turned 11° about Y gets only to 0.15 m, so the fit is kept.
    - **Runtime:** pull `hand_r` onto `lever_grip` with a small two-bone IK over `extras.lever.ik.window` (1.06…1.68 s), blending in and out over about 0.1 s. Alternatively, shift the stance by up to −0.04 m in x to centre the drift on the plane, and accept the rest of the gap.
- **Slab.** `slab` (2.4 × 1.0 × 1.8 m rock chunk) at the cave anchor `slab_drop`, with extras `debris.half` (1.2, 0.5, 0.9). It sits 0.2 m under the dome and **overlaps the raised deck**, so keep it hidden until K12 2.8 s, then drop it as a Debris box.
- **Material `pp_rock`.** The slab, the hinge blocks, the winch foundation and the lever block use `pp_rock`. It is untextured in the GLB and its extras name `cave/tex/rock_{d,n,arm}`, tile 2.0. Bind it with the cave's code (§ "Cave and balcony outcrop").
- **Checked against the cave's rock field** (`tools/gen/cave.mjs` `_debug.S`); the build fails on a miss. Clearance to the rock:

  | Part | Clearance |
  |---|---|
  | Deck raised / lowered / broken (bar the hinge end and the tip resting on the ledge) | 0.50 / 0.20 / 0.12 m |
  | Chains raised / lowered | 0.53 / 0.17 m |
  | Lever sweep | 0.93 m |
  | Winch frame | 0.70 m |
  | Slab body | 0.50 m |

  Also checked: the pulley sheaves are in the air with the brackets' plates in the rock over their whole footprint, the slab clears the pulleys, and the winch and lever bases rest on the floor.
- **The field must be the shipped one.** `tools/gen/procprops.mjs` `checkCaveField` compares `tools/gen/cave.mjs`'s live field with the shipped cave in two ways, and fails with "rebuild both with `--only=cave/,props/`" when either differs:
  - the shipped `cave/mesh_a` collider vertices around the gallery (890 of them) must lie on the field: median 0.8 mm, 0.9 % beyond 5 cm; the limits are 1 cm and 3 %;
  - every cave anchor's floor and clear height (51 anchors) must reproduce.

  This catches a `cave.mjs` edited after the last `cave/` build, which would otherwise fit the props to rock that does not ship.

**`procprops/exit`:** `bones_a` (with a skull), `bones_b` and `bones_c`. Extras give `noiseRadius` 0.6 (§4.3). `placements.bones` puts them on `bones_1…3`.

**Materials** (`procprops/keep`):

| Material | Texture | Use |
|---|---|---|
| `pp_planks` | `weathered_planks` (1024² colour, 512² normal, 256² ARM) | the deck |
| `pp_wood` | `dark_wooden_planks` (512²) | |
| `pp_iron` | `rusty_metal_02` (512²), metallic from ARM | |
| `pp_rock` | cave textures via extras (above) | |
| `pp_leather`, `pp_rope` | flat colours | |
| `pp_vcol` | none; white, colour from COLOR_0 | torch wraps, seals, dice, fletching, bones |
| `pp_straw` | procedural 256², double-sided | |
| `pp_paper` | procedural 512 × 256: front text at u 0…0.5, blank back at u 0.5…1 | |

**`props/meta`** (version 1):
- `resolve`: `"kit/<Model>"` and `"procprops/<name>"` → `{asset, node}`. The keep anchors' `prop` fields (`kit/Chest_Wood`, `kit/Book`, `procprops/cage`, …) resolve through it, and so do the cave anchors' "procprops lever / winch / bones".
- `kit` and `procprops.{keep,exit}`: per-node bounds, facing, anchors, hinges, pivots, colliders and tags.
- `held`: the recipes above.
- **`placements`** (world positions plus a game-convention yaw):

  | Key | What |
  |---|---|
  | `gallery_bridge` | the set piece on `bridge_hinge` |
  | `drain_grate` | the drain mouth |
  | `sconces` | 20 sconces, with their flame points |
  | `straw_beds` | one per cell (10) |
  | `bones` | the three den piles |
  | `cage`, `strap_chair`, `shackles`, `brazier_irons` | the B3 props |
  | `dice` | on the J table top |
  | `records` | `Scroll_1` and `Book` on the B3 table |
  | `store_shelf` | the shelf and its two potions (see below) |
  | `weapon_stands` | Per stand: the items in their slots, already lifted. The rebel stand's `ph/wooden_axe_03` has **`scale` 1.25**, the size it has in the hand, and is lifted for it. On the imperial stand, the kite shield is placed with **`rotation`** (a Babylon quaternion, also given as the node Euler `euler`). Its face is turned to the stand's facing and it is tilted back 25.25°, so its tip is on the floor at the stand's `_lean` point and its back rests on the top bar. This was checked against the source vertices: no vertex is more than 1 cm into the bar. Use `rotation`, not `yaw`. `shield` is `null` on the rebel stand. |
  | `camp_fire` | `ph/stone_fire_pit` at `camp_fire` + 0.15 m (the scan's origin is mid-height) |
  | `outcrop_brow` | `ph/rock_face_02` at the cave's suggestion (−19, 60.5, −674.6) |

  The `use_store_potions` anchor stands 0.6 m off the G4 east wall, so `store_shelf` puts the shelf's back on that wall at x 71.78.
- `joins.inputs`: the sha256 of every shipped file `props/` reads (`PROPS_INPUTS` in `tools/gen/props.mjs`): `cave/anchors`, `cave/mesh_a` and `keep/anchors`.
  - They are the full inputs, not a few picked values: all of `placements` comes from them (the sconces' wall points, the cells, the B3 props, the table, records, storeroom, weapon stands, bones, camp fire and brow), and so do the gallery's rock checks and pulley heights.
  - **A gate in `build-assets.mjs`** (`tools/lib/joins.mjs` `checkPropsJoin`) fails before the manifest is written if any of these ids now ships another hash, is gone, or is not recorded. For example, `--only=cave/` or `--only=keep/interior` alone fails until `props/` is rebuilt with it.
  - `joins.field` records the live-field check above.
- `stats`: the gallery clearances and the lever's hand gap, lateral drift and body clearances.

**Build validation** (fails the build):
- Every kit model is configured, and the encoded kit still names every model at the identity transform.
- Node names are unique and none differs from another only by case.
- No mesh is shared.
- Fewer than 2 % of a prop's triangles are wound against their normals; double-sided materials are exempt.
- The held-item clip checks.
- The lever's hand gap is ≤ 0.25 m.
- The rope cuffs clear both bodies' wrists.
- The gallery rock checks. `tools/gen/cave.mjs` must load and its field must match the shipped cave (`checkCaveField`).
- The pulleys hang from the field's ceiling and their plates reach the rock; the slab clears them.
- The lever's handle stays at least 0.17 m from the puller's body bones throughout the pull.
- The B3 cage, chair and shackles footprints lie inside their rooms.
- The props join: every input in `joins.inputs` is still the shipped file.
- The rope cuffs fail the build when a base body is missing; they are no longer skipped with a note.
- The kite shield's face-forward checks, and its lean resting on the stand's bar within 40°.

**Runtime integration checklist (props):**
1. Load `props/meta`, then `kit/fpm` and `procprops/keep` with the keep chapter and `procprops/exit` with the exit chapter.
   - **Resolve each anchor's `prop` suggestion through `meta.resolve`**, for example `procprops/cage` → `{asset: "procprops/keep", node: "cage"}`. There are no manifest ids per prop. As of this build, `src/prologue/keep/props.ts` `propSources()` guesses `procprops/cage`, `procprops#cage` and `props/procprops#cage`, which match nothing, so every procedural prop falls back to its stand-in.
   - Instantiate the resolved node and place it by the anchor (or by `meta.placements`) and its yaw. Where a placement has `rotation`, use it instead of the yaw. Apply `scale` where a placement has one.
2. Hide every `*_col` and build static bodies from them, using the tags in their extras. For the drawbridge, enable one deck collider per state.
3. **Gallery:**
   - lowering over 4.5 s: deck angle −1.0472 → 0, spin `winch_drum`, live chains;
   - the lever: the `curve` against `Farm_PickingTree`;
   - K12: `slab` shown and dropped, planks to Debris, hinge to +0.6109, `bridge_chain_broken`, `bridge_deck_broken_col`.
4. **Held items:** switch `gear.ts` from the bounds estimate to `meta.held` (the sword's grip above). The torch, bow and warrant recipes are ready.
5. **Chest:** play **`Chest_Wood_Open`**, or drive `Chest_Wood_lid`. As of this build, `props.ts` documents a `Chest_Open` clip. It finds the clip with `/open/i`, which picks `Chest_Wood_Open` only because that clip comes before `Chest_Wood_Opened` (the static open pose) in the file. Match the name exactly.
6. **Sconces:** place them from `placements.sconces`, one draw call each. The flame sprites and pool lights stay on the light anchors. In K9, swap the sconce for `sconce_empty`.
7. **Lever:** drive `lever_pivot` by `extras.lever.clip.curve` and close the remaining hand gap with the IK in `extras.lever.ik` (above).
8. **Outcrop brow:** load the streamed `ph/rock_face_02` with the town (outdoor set) and place it at `placements.outcrop_brow`.
9. **Materials:** bind `pp_rock`'s `extras.textures` with the cave's code.

**Deviations:**
- **`Chest_Wood` is rigid, with renamed clips.** §10.2 asks for the skinned chest with its animated `Chest_Open`. Rigid nodes give the same motion without a skeleton, they instantiate per node, and they open like the doors. `Chest_Open` remains the name of the UAL body clip.
- **Kit texture sizes.** §10.2 asks for "the 4 trim sets at 1024 KTX2". As built, the furniture, metal and props trims are 1024² for colour and normal but **512² for ORM**, and the **cloth set is 512²** for all three maps. The page noise is 256².
  - The ORM maps are low-frequency (occlusion, roughness and metalness of a trim sheet).
  - Cloth covers only the bag, pouch, bed and dummy.
  - The smaller maps reduce GPU memory and download size. The keep start pack is 6.27 MB of its 15 MB limit, so there is room to restore them.
  - To restore the full size, change `MATERIALS` and `compressTextures(doc, 1024, 1024, 512)` in `tools/gen/propkit.mjs`.
- **Kite shield recipe measured.** §3.3 left the position as "tune". The build now derives it from the model's back (it has no handle) and checks it in two clips. It is still flagged `tune: true`.
- **Sconces baked.** The sconce is one vertex-coloured primitive instead of a textured bracket and torch. For K9, `sconce_empty` replaces "hide `sconce_torch`", because the bake has no separate torch node.
- **Kit selection.**
  - `Book` is `Book_7`, renamed, because the anchors ask for `kit/Book`.
  - Added: `Crate_Metal`, `Potion_1/4`, `Bottle_1`, `SmallBottle(s)`, `Mug` and `Candle_1`.
  - Not shipped: `CandleStick` (its tallest point is the handle) and the optional Stylized Nature mushrooms (cut #1).
- **Drawbridge rigging.** §4.3 has "a chain from the winch to the deck tip". A chain from the north bank cannot hold a deck raised toward it, so the chains run from the tip up to two pulleys on the dome and back down to the winch. The raised deck hangs just under the pulleys.
- **Lever timing and grip.** The handle moves during **1.06–1.68 s** of `Farm_PickingTree`, not 0.56–1.68 s: the hand reaches the top only at about 1.0 s. The grab point is 1.78 m high and 0.29 m in front of the puller, against the anchor note's 1.6 m and 0.32 m.
- **Brow segment.** `ph/rock_face_02` ships in **muster, streamed**, not with the chapters. It decorates the outcrop, which is shown with the town from muster on, so loading it in exit would make it pop in.
- **Cell bars.** They stay in `keep/interior`. `bars_panel` is a spare panel.
- **Extra procedural props:** `bars_panel`, `strap_chair`, `brazier_irons`, `dice`, `key_ring`, `paper_letter`, `arrow`, `sconce`, `sconce_empty`, `chain_strip` and `chain_hang`. The keep anchors and the beats ask for them, but §10.1 does not list them.
- **Weapon stand.** The imperial stand's anchor (65.55, −656.75), turned to face −X, puts the stand's back feet 4 cm into the east partition. This was left as anchored.

### Creatures (`creatures/*`)

Built by `tools/gen/creatures.mjs`. The module is self-contained: the source tables `SPIDER` and `WOLF`, the conversion and the checks. Its only dependencies are `@gltf-transform`, `sharp`, `assimpjs` and the shared `lib/gltf` and `lib/ktx` helpers. Rebuild with `node tools/build-assets.mjs --only=creatures/`, which takes about 5 s. The build is deterministic.

**Sources.** `node tools/fetch-extra.mjs` puts them in `assets-src/creatures/`, and every file is pinned by sha256.
- **Spider:** only `FBX/Spider.fbx` is pulled out of the Easy Enemy Pack zip. It uses the itch upload-id flow (upload 1254673, `itchSignedUrl` + ranged `zipExtract`). The fetch also writes the CC0 `LICENSE.txt` note, because the zip has none.
- **Wolf:** `wolf_{walk,run,attack_01,attack_02,idle_01,idle_02,death_01}.glb` come from the pinned ZeroAD-Godot commit. `animal_wolf_grey.png`, `animal_wolf.png` and `LICENSE-0ad-art.txt` come from the pinned 0ad commit. These are the horse's mirrors.
  - **Mirror risk.** ZeroAD-Godot is a third-party repository. If it disappears, the fallback is the upstream Collada at the pinned 0ad commit: `art/meshes/skeletal/wolf.dae` and `art/animation/quadraped/wolf_*.dae` for the wolf, and `horse.dae` and `horse_{walk,trot}.dae` for the horse. All of them returned 200 on 2026-10-06, and `tools/fetch-extra.mjs` names them at each block. Converted files are new files, so their pins and the merge checks must be redone.
  - **Open:** archive the 7 pinned wolf glbs and the 3 horse glbs (for example as a release asset of this repository) so the build no longer depends on someone else's repository. That needs the repository owner; the pipeline did not do it.
- **Tools:** the FBX is converted in Node by `assimpjs`, a new devDependency (MIT, WASM). No Blender is needed.

**Credits.** Two entries in `tools/credits-extra.mjs`:
- `quaternius-easy-enemies`: CC0.
- `0ad-wolf`: CC BY-SA 3.0. Its note marks the wolf as a modified work, licensed share-alike under CC BY-SA 3.0.
- The 0 A.D. art licence (`LICENSE-0ad-art.txt`) requires the attribution to name "Wildfire Games" and to link both http://creativecommons.org/licenses/by-sa/3.0/ and **http://www.wildfiregames.com/**. The credits panel links the entry's name to `source` and the licence name to `licenseUrl`. So `0ad-wolf` and `0ad-horse` (the same licence file) use `source: "http://www.wildfiregames.com/"`, and their note names 0 A.D. and https://play0ad.com.

| Manifest id | Type | Segment | Priority, `pos` | Raw / brotli | Content |
|---|---|---|---|---|---|
| `creatures/spider` | glb | exit | 92, [18, −750] | 164 KB / 85 KB | 2,712 tris, 39 joints, 5 clips, 2 materials, no textures |
| `creatures/wolf` | glb | exit | 90, [−22, −718] | 232 KB / 133 KB | 696 tris, 32 joints, 9 clips, grey fur (256² KTX2) |
| `creatures/wolf_fur_brown` | ktx2 | exit, **streamed** (optional) | 40, [−22, −718] | 29 KB / 29 KB | The 0 A.D. "fur-brown" skin on the same UVs (alpha dropped) |

The creatures add 0.22 MB brotli to the exit start pack, which comes to 0.62 MB with `cave/mesh` and `procprops/exit`.

**GLB layout** (the same for both; every point is checked by the build):
- **Scene root.** One node, `spider` or `wolf`. It is the identity transform, in metres, +Y up, facing glTF +Z (head forward), with its origin on the ground under the body.
- **Children.** Under the scene root are the skinned mesh and the skeleton root joint, which carries the baked uniform scale.
  - Skinned mesh: `spider_mesh` (Babylon splits it into `spider_mesh_primitive0` body and `_primitive1` eyes) or `wolf_mesh`.
  - Skeleton root joint: `Root` at scale 0.4379, or `Bone` at scale 0.45.
  - No other node sits above the joints. Mesh vertices are in model space.
- **Scale 1 is the full-size creature.** Set `CreatureProfile.scale` to 1 for the giant spider and the wolf, and 0.55 for the small spiders.
- **Clips.** The AnimationGroup name is the clip name. Every clip starts at 0. Within one asset, every clip animates the same channel set:
  - spider: 30 rotations, plus translation on `Body` and the 8 leg-tip joints;
  - wolf: rotation on all 32 joints, plus translation on `Bone`.

  So a cross-fade never leaves a joint at another clip's value. Quaternion keys are sign-continuous.
- **Metadata.** The scene root's glTF extras (Babylon: `metadata.gltf.extras` on the container's `spider` or `wolf` transform node) repeat the tables below as data:
  - units, bounds, bones, feet, materials;
  - `variants` (spider);
  - per clip: `duration`, `loop`, `lowest`, `groundSpeed`, `snap`, `strike`, `reach`, `apex`, `height`, `land`, `rear`, `pawsUp`, `pawsDown`, `source`, and `designHit` (§8's hit time, next to the measured one);
  - per loop clip: `closeGap` (m, the largest joint distance from the last pose to the first, measured before closing), `frameStep` (m, the clip's largest per-key joint step), `closeDt` (s, the frame appended to close it, 0 if it was already seamless) and `seam` (m, after closing: 0);
  - `joins` (wolf).
- **Checked statically.**
  - The Khronos glTF validator reports 0 errors. Its warnings are harmless: the KTX2 mime type, and "skinned mesh not root" (its parent is the identity top node).
  - Decoded copies of the shipped files (meshopt and quantisation undone, textures removed) load in Babylon (NullEngine) through `LoadAssetContainerAsync` and `instantiateModelsToScene`, as `Creature.fromContainer` does. Their CPU-skinned bounds per clip match the build's forward kinematics to the millimetre.

**Spider** (`creatures/spider`, Quaternius Easy Enemy Pack, CC0):
- **Joints.** `Root` > `Body` > `Thorax` > `Head`, plus `Abdomen` and the legs.
  - Legs: `{Front,MidFront,MidBack,Back}Leg{,2,3}.{L,R}`.
  - Leg-tip joints (weighted, children of `Root`): `FrontFoot.L`, `MidFrontFoot.L`, `MidBackFoot.L`, `BackFoot.L`, `FrontFoot2.R` (sic), `MidFrontFoot.R`, `MidBackFoot.R`, `BackFoot.R`.
  - `PoleTarget.L/R` are unused.
  - Logical bones: body `Body`, head `Head`, thorax `Thorax`, abdomen `Abdomen`.
- **Materials.** Both are opaque. In linear RGB:
  - `spider_body`: base [0.03, 0.027, 0.026], roughness 0.45. This is the giant.
  - `spider_eyes`: base [0.25, 0.012, 0.01], emissive [0.55, 0.035, 0.02].
- **Variants** (`extras.variants`): giant at scale 1 with body [0.03, 0.027, 0.026]; small at scale 0.55 with body [0.15, 0.075, 0.03].
  - The runtime's `tint` sets `albedoColor` on every material. The eyes keep their emissive glow under any tint. To keep their red base as well, tint only `spider_body`.
- **Size at scale 1.**
  - Bind-pose leg span: 2.6 m.
  - `Spider_Idle` frame 0: x ±1.30, y 0…0.845, z −1.016…1.183 m.
  - At scale 0.55: span 1.43 m, height 0.46 m.

| Clip | s | Loop | Measured (scale 1) |
|---|---|---|---|
| `Spider_Idle` | 4.167 | yes | Seamless as authored (`closeGap` 0) |
| `Spider_Walk` | 0.833 | yes | **Ground speed 1.305 m/s** at rate 1, so rate = v / (1.305 × scale). Seamless as authored (`closeGap` 0; largest frame step 0.183 m) |
| `Spider_Attack` | 0.75 | no | The head thrusts 0.26 m forward: fastest at 0.413 s, furthest at 0.417 s. Matches the design's hit at 0.40. |
| `Spider_Death` | 1.042 | no | Hops, flips and lands on its back with legs up. Ends within ±1 m and 1.53 m tall. |
| `Spider_Jump` | 0.708 | no | A **hop in place**. The body peaks at 0.458 s (+1.07 m) and is down at 0.583 s. There is no forward travel: the runtime moves the body for a lunge. |

**Wolf** (`creatures/wolf`, 0 A.D., CC BY-SA 3.0):
- **Joints** (the 32 0 A.D. names):
  - `Bone` (pelvis): the only translated joint.
  - Spine: `Bone` > `Bone.005` (spine) > `Bone.001` (chest) > `Neck1..3` > `Head` and `Jaw1` > `Jaw2`.
  - Front legs: `FrontShoulder_{L,R}` > `FrontLeg1..3_{L,R}` > `FrontToe_{L,R}`.
  - Also `Bone.012`, `BackLeg1..3_{L,R}` > `BackToe_{L,R}`, and `Tail1..4`.
  - Logical bones: pelvis `Bone`, spine `Bone.005` (use it for the ±2° breathing), chest `Bone.001`, neck `Neck2`, head `Head`, jaw `Jaw1`, tail `Tail1`.
- **Material.** `wolf_fur`: the grey skin, 256² KTX2, roughness 0.85, opaque. For the brown wolf, set its `albedoTexture` to `loadKTX2("creatures/wolf_fur_brown")`.
- **Size.** 0.45 m per 0 A.D. unit: 0.3 m per unit is a big grey wolf (about 1.14 m to the ear tips), times 1.5.
  - `Idle` frame 0: x ±0.30, y 0…1.72 (ear tips), z −1.18…1.38 m, so 2.56 m from nose to tail tip.
  - Lying in `Sleep`: 0.93 m high.

| Clip | s | Loop | Source | Measured |
|---|---|---|---|---|
| `Idle` | 6.0 | yes | `wolf_idle_02` | Head-up stand: the "stir" pose. Loop closed: gap 0.003 m (largest frame step 0.118 m). |
| `Walk` | 2.0 | yes | `wolf_walk` | Ground speed **1.03 m/s** at rate 1. Loop closed: gap 0.029 m (largest frame step 0.129 m). |
| `Run` | 0.833 | yes | `wolf_run` | Ground speed **5.54 m/s** at rate 1. The AI's 3.5 and 7 m/s are Run at 0.63 and 1.26. Loop closed: gap 0.173 m (largest frame step 0.316 m). |
| `Attack1` | 2.167 | no | `wolf_attack_01` | Bite. Rears (front paws +0.57 m at 0.92 s, back down at 1.24 s). The head snaps forward fastest at **1.05 s** and is furthest at 1.42 s, 1.11 m ahead of the origin. Fitted to the ground (see the deviations). |
| `Attack2` | 2.167 | no | `wolf_attack_02` | Pounce. Crouches, rears at 1.13 s (+0.49 m), then slams down: front paws down at **1.48 s**, head lowest and furthest at **1.67 s**. |
| `Death` | 0.917 | no | `wolf_death_01` | Falls onto its side and lies on the ground. The body ends up to 1.7 m to one side of the origin. |
| `LieDown` | 1.5 | no | `wolf_idle_01` 0–1.5 s | Ends in `Sleep`'s pose (0 m apart). Use it to go back to sleep after the leash. |
| `Sleep` | 4.0 | yes | `wolf_idle_01` 2–6 s | A still, belly-down, head-up pose. Add the breathing. |
| `StandUp` | 1.55 | no | `wolf_idle_01` 6.7–8.25 s | From `Sleep` (1.3 cm apart) to standing. Cross-fade into `Idle` over ≥ 0.3 s, because the joints are up to 0.34 m apart. |

Suggested wiring (sleeping clips as in `SleepClips`): `{ asset: "creatures/wolf", clips: { idle: "Idle", walk: "Walk", run: "Run", death: "Death" }, sleep: { sleep: "Sleep", stir: "Idle" (blended at 0.3, §6.3), wake: "StandUp" } }`, with `LieDown` before `Sleep` when it beds down again.

**Runtime constants that disagree with these assets** (in `src/**`, for the integrator):
- **Spider walk speed.** `SPIDER.walkSpeed = 2.6` (`src/prologue/creatures.ts`, after §6.3's "speedRatio = v/2.6") was an assumption. The clip's measured ground speed is 1.305 m/s at scale 1, and 0.72 m/s at 0.55. At the archetype speeds, the giant at 2.6 m/s needs rate 2.0 and a small spider at 3.2 m/s needs rate 4.5.
- **Spider capsule.** `SPIDER.capsule` height is 1.7 m at scale 1, but the body is 0.85 m tall (span 2.6 m, length 2.2 m).
- **Wolf swing lengths.** `ARCHETYPES.wolf` uses lengths of 1.2 and 1.4, but both attack clips are 2.167 s long.
  - The bite's active window [0.76, 0.86] at 1.25× is clip time 0.95–1.075 s, which matches the measured snap (1.05 s).
  - The pounce's [0.80, 0.92] at 1× falls inside the rear-up. Its slam lands at 1.48–1.67 s.
- **Arena spider tint.** `ArenaStage` tints its small spider [0.35, 0.22, 0.12], a light tan. The pipeline's small variant is [0.15, 0.075, 0.03].

**Build contracts.** The build fails if any of these is broken:
- **Spider source:** it has exactly the 5 expected clips, each within 0.02 s of the expected length. The FBX armature above `Root` is one uniform scale, and its channels are static. The bind leg span is 2.6 m ± 1 cm.
- **Wolf source:** every wolf clip glb has the base's joints, inverse bind matrices and rest pose. The skeleton root is `Bone`.
- **Clip shape:** all clips animate the same channels.
- **Loops** (`closeLoop`, before the clip is closed): for every clip flagged `loop`, the gap is the largest joint distance from its last pose to its first. A gap ≤ 0.5 mm is seamless and left alone. Any other gap must be one frame's worth of motion, or the build fails:
  - ≤ 1.5 × the clip's largest per-key joint step (`loopClose.factor`);
  - ≤ an absolute cap (`loopClose.cap`): 5 cm for the spider, whose loops are seamless as authored, and 25 cm for the wolf, whose `Run` gap is 17.3 cm.

  A passing clip is closed by appending its first pose one frame after its end. The frame is the clip's most common key interval over all samplers, because assimp's spider samplers skip unchanged keys. After closing, the first and last pose must agree within 1 mm. Checked against bad configurations, each of which fails: `Run` cut to 0–0.4 s (gap 1.09 m), `Walk` taken from `wolf_attack_01` (0.63 m), and `Spider_Death` flagged loop (2.48 m; this one only the cap catches, because the death's largest frame step is 1.68 m).
- **Floor:** every clip's lowest skinned vertex, sampled at 24 fps, is ≥ −5 cm (`minLowest`). A clip may carry its own measured tolerance (`lowest`); none does today. Measured lows: spider ≥ −1.7 cm; wolf `Walk` −3.5, `Run` −4, `Attack2` −3.3, `Idle` −1 cm, and 0 for the fitted clips. With `WOLF.rotationOnly = false` the build fails on `Walk` (−0.384 m), and without its ground fit on `Attack1` (−0.089 m).
- **Wolf joins:** `LieDown` → `Sleep` and `Sleep` → `StandUp` join within 2 cm.
- **Pose:** the creature faces +Z, and its feet are within 3 cm of y = 0 in idle.
- **Shipped file:** after `finalize`, the top node is a single identity node, the shipped clip set is the configured one, and the shipped idle bounds equal the source's within 1 cm.

**Deviations from §0 #7, §6.3, §8 and §10.3:**
- **Wolf clips are all rotation-only.** The brief said only the death clip should be rotation-only (that was the bear research's fix). In fact all nine 0 A.D. clips share one skeleton, with identical inverse bind matrices (checked), so nothing needs fixing per clip. But every converted clip also keys a translation on every bone, which stretches the legs by up to 60 %:
  - `Walk` drove the front paws 0.38 m through the floor and `Run` 0.34 m.
  - Rotations plus `Bone`'s translation give a clean gait on the ground: lowest vertex −3.5 cm in `Walk`, −4 cm in `Run`, −3.3 cm in `Attack2` and −1 cm in `Idle`.
  - **`Attack1` sank 8.9 cm.** Rotation-only, its hind feet sank into the floor during the rear-up (lowest vertex −8.9 cm at 0.88 s, while the front paws were 0.5–0.6 m up), and all four feet floated up to 6.7 cm before and after it. The source has no hop: with its bone translations the feet are at or below the floor throughout, down to −0.32 m. So `Attack1` is fitted to the ground like the lying clips (root shift −6.7…+8.9 cm). Its strike timings are unchanged. Its rear now reads +0.57 m (it was +0.48 m measured from the floating start), with the front paws back down at 1.24 s.
  - `Attack2` is not fitted. Fitting would pull it down 14.4 cm at its leap, which is the pounce itself, and its lowest vertex (−3.3 cm) passes the floor gate.
  - Renders of both versions were compared, and the rotation-only one was kept.
- **Lying, dying and biting clips fitted to the ground.** `LieDown`, `Sleep`, `StandUp`, `Death` and `Attack1` are fitted key by key, by moving `Bone` vertically. Rotation-only, the lying pose hovered 16 cm, the corpse sank 21 cm, and the bite sank 8.9 cm and floated 6.7 cm.
- **`wolf_idle_01` cut into clips.** It ships as `LieDown`, `Sleep` and `StandUp` rather than one clip played in segments. The cuts resample the boundary keys, so no channel is lost.
  - The 2.0–6.0 s "lie loop" has no motion at all. Breathing has to be procedural, as §6.3 already says.
  - The stand-up starts at 6.7 s, not 7.0, and ends standing at 8.25 s, not 8.0.
- **Loops closed.** The 0 A.D. clips have no closing frame: their last key is one frame short of the first pose (`Run`: 17.3 cm, against its largest frame step of 31.6 cm). The build checks that the gap is one frame's motion (see "Build contracts") and then appends the first pose one frame (1/24 s) after the last key. `Idle`, `Walk` and `Run` are therefore 6.0, 2.0 and 0.833 s, not 5.958, 1.958 and 0.792 s.
- **Wolf size (awaiting the design owner's confirmation; noted at §0 #7).** "×1.5" is read as 1.5 × a real-world large grey wolf, at 0.3 m per 0 A.D. unit. The result is horse-sized: 1.72 m to the ears and 2.56 m long. The repo's other 0 A.D. asset uses a different baseline: the horse treats 0.4 m per unit as life size (`HORSE_SCALE`, `src/prologue/wagon.ts`). On that baseline ×1.5 is 0.6 m per unit, 33 % larger: 2.29 m to the ears and 3.41 m long. To ship that size, set `CreatureProfile.scale` 1.333 or `WOLF.metresPerUnit` 0.4. The shipped size fits the den: `wolf_bed` has 4.8 m of clearance, and `den_path` passes 5.17 m from the wolf.
- **Fur.** The design specifies the grey skin, and it is the asset's default. The brief also asked for the brown skin, so it ships alongside as the optional `creatures/wolf_fur_brown`.
- **Spider recolouring.** The variants are not separate GLBs. One asset (the giant's colours) plus `extras.variants` matches the runtime's `tint`, and the emissive eyes survive a tint.
- **Spider walk speed.** The clip's speed is 1.305 m/s at scale 1, not the 2.6 m/s that §6.3's `speedRatio = v/2.6` assumes. `Spider_Jump` is a hop in place; the design's "hit 0.52" falls on its way down. `Attack2` (the pounce) lands at 1.48–1.67 s, not ≈ 0.80 s.

### Audio (`audio/*`)

Built by `tools/gen/audio.mjs`. The module is self-contained: the cue table `AUDIO`, both encode paths, the seam check, `AUDIO_STREAMED` and `audioCredits()`. It needs only Node and an `ffmpeg` with libopus and the native AAC encoder. Rebuild with `node tools/build-assets.mjs --only=audio/`: about 3 min cold (all 105 cues; the result is byte-identical to a warm build), about 15 s when everything in `.cache/audio` hits. Each build also writes `.cache/audio/report.json` (levels, loop bounds and seams per keep/exit cue; not shipped). The cues of the earlier chapters (menu to dragon) are byte-identical: their cache keys and filter chains did not change.

**Sources.** `node tools/fetch-extra.mjs` downloads every source into `assets-src/audio/`:
- **72 Freesound HQ previews** (`fs_{id}_{uid}-hq.ogg`, appended to `FS`). All are CC0, and each page was checked live for its licence link, uploader id and HQ preview (HTTP 200):
  - every Freesound sound §10.4 lists (69). 66 come from the 2026-10-03 research; the wolf's 122183, 434049 and 380156 were checked 2026-10-06. 517126 is skipped, as §10.4 says. 508546 and 712918 were already fetched for the dragon chapter;
  - 734841 (wolf death, from the bear research);
  - the two §10.4 gaps, filled and checked 2026-10-06: 146765 (thenudo "Heart Beat", a stethoscope recording) and 534336 (Defaultv "Drink_Gulp").
- **Music:** `oga_medieval_battle.mp3` (OGA `battle_8.mp3`), `Exploration.mp3` (OGA `Exploration_0.mp3`; it was in the tree but neither fetched nor credited), `oga_descent.mp3` (OGA `descent.mp3`) and `km_Strength_of_the_Titans.mp3` (incompetech).
- **Pinned.** Every audio file the script downloads (all 99, including the earlier chapters') must match its sha256 in `tools/sources-audio.sha256`. A file already on disk must match too. A re-encoded Freesound preview or a re-uploaded OGA or incompetech file fails the fetch. Otherwise it would silently change shipped hashes, trim and loop points, and loudness-derived gains.
- `assets-src/audio/fs_437078_2524442-hq.ogg` is a stale download: nothing fetches or uses it.
- The bear set from the research is not fetched (the bear is cut, §0 #15).

**Credits.** `tools/credits-extra.mjs` has one entry per shipped source: `fs-<id>` for each Freesound sound, plus `music-medieval-battle`, `music-medieval-exploration`, `music-descent` and `music-strength-titans`. Kevin MacLeod's tracks (`music-strength-titans` and the existing `music-gathering`) carry incompetech's exact credit line in their `note`. `fs-199282` records "CC0 since 2026-07-30" and its CC0 source (miguelstar2).

**Credits gate** (`tools/build-assets.mjs`; general, not audio only). It runs before the manifest is written and fails the build when:
- a shipped manifest id matches no rule in `RULES`. Each rule maps id patterns to the credits they need: `extra` ids in `tools/credits-extra.mjs` and `ph` ids in `assets-src/credits-polyhaven.json`. Examples:
  - `creatures/spider` → `quaternius-easy-enemies`;
  - `creatures/wolf` and `creatures/wolf_fur_brown` → `0ad-wolf`;
  - `kit/fpm` → `quaternius-fpm`;
  - `chars/male`/`female` → `quaternius-ubc` + `quaternius-outfits`, `chars/anim_*` → `quaternius-ual`, `chars/horse` → `0ad-horse`;
  - `dragon/dragon`, and the `fx/*` sprites → `bab-sprites`/`kenney-particles`;
  - `ph/<id>` → that Poly Haven id;
  - the Poly Haven textures each procedural asset reads: `keep/interior` from `keepinterior.mjs` `MATERIALS`, `cave/tex/*` from `cave.mjs` `CAVE_TEX`, `procprops/*`, `town/buildings`, `cart/*`;
  - `audio/*` → `audioCredits()` (a new non-Freesound source needs its credit id in `CREDIT_OF`);
  - procedural or JSON ids list none;
- a rule names a credit that is missing;
- a CC BY or CC BY-SA entry's `note` does not say what was modified;
- a CC BY-SA entry's `note` does not say that the modified version is under the same licence (the 0 A.D. horse's and wolf's share-alike notice);
- a Kevin MacLeod entry lacks incompetech's exact line.

The credits page's Poly Haven list is now derived from the same rules instead of a hard-coded id list (`src/generated/credits.json` is unchanged by that). Checked by removing `0ad-wolf` and the horse's share-alike sentence: the build fails and names `creatures/wolf`, `creatures/wolf_fur_brown` and `0ad-horse`.

**Levels and encoding.** The entry's `norm` picks one of two paths.
- **`"loudnorm"`** (or absent): one ffmpeg graph ending in dynamic loudnorm (I −18 LUFS, TP −2 dBTP), encoded straight from it.
  - Used by the earlier chapters' cues, and by `music_fight`, `music_explore` and `music_beast`. These music tracks do not loop, and `Exploration.mp3` cannot reach −18 LUFS under −2 dBTP with one gain (it would peak at +0.5 dBTP).
  - Bytes unchanged.
- **`"peak"` / `"lufs"`**: every other keep/exit cue. `chapterCues()` defaults loops to `"lufs"` and one-shots to `"peak"`. The steps, in order:
  1. resample to 48 kHz, then high-pass at 25 Hz (24 dB/octave);
  2. trim, pitch (`rate`), layers (`amix`);
  3. for a loop: the tail cross-fades into the head;
  4. fades, then an extra `filter` (not allowed on a `"lufs"` loop);
  5. render to float PCM and measure (EBU R128 integrated loudness and true peak);
  6. apply **one constant gain**: `"peak"` puts the true peak at −2 dBTP; `"lufs"` aims at −18 LUFS, capped so the true peak stays at or under −2 dBTP;
  7. for a loop: wrap padding (below);
  8. encode Opus (the entry's `url`) and AAC (`variants.aac`) from the same PCM.

  There is no dynamic gain, so a loop's head and tail keep one level. The sources' dynamics are kept.
- **Why the high-pass.** `amb_dungeon`'s source has 88 % of its energy under 20 Hz (27 % under 5 Hz). Opus does not keep that band. Its error on that bed was 0.044 RMS, larger than any sample step in it, with 98 % of the error under 20 Hz, at 48, 64 and 96 kbps alike. So the two ends of the loop decoded differently, and that showed as a step at the wrap. After the high-pass, Opus's error on the bed is about 0.004 RMS. Below 25 Hz is inaudible; removing it also frees true-peak headroom.
- **Where the cues landed** (pre-codec):
  - **One-shots:** all 68 sit at exactly −2 dBTP. Decoded, their sample peaks are −3.8 to −0.9 dBFS (Opus, median −2.2): the codecs move a transient's sample peak a little. AAC smears the sharpest click, `steps_stone_6`, to −9 dBFS at the same energy.
  - Variants of one cue now match: `spider_hiss`, `_2`, `_3` at −2.9, −3.4 and −3.5 dBFS decoded; `wolf_growl`, `_2` at −2.0 and −2.4.
  - Quiet takes get large boosts (up to +28.5 dB, `spider_hiss_2`; the stone footsteps +21 to +27 dB).
  - **Loops at −18 LUFS:** `amb_dungeon`, `amb_stream`, `amb_cave_wind` and `music_spider` reach it, with true peaks of −4.4 to −6.2 dBTP.
  - **Peak-capped loops:** the spiky ones land lower. `sfx_heartbeat` −21.0 LUFS, `wolf_breath` −22.8, `amb_cave` −24.2, `amb_drips` −24.5, `spider_chatter` −31.2, `amb_torch` −32.5, `spider_skitter` −33.0.

**Loops** (the 11 keep/exit loops; the earlier chapters' loops are unchanged).
- **Cross-fade.** `loop: d` cross-fades the last d seconds into the head, so the period is the length minus d. The new loops use `xfade: "qsin"`, an equal-power fade (ffmpeg `c1=qsin:c2=qsin`).
  - The linear fade (`tri`, still the default) dips about 3 dB mid-fade on uncorrelated material. It was the quietest window of `amb_dungeon`, `amb_drips`, `amb_stream` and `amb_cave_wind`.
  - Now the fade window sits within −1.8…+1.0 dB of each loop's median window, at the 14th to 75th percentile.
  - `sfx_heartbeat`'s −6.5 dB is the quiet before a beat, where its 0.15 s fade is meant to sit.
- **`amb_drips` trim moved** from [2–42] to [5–45]. The recording fades in over its first ~4 s, and its floor at 2–4 s is 3.4 dB under the rest. With the old trim, that stretch fell in the cross-fade, which then still measured −2.1 dB (p3).
- **Wrap padding.** The loop's last 0.1 s is put before its head, and its first 0.1 s after its tail (`LOOP_PAD`). The codecs' edge effects then fall in the padding instead of on the wrap: Opus pre-skip, AAC priming, and the cold first and last frames. That edge effect was the click the old files had at the wrap.
  - The padded file is periodic throughout. So the build chooses each codec's loop start within the middle 0.1 s of the padding: the point where that codec's two decoded copies agree best. The lossy error is then about equal on both sides of the wrap.
  - A browser decoder that is off by a constant offset under ~0.05 s (an AAC decoder that ignores the edit list: 1024 or 2112 samples) still loops exactly the same content. It just loses that optimisation.
- **Seam gate.** For every padded loop, the build decodes both codecs and fails if, on any channel, the sample step across the wrap (last sample to first) is larger than every other step inside the loop. A click is a step larger than all the others; this measures it per channel and per sample. Below: wrap step / largest other step, per channel (`;` separates the channels), in sample amplitude (full scale 1). `PCM` is before the codec.

| Loop | Period (s) | PCM wrap / max step | Opus wrap / max step | AAC wrap / max step | Fade window vs median |
|---|---|---|---|---|---|
| `audio/sfx_heartbeat` | 8.400 | 0.0000 / 0.0111 | 0.0001 / 0.0120 | 0.0001 / 0.0114 | −6.5 dB (p20) |
| `audio/amb_torch` | 18.496 | 0.0006 / 1.0412 | 0.0002 / 1.1845 | 0.0050 / 0.9942 | −1.1 dB (p39) |
| `audio/amb_dungeon` | 57.000 | 0.0073 / 0.0202; 0.0016 / 0.0201 | 0.0016 / 0.0204; 0.0069 / 0.0203 | 0.0021 / 0.0194; 0.0059 / 0.0207 | −0.5 dB (p14) |
| `audio/amb_drips` | 38.000 | 0.0092 / 0.7109; 0.0080 / 1.0194 | 0.0132 / 0.5789; 0.0084 / 0.6542 | 0.0169 / 0.5464; 0.0009 / 0.5581 | +0.4 dB (p71) |
| `audio/amb_cave` | 55.000 | 0.0069 / 0.3650; 0.0059 / 0.3625 | 0.0043 / 0.4563; 0.0014 / 0.4543 | 0.0049 / 0.5416; 0.0095 / 0.4645 | +1 dB (p75) |
| `audio/amb_stream` | 20.833 | 0.0068 / 0.1497; 0.0068 / 0.1497 | 0.0016 / 0.1229; 0.0016 / 0.1229 | 0.0031 / 0.1528; 0.0033 / 0.1528 | 0 dB (p45) |
| `audio/spider_skitter` | 7.099 | 0.0003 / 0.8819 | 0.0074 / 0.7241 | 0.0001 / 0.7672 | −0.6 dB (p29) |
| `audio/spider_chatter` | 10.598 | 0.0003 / 0.9611; 0.0001 / 1.1414 | 0.0006 / 0.8929; 0.0009 / 1.1760 | 0.0006 / 0.6779; 0.0049 / 0.8831 | −0.6 dB (p50) |
| `audio/wolf_breath` | 3.888 | 0.0001 / 0.1099 | 0.0008 / 0.0931 | 0.0015 / 0.1098 | −1.8 dB (p50) |
| `audio/amb_cave_wind` | 57.000 | 0.0095 / 0.0735; 0.0226 / 0.0907 | 0.0018 / 0.0827; 0.0190 / 0.0884 | 0.0090 / 0.0817; 0.0013 / 0.0868 | −1.1 dB (p21) |
| `audio/music_spider` | 66.857 | 0.0029 / 0.0553; 0.0073 / 0.0538 | 0.0128 / 0.0539; 0.0054 / 0.0545 | 0.0051 / 0.0530; 0.0210 / 0.0520 | 0 dB (p52) |

Every wrap step is below the loop's largest other step in both codecs, and most sit at the codec's own noise level. Before this change, `amb_dungeon`'s Opus wrap step was 0.12, about 13× the 99th percentile of its steps.

- **`music_spider` keeps its bar grid.**
  - "Descent" decodes to exactly 3,024,000 samples at 44.1 kHz: 480/7 s, 160 beats or 40 bars at 140 bpm. It is not a gapless file. Its first ~1,100 samples are the MP3 encoder delay (zeros), its first half-second is quiet (about −60 to −45 dB RMS), and the last bar ends on a hard cut at about −30 dB RMS. Looped as-is, it would drop out for 25 ms and step at every wrap.
  - Its last bar cross-fades into the first instead: `loop: 12/7`, one 4/4 bar at 140 bpm, equal power. The two bars overlap beat on beat (their offset, the period, is a whole number of bars).
  - The loop is 39 bars: 156 beats, 66.857 s.
  - The old 1 s cross-fade gave a 67.571 s period, 157.67 beats, so every repeat jumped 2⅓ beats.

**Manifest fields of audio entries.**
- **`loop: true`.** The file loops. Earlier chapters' loops loop over the whole file. The 11 keep/exit loops, which are the beds, `sfx_heartbeat`, `spider_skitter`, `spider_chatter`, `wolf_breath` and `music_spider`, also carry loop bounds.
- **`loopStart`, `loopEnd` (new).** Seconds into the file, as whole 48 kHz samples. The top-level pair belongs to the Opus file. `variants.opus` repeats it, and `variants.aac` carries the AAC file's own pair. `resolveManifest` already spreads `variants.aac` over the entry for the AAC path, so it picks the right pair.
  - The runtime types need `loopStart?: number; loopEnd?: number` on `ManifestEntry` and `AssetVariant`.
  - Wherever a buffer loops (`startBed`, `loopAt`, `playMusic`): `src.loop = true; if (e.loopEnd !== undefined) { src.loopStart = e.loopStart; src.loopEnd = e.loopEnd; }`.
  - Start inside the loop. Beds and `loopAt`: `src.start(0, e.loopStart + Math.random() * (e.loopEnd - e.loopStart))` instead of `Math.random() * buf.duration`. Music: `src.start(0, e.loopStart)`.
  - **Required.** Without the bounds, these files loop over their full length. Each cycle then repeats 0.2 s of the loop and steps at the file's edges.
- **`gain` (keep and exit cues; absent means 1).** The cue's runtime gain: multiply it into the volume passed to `playOneShot`, `startBed` or `loopAt`. The runtime type `ManifestEntry` needs `gain?: number`.
  - The table's value is the level wanted relative to the cue's reference. A one-shot's reference is a −2 dBTP peak; a bed's or loop's is −18 LUFS. Footsteps 0.25, beds 0.3–0.4, §10.4.
  - **One-shots** keep the table gain, whatever their length. They all sit at the same −2 dBTP peak.
  - **Loops** are corrected for where their constant gain landed against −18 LUFS: at most ×2, and the result at most 1, so their peaks stay under full scale. `amb_torch`, `spider_skitter` and `spider_chatter` are 13–15 dB short, so ×2 leaves them quieter in LUFS than the table says. Their peaks still reach the table gain × 2. Tune by ear.
  - **Do not apply a cue's level twice.** `src/prologue/keep/underground.ts` starts every bed at a fixed 0.35, and `combatHud.ts` starts the heartbeat at 0.6. Replace those constants with `entry.gain`, or keep them and ignore `gain`.
- **`pos`.** A prefetch hint (see the table): the keep [60, −662], the gallery [50, −715], `spider_c` [18, −750], `wolf_bed` [−22, −718], `climb_mid` [−46, −681].
- **`optional: true`.** Set on `music_explore`, `music_spider` and `music_beast`: `streamed: true` in the table → `AUDIO_STREAMED` → `STREAMED` in `build-assets.mjs`.

**Variants.** Numbered ids are variants to pick from at random. Where §10.4 gives one cue two sources or takes, the base id is the first and `_2`/`_3` are the others: `sfx_shield_hit_2`, `sfx_door_wood_2`, `spider_hiss_2`/`_3`, `spider_attack_2`, `wolf_growl_2`. The runtime's single-id lists, such as `combat.ts` `shield: ["audio/sfx_shield_hit"]`, keep working; add the `_2` ids to use the variants.

Level: `peak −2 dBTP`, `−18 LUFS`, `… LUFS (peak-capped)` (a loop held under −18 LUFS by the −2 dBTP cap), or `loudnorm` (dynamic). Duration: the file's, or the loop's period.

| Manifest id | Segment | Source (Freesound id/uid or file) [trim s]; processing | Level | Duration (s) | Opus KB | Gain: table → manifest | Priority, `pos` | Flags |
|---|---|---|---|---|---|---|---|---|
| `audio/sfx_swing_1` | keep | 840716/18136826 | peak −2 dBTP | 0.76 | 5 | 0.5 → 0.5 | 86, [60, −662] |  |
| `audio/sfx_swing_2` | keep | 840717/18136826 | peak −2 dBTP | 0.76 | 5 | 0.5 → 0.5 | 86, [60, −662] |  |
| `audio/sfx_swing_3` | keep | 840715/18136826 | peak −2 dBTP | 0.76 | 5 | 0.5 → 0.5 | 86, [60, −662] |  |
| `audio/sfx_swing_heavy` | keep | 367182/5065048 | peak −2 dBTP | 0.70 | 3 | 0.55 → 0.55 | 86, [60, −662] |  |
| `audio/sfx_hit_flesh_1` | keep | 547042/7614679 | peak −2 dBTP | 1.30 | 9 | 0.8 → 0.8 | 86, [60, −662] |  |
| `audio/sfx_hit_flesh_2` | keep | 547036/7614679 | peak −2 dBTP | 1.21 | 8 | 0.8 → 0.8 | 86, [60, −662] |  |
| `audio/sfx_hit_flesh_3` | keep | 547035/7614679 | peak −2 dBTP | 1.30 | 9 | 0.8 → 0.8 | 86, [60, −662] |  |
| `audio/sfx_hit_axe` | keep | 522091/11537497 + 452554/612689 (−3 dB) | peak −2 dBTP | 0.62 | 6 | 0.85 → 0.85 | 86, [60, −662] |  |
| `audio/sfx_block_1` | keep | 616493/702542 | peak −2 dBTP | 0.60 | 4 | 0.75 → 0.75 | 86, [60, −662] |  |
| `audio/sfx_block_2` | keep | 616495/702542 | peak −2 dBTP | 0.93 | 6 | 0.75 → 0.75 | 86, [60, −662] |  |
| `audio/sfx_block_3` | keep | 616494/702542 | peak −2 dBTP | 0.82 | 6 | 0.75 → 0.75 | 86, [60, −662] |  |
| `audio/sfx_parry` | keep | 326867/4077311 | peak −2 dBTP | 1.51 | 12 | 0.8 → 0.8 | 86, [60, −662] |  |
| `audio/sfx_shield_hit` | keep | 636102/11705708 | peak −2 dBTP | 1.10 | 8 | 0.8 → 0.8 | 86, [60, −662] |  |
| `audio/sfx_shield_hit_2` | keep | 372877/6944346 | peak −2 dBTP | 1.66 | 11 | 0.75 → 0.75 | 86, [60, −662] |  |
| `audio/sfx_draw` | keep | 577619/13023338 | peak −2 dBTP | 2.00 | 15 | 0.5 → 0.5 | 88, [60, −662] |  |
| `audio/sfx_rope_cut` | keep | 577619/13023338 [0.05–0.65]; fade out 0.15 | peak −2 dBTP | 0.60 | 5 | 0.5 → 0.5 | 88, [60, −662] |  |
| `audio/vo_pain_1` | keep | 547203/129727 | peak −2 dBTP | 0.29 | 2 | 0.6 → 0.6 | 85, [60, −662] |  |
| `audio/vo_pain_2` | keep | 547202/129727 | peak −2 dBTP | 0.25 | 2 | 0.6 → 0.6 | 85, [60, −662] |  |
| `audio/vo_pain_3` | keep | 547201/129727 | peak −2 dBTP | 0.30 | 2 | 0.6 → 0.6 | 85, [60, −662] |  |
| `audio/vo_pain_4` | keep | 547200/129727 | peak −2 dBTP | 0.33 | 2 | 0.6 → 0.6 | 85, [60, −662] |  |
| `audio/vo_death_1` | keep | 547182/129727 | peak −2 dBTP | 1.35 | 10 | 0.7 → 0.7 | 85, [60, −662] |  |
| `audio/vo_death_2` | keep | 547181/129727 | peak −2 dBTP | 1.08 | 7 | 0.7 → 0.7 | 85, [60, −662] |  |
| `audio/vo_death_3` | keep | 547189/129727 | peak −2 dBTP | 1.14 | 7 | 0.7 → 0.7 | 85, [60, −662] |  |
| `audio/vo_attack_1` | keep | 474651/9250976 [0–0.87]; fade in 0.01, fade out 0.1 | peak −2 dBTP | 0.87 | 5 | 0.55 → 0.55 | 85, [60, −662] |  |
| `audio/vo_attack_2` | keep | 474651/9250976 [1.17–1.98]; fade in 0.01, fade out 0.1 | peak −2 dBTP | 0.81 | 4 | 0.55 → 0.55 | 85, [60, −662] |  |
| `audio/vo_attack_3` | keep | 474651/9250976 [2.29–2.99]; fade in 0.01, fade out 0.1 | peak −2 dBTP | 0.70 | 4 | 0.55 → 0.55 | 85, [60, −662] |  |
| `audio/vo_attack_4` | keep | 474651/9250976 [3.38–4.42]; fade in 0.01, fade out 0.1 | peak −2 dBTP | 1.04 | 6 | 0.55 → 0.55 | 85, [60, −662] |  |
| `audio/vo_attack_5` | keep | 474651/9250976 [4.54–5.41]; fade in 0.01, fade out 0.1 | peak −2 dBTP | 0.87 | 5 | 0.55 → 0.55 | 85, [60, −662] |  |
| `audio/sfx_bodyfall` | keep | 504626/4437257 | peak −2 dBTP | 1.63 | 13 | 0.7 → 0.7 | 85, [60, −662] |  |
| `audio/sfx_heartbeat` | keep | 146765/1417288 [10.34–18.89] | −21.0 LUFS (peak-capped) | 8.40 | 38 | 0.6 → 0.847 | 84, [60, −662] | loop (0.15 s equal-power cross-fade) |
| `audio/sfx_potion` | keep | 534336/11867884 [0.3–0.95]; fade in 0.01, fade out 0.1 | peak −2 dBTP | 0.65 | 4 | 0.6 → 0.6 | 84, [60, −662] |  |
| `audio/steps_stone_1` | keep | 517122/5026978 | peak −2 dBTP | 0.54 | 3 | 0.25 → 0.25 | 87, [60, −662] |  |
| `audio/steps_stone_2` | keep | 517121/5026978 | peak −2 dBTP | 0.52 | 3 | 0.25 → 0.25 | 87, [60, −662] |  |
| `audio/steps_stone_3` | keep | 517125/5026978 | peak −2 dBTP | 0.48 | 3 | 0.25 → 0.25 | 87, [60, −662] |  |
| `audio/steps_stone_4` | keep | 517137/5026978 | peak −2 dBTP | 0.57 | 3 | 0.25 → 0.25 | 87, [60, −662] |  |
| `audio/steps_stone_5` | keep | 517136/5026978 | peak −2 dBTP | 0.54 | 3 | 0.25 → 0.25 | 87, [60, −662] |  |
| `audio/steps_stone_6` | keep | 517135/5026978 | peak −2 dBTP | 0.48 | 2 | 0.25 → 0.25 | 87, [60, −662] |  |
| `audio/steps_stone_7` | keep | 517134/5026978 | peak −2 dBTP | 0.52 | 3 | 0.25 → 0.25 | 87, [60, −662] |  |
| `audio/steps_stone_8` | keep | 517117/5026978 | peak −2 dBTP | 0.52 | 3 | 0.25 → 0.25 | 87, [60, −662] |  |
| `audio/steps_stone_9` | keep | 517124/5026978 | peak −2 dBTP | 0.44 | 2 | 0.25 → 0.25 | 87, [60, −662] |  |
| `audio/steps_stone_10` | keep | 517123/5026978 | peak −2 dBTP | 0.72 | 4 | 0.25 → 0.25 | 87, [60, −662] |  |
| `audio/steps_mail_1` | keep | 384881/984733 | peak −2 dBTP | 0.50 | 2 | 0.25 → 0.25 | 87, [60, −662] |  |
| `audio/steps_mail_2` | keep | 384882/984733 | peak −2 dBTP | 0.50 | 3 | 0.25 → 0.25 | 87, [60, −662] |  |
| `audio/steps_mail_3` | keep | 384887/984733 | peak −2 dBTP | 0.50 | 3 | 0.25 → 0.25 | 87, [60, −662] |  |
| `audio/sfx_door_wood` | keep | 452608/612689 [0.38–1.33]; fade in 0.01, fade out 0.1 | peak −2 dBTP | 0.94 | 7 | 0.7 → 0.7 | 88, [60, −662] |  |
| `audio/sfx_door_wood_2` | keep | 452608/612689 [11–12.08]; fade in 0.01, fade out 0.1 | peak −2 dBTP | 1.07 | 8 | 0.7 → 0.7 | 88, [60, −662] |  |
| `audio/sfx_lock` | keep | 734641/13973196 [0.2–1.65] | peak −2 dBTP | 1.45 | 11 | 0.6 → 0.6 | 84, [60, −662] |  |
| `audio/sfx_gate_slam` | keep | 159552/71257 | peak −2 dBTP | 2.78 | 17 | 0.8 → 0.8 | 84, [60, −662] |  |
| `audio/sfx_iron_gate` | keep | 207137/2568776 [0.32–1.9]; fade in 0.01, fade out 0.2 | peak −2 dBTP | 1.58 | 11 | 0.7 → 0.7 | 84, [60, −662] |  |
| `audio/sfx_chest` | keep | 771164/789424 | peak −2 dBTP | 1.34 | 11 | 0.6 → 0.6 | 88, [60, −662] |  |
| `audio/sfx_pickup` | keep | 347174/6324381 | peak −2 dBTP | 0.51 | 6 | 0.4 → 0.4 | 88, [60, −662] |  |
| `audio/sfx_beam_crash` | keep | 584891/13194852 [0.3–1.5]; fade out 0.25 | peak −2 dBTP | 1.20 | 10 | 0.9 → 0.9 | 88, [60, −662] |  |
| `audio/sfx_rumble` | keep | 712918/15139380; fade out 0.5, low-pass 420 Hz ×2 | peak −2 dBTP | 3.00 | 21 | 0.8 → 0.8 | 82, [60, −662] |  |
| `audio/sfx_rockfall` | keep | 381645/5486695 [0.25–4.1] + 567249/7108319 (−6 dB, +0.15 s); fade out 0.4 | peak −2 dBTP | 4.35 | 40 | 0.9 → 0.9 | 82, [50, −715] |  |
| `audio/sfx_lever` | keep | 506146/1282624 | peak −2 dBTP | 1.78 | 14 | 0.7 → 0.7 | 78, [50, −715] |  |
| `audio/sfx_chain_mech` | keep | 784229/9813501 [5–13] + 199282/71257 [10–18] (−35 dB); fade in 0.3, fade out 1 | peak −2 dBTP | 8.00 | 78 | 0.7 → 0.7 | 78, [50, −715] |  |
| `audio/sfx_bridge_crash` | keep | 508546/5026978 [0.45–7.65]; fade out 0.4 | peak −2 dBTP | 7.20 | 68 | 1 → 1 | 78, [50, −715] |  |
| `audio/amb_torch` | keep | 637523/612689 [2–22] | −32.5 LUFS (peak-capped) | 18.50 | 83 | 0.4 → 0.8 | 90, [60, −662] | loop (1.5 s equal-power cross-fade) |
| `audio/amb_dungeon` | keep | 530161/2683450 [45–105] | −18 LUFS | 57.00 | 311 | 0.35 → 0.35 | 80, [60, −662] | loop (3 s equal-power cross-fade) |
| `audio/amb_drips` | keep | 609161/938246 [5–45] | −24.5 LUFS (peak-capped) | 38.00 | 195 | 0.3 → 0.6 | 80, [60, −662] | loop (2 s equal-power cross-fade) |
| `audio/amb_cave` | keep | 553080/9250976 | −24.2 LUFS (peak-capped) | 55.00 | 320 | 0.35 → 0.7 | 76, [50, −715] | loop (2 s equal-power cross-fade) |
| `audio/amb_stream` | keep | 552485/9847211 | −18 LUFS | 20.83 | 113 | 0.35 → 0.35 | 76, [50, −715] | loop (2 s equal-power cross-fade) |
| `audio/music_fight` | keep | `oga_medieval_battle.mp3` [0–71.6]; fade out 1 | loudnorm | 71.61 | 720 | – → – | 80, [60, −662] |  |
| `audio/music_explore` | keep | `Exploration.mp3` [1–234]; fade out 2 | loudnorm | 233.01 | 2707 | – → – | 60, [50, −715] | **streamed** |
| `audio/spider_hiss` | exit | 459476/6232598 [4.25–5.25]; fade in 0.01, fade out 0.15 | peak −2 dBTP | 1.00 | 6 | 0.7 → 0.7 | 85, [18, −750] |  |
| `audio/spider_hiss_2` | exit | 459476/6232598 [8.28–9.6]; fade in 0.01, fade out 0.15 | peak −2 dBTP | 1.32 | 8 | 0.7 → 0.7 | 85, [18, −750] |  |
| `audio/spider_hiss_3` | exit | 758900/15895934 | peak −2 dBTP | 1.70 | 9 | 0.7 → 0.7 | 85, [18, −750] |  |
| `audio/spider_skitter` | exit | 443723/7262854 [0.3–8.4] | −33.0 LUFS (peak-capped) | 7.10 | 41 | 0.4 → 0.8 | 85, [18, −750] | loop (1 s equal-power cross-fade) |
| `audio/spider_chatter` | exit | 202108/3756348 [0.5–12.6] | −31.2 LUFS (peak-capped) | 10.60 | 90 | 0.35 → 0.7 | 82, [18, −750] | loop (1.5 s equal-power cross-fade) |
| `audio/spider_attack` | exit | 672710/14685597 | peak −2 dBTP | 0.50 | 3 | 0.8 → 0.8 | 85, [18, −750] |  |
| `audio/spider_attack_2` | exit | 672712/14685597 | peak −2 dBTP | 1.06 | 6 | 0.8 → 0.8 | 85, [18, −750] |  |
| `audio/spider_death` | exit | 559621/8216881 + 515619/6769489 (−2 dB) | peak −2 dBTP | 0.90 | 6 | 0.8 → 0.8 | 84, [18, −750] |  |
| `audio/sfx_web` | exit | 659428/5287430 | peak −2 dBTP | 2.44 | 14 | 0.5 → 0.5 | 84, [18, −750] |  |
| `audio/wolf_breath` | exit | 122183/71257 [0.4–4.15]; pitch 0.8 | −22.8 LUFS (peak-capped) | 3.89 | 23 | 0.35 → 0.605 | 82, [−22, −718] | loop (0.8 s equal-power cross-fade) |
| `audio/wolf_growl` | exit | 434049/181941 [1.7–4.1]; fade in 0.05, fade out 0.3 | peak −2 dBTP | 2.40 | 14 | 0.8 → 0.8 | 82, [−22, −718] |  |
| `audio/wolf_growl_2` | exit | 434049/181941 [4.2–8.6]; fade in 0.05, fade out 0.3 | peak −2 dBTP | 4.40 | 25 | 0.8 → 0.8 | 82, [−22, −718] |  |
| `audio/wolf_snarl` | exit | 342204/3908740 | peak −2 dBTP | 3.22 | 18 | 0.85 → 0.85 | 82, [−22, −718] |  |
| `audio/wolf_howl` | exit | 380156/2940947 [2–7.9]; fade out 0.8 | peak −2 dBTP | 5.90 | 35 | 0.9 → 0.9 | 82, [−22, −718] |  |
| `audio/wolf_death` | exit | 734841/14713973 | peak −2 dBTP | 4.19 | 24 | 0.85 → 0.85 | 80, [−22, −718] |  |
| `audio/amb_cave_wind` | exit | 852822/18763192 [20–80] | −18 LUFS | 57.00 | 332 | 0.35 → 0.35 | 75, [−46, −681] | loop (3 s equal-power cross-fade) |
| `audio/music_spider` | exit | `oga_descent.mp3` | −18 LUFS | 66.86 | 777 | – → – | 60, [18, −750] | loop (12/7 s equal-power cross-fade), **streamed** |
| `audio/music_beast` | exit | `km_Strength_of_the_Titans.mp3` [0.3–59]; fade out 0.5 | loudnorm | 58.71 | 581 | – → – | 60, [−22, −718] | **streamed** |

**Segments and budgets.**
- **Segments emitted:** `menu, cart, muster, execution, dragon, keep, exit`. This is exactly `SEGMENTS` in `src/core/assets/manifest.ts`, in the same (play) order. No asset uses `"choice"`.
- **Segment gate (`build-assets.mjs`).** Every asset's segment must be in the runtime's `SEGMENTS`, which the build parses from the source; otherwise the build fails. It warns if the order differs from its own `PIPELINE_SEGMENTS`.
- **Start-pack gate.** It measures the brotli bytes of the non-optional assets, as the summary prints them. Over a limit, the build fails before the manifest is written.
  - keep: limit 15 MB (the design's limit).
  - exit: limit 6 MB. The design gives no limit; 6 MB is 2.5× its 2.4 MB estimate.
  - The summary prints segments in play order, each against its estimate and limit, plus a total line.
- **Full build (2026-10-06)**, start packs, brotli:
  - menu 0.02 MB, cart 8.54, muster 12.57, execution 2.90, dragon 4.84;
  - **keep 8.63 MB** (estimate 8.4, limit 15), of 11.40 MB in all;
  - **exit 1.29 MB** (estimate 2.4, limit 6), of 2.71 MB in all;
  - total: 38.78 MB of start packs, 52.81 MB brotli (58.98 MB raw) in 186 assets (291 files with the AAC variants), manifest version `fdc0e45219ff`.
  - Against the previous build, every one of the 186 ids is still there. The only changed files are the 79 keep/exit audio cues on the constant-gain path. A full rebuild reproduces the `--only` builds byte for byte (same manifest version).
- **Audio's share.** keep audio adds 2.36 MB brotli to the keep start pack, and 2.77 MB more is streamed (`music_explore`). exit audio adds 0.67 MB to its start pack, and 1.39 MB is streamed (`music_spider`, `music_beast`). The keep start pack is slightly over the 8.4 MB estimate and far under its limit.

**Runtime notes.**
- **Ids the runtime already references,** all shipped now:
  - `combat.ts` `SFX`: swing, flesh, axe, block, shield, parry, draw, pain, death, grunt (`vo_attack_*`), fall;
  - `underground.ts` beds: `amb_torch`, `amb_dungeon`, `amb_drips`, `amb_cave`, `amb_stream`;
  - `keep.ts` `music_explore`, and the encounter specs' `music: "audio/music_fight"`;
  - `combatHud.ts` `sfx_heartbeat`.
- **Not referenced yet:**
  - `steps_*`, `sfx_door_wood*`, `sfx_lock`, `sfx_gate_slam`, `sfx_iron_gate`, `sfx_chest`, `sfx_pickup`, `sfx_potion`, `sfx_rope_cut`, `sfx_beam_crash`;
  - `sfx_rumble`, `sfx_rockfall`, `sfx_lever`, `sfx_chain_mech`, `sfx_bridge_crash`;
  - the spider and wolf sets, `amb_cave_wind`, `music_spider`, `music_beast`.
- **Loop bounds.** `startBed`, `loopAt` and `playMusic` (`src/core/audio.ts`) must apply `loopStart`/`loopEnd` and start inside them, as described under the manifest fields. All 11 keep/exit loops carry them.
- **K0's rockfall.** Keep step 0 must need no keep assets (§10.6). For the crenellation, use the dragon segment's `audio/rubble` or `audio/collapse_small`. `audio/sfx_rockfall` is a keep cue for K9 and K12.
- **`sfx_rumble`** is the recording behind dragon's `collapse_small` (712918), low-passed at 420 Hz (24 dB/octave): a tremor heard through rock. **`sfx_bridge_crash`** is `audio/collapse`'s recording with more of its tail.
- **`sfx_heartbeat`** loops exactly 8 beats at 57 bpm (start it with `startBed`). `setBedRate("heartbeat", 1.3)` gives about 75 bpm; loop bounds work at any playback rate.
- **`wolf_breath`** is already pitched to 0.8 (a 3.89 s loop).
- **`spider_skitter`** is a movement loop (for `loopEmitter` on a moving spider). **`spider_chatter`** is the nest bed.
- **Music.**
  - `music_fight` is not a loop: it ends naturally at 71.6 s and restarts, like `music_cart`.
  - `music_spider` loops seamlessly between its bounds: 39 bars at 140 bpm, 66.857 s. It needs `loopStart`/`loopEnd` (start at `loopStart`).
  - For the keep's music states, set `audio.musicTracks = { calm: "audio/music_explore", combat: "audio/music_fight" }`.
  - `music_beast` is the X2 wake cue; `music_cart` is the X4 reprise (cart segment, long cached).
- **Channels.**
  - Mono: every one-shot, and the loops `amb_torch`, `sfx_heartbeat`, `wolf_breath` and `spider_skitter`.
  - Stereo: `amb_dungeon`, `amb_drips`, `amb_cave`, `amb_stream`, `amb_cave_wind`, `spider_chatter` and all music.

**Deviations from §10.4–§10.6.**
- **Gaps filled.** `sfx_heartbeat` (146765) and `sfx_potion` (534336) ship, verified CC0 as above. §10.4 said to ship them silent until sources were picked.
- **Additions:**
  - `wolf_death` (734841 "dyingBeast", verified CC0 in the bear research);
  - `spider_chatter` (202108), its own bed rather than a skitter variant;
  - the `_2`/`_3` variants listed above.
- **Trims.** The research's −40 dB bounds are padded, as the research advised:
  - `sfx_bridge_crash` [0.45–7.65] (§10.4: [0.72–7.25]);
  - `sfx_door_wood` [0.38–1.33] and `sfx_door_wood_2` [11.0–12.08];
  - `sfx_iron_gate` [0.32–1.9];
  - `sfx_beam_crash` [0.3–1.5];
  - `sfx_rockfall` [0.25–4.1].

  `sfx_chain_mech` is the 8 s at 5–13 s of 784229 (steady running, past the start-up clunk), with 199282 [10–18] 6 dB under it. `amb_drips` is [5–45] (above).
- **`sfx_rumble` is low-passed,** so it is not the same file as dragon's `collapse_small`.
- **Streaming.** `music_explore` (2.7 MB) is streamed, because it first plays at K11. `music_fight` is in the keep start pack.
- **Levels.** Instead of loudnorm on every cue, keep/exit one-shots are peak-normalised and loops get one constant gain toward −18 LUFS (above). The manifest gains are starting points, set by measurement, not by ear.
- **`music_spider`** is a 39-bar loop, not the source's 40 bars (above).
- **Sources are high-passed at 25 Hz** (keep/exit cues on the constant-gain path only).
