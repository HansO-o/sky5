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
| 7 | Beast | 0 A.D. **wolf** ×1.5, which has a native lying segment. The bear is cut. | tech |
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
  - zero the root translation and set the rotation to rest.

  At runtime the curve delta is applied to the `CapsuleMover` as velocity, clamped to 3 m/s and zeroed within 0.9 m of the target. This also fixes the shipped `Sword_Block` −0.08 m offset.
- Emit the new clips as **`chars/anim_combat`** in segment `keep`, and add `CharacterFactory.addClips(container)`.
- New clips (44, about 48 s, about 330 KB brotli):
  - **UAL1:** Sword_Enter, Sword_Exit, Sword_Attack, Hit_Shoulder_L, Hit_Shoulder_R, Push_Enter, Push_Loop, Push_Exit, Punch_Jab, Punch_Cross, Kick, Crouch_Enter, Crouch_Exit, Crouch_Bwd_Loop, Crouch_Left_Loop, Crouch_Right_Loop, Jog_Left_Loop, Jog_Right_Loop, Jog_Bwd_Loop.
  - **UAL2:** Sword_Light_A, Sword_Light_A_Rec, Sword_Light_B, Sword_Light_B_Rec, Sword_Light_C, SwordLight_C_Rec (no underscore), Sword_Regular_A, Sword_Regular_A_Rec, Sword_Regular_B, Sword_Regular_B_Rec, Sword_Heavy_A, Sword_Heavy_A_Rec, Sword_Dash_RM, Shield_OneShot, Idle_Shield_Break, Walk_L_Loop, Walk_R_Loop, Walk_Bwd_Loop, Bandage_Loop, Chest_Open, PickUp_Table, Consume, Farm_PickingTree, Bow_Aim_Up, Bow_Aim_Down.
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
| 巨狼 (0 A.D. ×1.5) | E6 | 140 | 80 | Bite 18 (`Attack1` at 1.25×: hit ≈ 0.76 s; reach 2.4, ±50°) | Pounce 24 (Run ≤ 1.2 s → `Attack2` hit ≈ 0.80 s; knockdown unless shield-blocked; cooldown 6; run 7 m/s) | – | 2.2–2.8 |

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
8. `characters.mjs`: assert that requested clips exist (the Standard fallback silently drops 16), dispose the 63 orphan joints, and rebase root motion (also fixes the `Sword_Block` −0.08 m shift).
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