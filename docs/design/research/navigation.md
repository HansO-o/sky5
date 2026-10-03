## 1. Package facts (npm registry, fetched 2026-10-03)

| package | latest | license | unpacked | notes |
|---|---|---|---|---|
| `@recast-navigation/core` | 0.43.1 (2026-04-07) | MIT | 250 KB | `type:module`, `main/module: dist/index.mjs`, no `exports` map; dep `@recast-navigation/wasm@0.43.1`; ~37k downloads/week |
| `@recast-navigation/generators` | 0.43.1 | MIT | 78 KB | solo / tiled / tile-cache generators; dep core and wasm |
| `@recast-navigation/wasm` | 0.43.1 (2026-04-07) | MIT, embeds Recast & Detour under zlib (c) 2009 Mikko Mononen | 1.99 MB | exports `.` and `./wasm-compat` (1.0 MB JS with the wasm embedded as base64) and `./wasm` (560 KB glue + separate 339 KB `.wasm`). The `.wasm` file is **not** in the exports map |
| `recast-navigation` (umbrella) | 0.43.1 (2026-02-04) | MIT | 28 KB | re-exports core and generators. Use the scoped packages instead and pin all three exactly |
| `@recast-navigation/babylon` | does not exist (404) | | | |
| `@babylonjs/addons` 9.29.0 | | Apache-2.0 | 1.58 MB | has `navigation/RecastNavigationJSPluginV2` (see section 7) |
| `yuka` (game-AI library) | 0.7.8, last published 2022-09-17 | MIT | 1 MB | unmaintained, so not recommended |

Release history: 0.39 (2025-02), 0.40/0.41 (2025-07), 0.42 (2025-08), 0.43.0 (2025-09), 0.43.1 (2026-02/04). The library is still pre-1.0 and minor versions break the API, so pin exact versions.

Measured sizes (raw / gzip-9 / brotli): `.wasm` 339 KB / 131 KB / 105 KB. `wasm.js` glue 560 KB / 60 KB / 45 KB. `wasm-compat.js` 1.01 MB / 237 KB / 186 KB. `core index.mjs` 102 KB / 20 KB / 17 KB. `generators` 43 KB / 7.8 KB / 6.8 KB.

## 2. Vite / ESM / worker (I verified this with a real `vite build` using Vite 8.3.2 in a sandbox at /tmp/claude-0/research/vitetest)

- core calls `await import('@recast-navigation/wasm')`, which resolves to the 1 MB compat build. An alias moves it to the lean build:
```js
// vite.config.ts additions
resolve: { alias: [{ find: /^@recast-navigation\/wasm$/, replacement: path.resolve(import.meta.dirname, "node_modules/@recast-navigation/wasm/dist/recast-navigation.wasm.js") }] },
optimizeDeps: { exclude: ["@recast-navigation/core", "@recast-navigation/generators", "@recast-navigation/wasm"] }, // README says exclude from pre-bundling; needed for dev
worker: { format: "es" }, // already set
```
- Vite's `vite:asset-import-meta-url` plugin has no node_modules exclusion. It rewrote the glue's `new URL("recast-navigation.wasm.wasm", import.meta.url)` to the hashed asset `app/recast-navigation.wasm-<hash>.wasm` in **both** the main bundle and the module-worker bundle, and no compat chunk was emitted. Build output: wasm 339 KB (133 KB gz), glue 275 KB (41 KB gz, 30 KB br), duplicated once in the worker chunk; main chunk with core 25 KB (6 KB br); worker 31 KB (7 KB br). The existing `northern-sw` plugin precaches every bundle file, so the wasm and worker go into the shell cache automatically.
- You don't need the Jolt-style `?url` import here. If you want an explicit locator, use `init(() => Factory({ locateFile: () => url }))`; `init(impl)` calls `impl()` with no arguments.
- Worker safety: the glue is built with `ENVIRONMENT_IS_WEB=true` and `ENVIRONMENT_IS_WORKER=false` hard-coded, but it has **zero** `document` or `window` references and loads with `fetch` + `import.meta.url` + `instantiateStreaming`, so it works in a `{type:"module"}` worker. Upstream has an official three-vite-worker example. I did not run it in a browser, because the rules forbid it.
- `vite dev` was not tested (no dev servers allowed).

## 3. Measured performance (Node 22 / V8, scripts in /tmp/claude-0/research/nav/)

Synthetic test world: the 512 m terrain sampled at 2 m like `addHeightField` (130k tris), plus a keep shell at the real LAYOUT spot (26×18×12, 4 m gate on +Z, a 2.2 m inner ledge), 10 houses and 40 crates. Nav bounds cover the town only: x∈[-40,160], z∈[-700,-490].
- `init()`: 55–62 ms (compat build).
- **detailSampleDist dominates build time**:

| config | time | export | notes |
|---|---|---|---|
| tiled, ts64, detail 1.5/0.2 | 30–36 s | | `BUILD_POLYMESHDETAIL` = 20 s; avoid |
| tiled, ts64, detail 3/0.5 | 7.6 s | | |
| tiled, ts32, detail 3/0.5 | 1.5–1.6 s | 536 KB (185 KB gz) | |
| tiled, ts32, detail 6/1 | 1.06–1.15 s | 300 KB (41 KB gz) | |
| tiled, any, `detailSampleDist: 0` | crashes | | wasm "memory access out of bounds" in `buildPolyMeshDetail` |
| **TileCache, ts48** | 0.84–0.93 s | 156 KB | |
| **TileCache, ts32, 200×200 m terrain only** | 435 ms | | |

- TileCache obstacle add + `update()`: 0.5 ms.
- `importNavMesh`: 1 ms.
- `computePath` across town (~140 m): 2.7–3.4 ms cold, 0.1 ms warm.
- Navmesh height error versus the true terrain: mean 0.15–0.18 m, max 0.38–0.57 m for both TileCache and detail 6/1. Kinematic NPCs must not take Y from the navmesh on terrain; use CharacterVirtual or `heightAt`.
- **Crowd with 20 agents: 0.11–0.15 ms per `update`.**
- **Jolt CharacterVirtual ×20 `ExtendedUpdate` (jolt-physics 1.1.0, heightfield + 200 boxes): 0.60 ms per step (30 µs each); 0.68 ms with `CharacterVsCharacterCollisionSimple`.**
- Off-mesh links:
  - The drop (ledge→floor) path works in tiled mode and in TileCache via `TileCacheMeshProcess.setOffMeshConnections`.
  - A bidirectional "ladder" link with flag 4 works, and a filter with `excludeFlags=4` correctly refuses it.
  - Links survive obstacle-triggered tile rebuilds and export/import.
  - A crowd agent took the drop: `state()===DT_CROWDAGENT_STATE_OFFMESH (2)` was observed, and `raw.get_cornerFlags(i) & 4` (DT_STRAIGHTPATH_OFFMESH_CONNECTION) appeared beforehand.
- A box obstacle in a 4 m doorway blocks the path, and removing it reopens the path.
- **Gotcha: `computePath` returns `success:true` for PARTIAL paths** (blocked door, unreachable ledge). Always check the distance from `path.at(-1)` to the goal.
- **Physics-authoritative crowd sync works:** writing the body position into `agent.raw.set_npos(0..2, …)` before `crowd.update()` keeps the corridor consistent. dtCrowd's final `corridor.movePosition` clamps it to the mesh. A body moving at 80 % of crowd speed and shoved 3 m sideways still reached the goal around a wall, and agent and body ended within 1e-6. Don't use `teleport()` per frame: it resets the corridor and forces a replan.

## 4. Navmesh build design for this project

- **Geometry source = the exact Jolt static collider soup.**
  - Add a `NavGeometry` sink to `Physics`: `addStaticMesh(positions, indices)` already receives world-space arrays.
  - `addHeightField` should emit triangles only inside the nav-zone bounds (2 m grid → about 20k tris for 200×200 m).
  - Static `addBox` emits 12 transformed tris.
  - Skip DEBRIS/RAGDOLL bodies. Represent the dragon breach (`breachBody`) as a TileCache box obstacle that you remove in `breakBreach()`.
  - An offline `tools/` bake would have to re-implement `town.ts` placement (HOUSES, kit pieces, `appendWorldGeometry`) plus `World.heightAt` in Node. That duplicates logic and drifts.
- **Recommended pipeline:**
  1. `ensurePhysics()` finishes and collects the soup.
  2. A module worker `src/engine/nav/nav.worker.ts` (same pattern as `AssetClient`'s `new Worker(new URL("./asset.worker.ts", import.meta.url), {type:"module"})`) runs `init()` and `generateTileCache`, then `exportTileCache` and transfers the result back.
  3. The main thread calls `importTileCache(bin, meshProcess)`.
  4. Cache in IndexedDB (reuse `src/core/assets/idb.ts`) with key = SHA-256 of positions+indices + `NAV_VERSION` + zone id. The first visit costs about 0.5–1 s of worker CPU during the scripted cart/muster/execution chapters; later visits cost about 1 ms to import.
  5. Optional later: a Playwright e2e hook dumps the bin into `public/data` for a zero-cost first load.
- **Config (Recast walkable values are VOXELS; detail values are world units):**
```ts
const cs = 0.25, ch = 0.2;
{ cs, ch, tileSize: 32 /*8 m*/, walkableSlopeAngle: 50 /*= player mMaxSlopeAngle*/,
  walkableHeight: Math.ceil(1.8 / ch) /*9*/, walkableClimb: Math.floor(0.4 / ch) /*2, match CharacterVirtual stair step*/,
  walkableRadius: Math.ceil(0.35 / cs) /*2*/, maxSimplificationError: 1.3, maxVertsPerPoly: 6,
  expectedLayersPerTile: 4, maxObstacles: 64, tileCacheMeshProcess }
// if you use tiled (non-cache) instead: detailSampleDist 6, detailSampleMaxError 1 (never 0), maxEdgeLen 12/cs
```
- **Zones:** one TileCache plus its own Crowd and NavMeshQuery per zone, because a dtCrowd is bound to one navmesh.
  - `town` (includes the keep exterior and interior): keep x 47–73, z −671…−653. The 4 m gate minus 2×0.5 m erosion leaves 3 m passable.
  - Keep cellars or a cave stacked under the keep can share the town cache, because TileCache is multi-layer (`expectedLayersPerTile` 4).
  - A cave placed elsewhere becomes its own zone, built in the chapter's `prepare()`. Agents move between zones by `removeAgent` / `addAgent` at a portal.
- **Doors, portcullis, rubble:** TileCache box obstacles (`addBoxObstacle` / `removeObstacle` + `update()` until `upToDate`).
- **Pruning:** `floodFillPruneNavMesh(navMesh, [refNearGate])` removes rooftop and wall-top islands.
- **Debug view:** `getNavMeshPositionsAndIndices(navMesh)` → a Babylon `Mesh` behind a dev flag.
- **Off-mesh link table per zone** (data, not code): `{id, start, end, kind:'drop'|'jump'|'ladder'|'vault', bidir, flags}`.
  - Flags: WALK=1, JUMP=2, LADDER=4, DOOR=8.
  - Endpoints must lie on the **eroded** mesh, so offset ≥ walkableRadius from walls and ledges. My first ladder test failed for exactly this reason.
  - Crowd query filters (`crowd.getFilter(i)`, agent `queryFilterType`) set per-archetype abilities, for example beasts exclude LADDER|DOOR.

## 5. Off-mesh traversal

dtCrowd's built-in traversal is a linear lerp lasting (horizontal distance / maxSpeed) × 0.5, so a vertical ladder finishes almost instantly. The `dtCrowdAgentAnimation` and corridor polys are not exposed in JS; only `cornerVerts`, `cornerFlags`, `ncorners`, `npos`, `nvel` and `state` are.

Pattern:
1. Each frame, if `cornerFlags[0] & 4` and the agent is within 0.6 m of `corners()[0]`, identify the link by nearest start in your table.
2. Suspend the agent (`resetMoveTarget()`).
3. Run your own traversal:
   - drop: give the CharacterVirtual horizontal velocity and let gravity work; clips `Jump_Start` → `Jump_Loop` → `Jump_Land`.
   - jump up: impulse, or a scripted arc.
   - ladder: kinematic lerp; clips `Climb_Enter` / `Climb_Up_Loop` / `Climb_Exit` (UAL1).
4. Finish with `agent.teleport(end)` + `requestMoveTarget(originalGoal)`.

## 6. NPC locomotion: CharacterVirtual vs kinematic

**Recommendation:** every AI-driven combatant and the companion is a **Jolt CharacterVirtual** (same capsule as the player, r 0.3, h 1.8). Set `mInnerBodyShape` / `mInnerBodyLayer = L.MOVING` (exposed in jolt-physics 1.1.0), so that:
- the player capsule and other NPCs collide with it (MOVING↔MOVING is already enabled);
- arrows and `Physics.rayCast` hit it.

Steering comes from dtCrowd.

Per fixed step (`physics.onStep`):
```ts
for (const a of agents) { const p = a.body.GetPosition(); a.agent.raw.set_npos(0,p.GetX()); a.agent.raw.set_npos(1,p.GetY()); a.agent.raw.set_npos(2,p.GetZ()); }
crowd.update(dt);
for (const a of agents) { const v = a.agent.velocity(); a.vel.Set(v.x, a.body.IsSupported() ? 0 : a.vy - 9.81*dt, v.z); a.body.SetLinearVelocity(a.vel); a.body.ExtendedUpdate(dt, g, upd, bpF, objF, bodyF, shapeF, tmpAlloc); }
```
- Facing: glTF faces +Z, so yaw = atan2(vx, vz), the same as `faceTo` in `src/prologue/actors.ts`. Smooth the turn at about 8 rad/s.
- Locomotion clips are chosen from the actual horizontal speed, like `walkPath`: `Walk_Loop` /1.4, `Jog_Fwd_Loop` /3.4, `Sprint_Loop`.
- Cost: about 0.6–0.8 ms per 60 Hz step for 20 agents, plus 0.15 ms for the crowd.
- LOD: agents more than 60 m away and off-screen go "dormant" (crowd only, Y from `heightAt`, no CharacterVirtual update).
- Kinematic mode (no physics, Y from `heightAt`) stays for Director-scripted extras: keep `walkPath` and add a `navWalkTo()` that uses `computePath` for scripted walks that must route around buildings.
- The player is a crowd agent too: `requestMoveVelocity(playerVel)` each frame, plus `teleport` if it drifts more than 0.5 m. NPCs then avoid the player with RVO.
- Dead NPCs: `crowd.removeAgent`, destroy the CharacterVirtual, then use the existing `ragdoll.ts`.
- `Physics` needs a **static-only** ray filter for perception line of sight. The current `rayCast` uses the MOVING filter and would hit NPC inner bodies.

## 7. Babylon's own plugin: not recommended

`@babylonjs/addons/navigation` `RecastNavigationJSPluginV2`:
- by default injects an importmap and loads recast 0.43.0 from **unpkg** at runtime (bad for offline play, the service worker and CSP), unless you pass `{instance}`;
- worker mode is marked "still under construction", and it builds the worker from `Function.toString()` into a blob, which is incompatible with bundled imports;
- takes Babylon `Mesh[]` rather than our collider arrays.

Use `@recast-navigation/*` directly; the needed wrapper is about 300 lines.

## 8. Minimal AI architecture (≤20 agents)

Proposed layout under the framework split: `src/engine/nav` (NavWorld, NavZone, nav.worker, NavGeometry, debug) and `src/engine/ai` (Perception, Brain/HFSM, Combat, Companion, AIManager). The story layer gets `ai.spawn(spec)`, `ai.group('keep_guards')`, and Director helpers such as `until(() => ai.group(g).allDead)`. `ai.suspend(npc)` hands an NPC to Director scripts (`say` / `walkPath`).

**Tick budget:**
- Crowd and CharacterVirtual: every fixed step.
- Locomotion and animation: every frame.
- Brain: 10 Hz, round-robin.
- Perception: 5 Hz, round-robin, at most 4 line-of-sight rays per frame.
- Replanning (`requestMoveTarget`) only when the goal moves more than 1 m, or every 0.5 s.

**Perception:**
- Sight: 120° cone (160° once alerted), range 25 m outside and 15 m inside the keep and cave. Line of sight is a static-only ray from eye height 1.6 m to the target's chest at 1.2 m.
- Awareness meter: rate = (1 − d/range) × light × (sneak ? 0.4 : 1) × (moving ? 1.3 : 1). Thresholds: Unaware → Suspicious at 0.3 (investigate the last known position) → Alerted at 1.0.
- Hearing via a noise bus: footsteps 8 m when running, weapon clash 20 m, shouts alert allies within 15 m.
- Memory: last seen position and time. After 8 s unseen → Search (`findRandomPointAroundCircle(last, 6)` for 10 s) → Return to post.

**Brain:** a hierarchical FSM, which is easier to debug than a behaviour tree at this scale. Top-level states:
- Idle / Patrol / Guard
- Investigate
- Combat
- Search
- Return
- Flee (low HP for civilians)
- Dead
- Scripted (Director override)

Combat sub-states:
- Approach
- Circle / Wait (strafe on a 3–5 m ring slot while waiting for a token)
- Attack: windup → active → recovery
- Block
- Stagger
- Reposition

Inside Combat, a utility score with cooldowns and randomness picks light, heavy, shield bash, block or strafe.

**Melee timing:** hit frames below come from the peak of root-relative `hand_r` speed, from FK over `assets-src/chars/anim_full/UAL1.glb` and `UAL2.glb` (Quaternius, CC0).

| clip | duration | active window | hit at |
|---|---|---|---|
| `Sword_Regular_A` | 0.43 s | 0.20–0.27 | 0.24 (+ `_Rec` 0.97 s) |
| `Sword_Regular_B` | 0.53 s | 0.23–0.30 | 0.27 (+ `_Rec` 1.03 s) |
| `Sword_Regular_C` | 2.00 s | 0.63–0.67 | 0.65 |
| `Sword_Heavy_A` | 0.73 s | 0.40–0.53 | 0.45 (+ `_Rec` 1.0 s) |
| `Sword_Light_A` | 0.37 s | 0.17–0.30 | 0.22 |
| `Sword_Attack` (UAL1) | 1.53 s | 0.37–0.47 | 0.40 |
| `Punch_Jab` | 0.87 s | | 0.18 |
| `Kick` | 1.10 s | | 0.30 |
| `Sword_Block` | 1.23 s | guard up by 0.10 | |
| `Hit_Knockback` | 0.83 s | | |

- Telegraphing: NPC windups are too fast to read at 1×, so play the clip at 0.6× until the hit frame (giving at least 0.35–0.45 s of warning), with a grunt and a weapon glint, then 1× through recovery.
- Hit test at the hit frame:
  - target within weapon reach (1.7 m sword, 1.2 m fist) of the attacker's root;
  - within ±50° of facing, and |Δy| < 1.2;
  - static-only line of sight not blocked.

  This is cheap and deterministic. An optional Jolt shape cast can come later.
- Block / parry: block pressed more than 0.15 s before the hit = parry (attacker staggers). A normal block costs stamina and plays a recoil. Guard break → `Idle_Shield_Break`.
- Poise: damage drains poise; at 0 → `Hit_Knockback` and 1 s stun. Directional hit reactions: `Hit_Chest` / `Head` / `Stomach` / `Shoulder_L` / `Shoulder_R`.
- **Attack tokens:** at most 2 attackers on the player at once, 1 on the companion. Token holders approach to 1.5 m; the others circle. Re-evaluate at 2 Hz.
- Clips to add to `KEEP_CLIPS` / `KEEP_CLIPS_2` in `tools/gen/characters.mjs`:
  - attacks: `Sword_Regular_A`/`A_Rec`/`B`/`B_Rec`/`C`, `Sword_Heavy_A`/`A_Rec`, `Shield_OneShot`;
  - combat movement: `Walk_L_Loop`, `Walk_R_Loop`, `Walk_Bwd_Loop`, `Jog_Bwd_Loop`, `Jog_Left_Loop`, `Jog_Right_Loop`, `Dodge_Left`, `Dodge_Right`;
  - reactions and stances: `Hit_Shoulder_L`, `Hit_Shoulder_R`, `Idle_Shield_Break`, `Sword_Enter`, `Sword_Exit`;
  - unarmed: `Punch_Jab`, `Punch_Cross`, `Kick`;
  - traversal: `Climb_Enter`, `Climb_Up_Loop`, `Climb_Exit`, `LiftAir_Fall_Loop`.

**Companion follow** (Brun or the scribe, depending on the player's choice):
- Slot: three candidates (left-back, right-back, back) 2.5 m behind the player's yaw. Snap each with `findClosestPoint` and pick the first valid one with line of sight. Retarget when the player moves more than 1.5 m, or every 0.5 s.
- Speed: under 3 m walk, 3–8 m jog, over 8 m sprint.
- Stop within 4 m when the player is idle, and face the player or a point of interest.
- Use a partial-path check. If the companion is stuck, or more than 30 m away and off-screen, teleport it to a navmesh point behind the player outside the camera frustum.
- In combat: target enemies currently attacking the player, use the enemy-side tokens, and add a cost for standing between the player and the player's target.
- The Director can command wait / follow / go-to through `ai.suspend` and `ai.resume`.

## 9. Research artifacts (sandbox only; nothing in the project was modified)

- /tmp/claude-0/research/nav/bench.mjs: town build, path, crowd, off-mesh test
- /tmp/claude-0/research/nav/prof.mjs and /tmp/claude-0/research/nav/prof2.mjs: detail-sample profiling
- /tmp/claude-0/research/nav/tc.mjs: TileCache + off-mesh + obstacles + import
- /tmp/claude-0/research/nav/npos.mjs: physics-authoritative crowd sync
- /tmp/claude-0/research/nav/yacc.mjs: height accuracy
- /tmp/claude-0/research/joltbench.mjs: 20 × CharacterVirtual cost
- /tmp/claude-0/research/hitframes.mjs: UAL hit-frame extraction
- /tmp/claude-0/research/vitetest/: Vite 8.3.2 build check
- /tmp/claude-0/research/addons/package/navigation/: Babylon plugin source

## Recommendations
- Navmesh generation, path queries, crowd steering: @recast-navigation/core + @recast-navigation/generators + @recast-navigation/wasm, all pinned to exactly 0.43.1 (scoped packages, not the umbrella) | https://registry.npmjs.org/@recast-navigation/core (github.com/isaac-mason/recast-navigation-js) | MIT (recast-navigation-js) + zlib (embedded Recast/Detour, (c) 2009 Mikko Mononen). Commercial OK; add both to the third-party notices | verified=True | npm i -E @recast-navigation/core@0.43.1 @recast-navigation/generators@0.43.1 @recast-navigation/wasm@0.43.1
- Vite/ESM integration without the 1 MB compat build: resolve.alias /^@recast-navigation\/wasm$/ -> node_modules/@recast-navigation/wasm/dist/recast-navigation.wasm.js; optimizeDeps.exclude all three packages; keep worker.format 'es'. Vite rewrites the glue's new URL(...wasm, import.meta.url) to a hashed asset in main and worker bundles | Sandbox build with vite@8.3.2 at /tmp/claude-0/research/vitetest; Vite assetImportMetaUrl plugin source in node_modules/vite/dist/node/chunks/node.js | n/a | verified=True | Edit vite.config.ts (see findings section 2). Runtime cost: wasm 105 KB br + glue 30 KB br + core about 6 KB br; worker adds about 37 KB br
- Navmesh type for town + keep + cave with doors and rubble: TileCache (generateTileCache), tileSize 32, cs 0.25, ch 0.2, walkableHeight 9 / walkableClimb 2 / walkableRadius 2 (VOXELS), slope 50, expectedLayersPerTile 4, maxObstacles 64; off-mesh links injected via TileCacheMeshProcess.setOffMeshConnections; doors and portcullis as box obstacles; one TileCache, Crowd and NavMeshQuery per zone | Measured in Node 22: 0.44 s for a 200x200 m terrain, 0.84-0.93 s with 130k-tri soup + keep + houses; obstacle update 0.5 ms; export 156 KB; off-mesh links survive rebuild and import | MIT/zlib | verified=True | import { generateTileCache } from '@recast-navigation/generators'; exportTileCache/importTileCache(bin, meshProcess) from core
- Where to build the navmesh: At runtime in a module worker (src/engine/nav/nav.worker.ts) from the exact Jolt static-collider triangle soup (a NavGeometry sink in Physics.addStaticMesh/addHeightField/addBox, clipped to zone bounds), with the result cached in IndexedDB keyed by SHA-256(soup) + NAV_VERSION. Optional later: dump the bin via a Playwright e2e hook into public/data. A pure tools/ bake would have to re-implement town.ts placement | Existing patterns: src/core/assets/AssetClient.ts (module worker), src/core/assets/idb.ts; PrologueStage.ensurePhysics builds the colliders | n/a | verified=False | new Worker(new URL('./nav.worker.ts', import.meta.url), { type: 'module', name: 'nav' }); transfer Float32Array/Uint32Array in and Uint8Array out
- NPC locomotion integrated with Jolt: Active NPCs and the companion use a Jolt CharacterVirtual with mInnerBodyShape on L.MOVING (player collision and ray hits). dtCrowd provides steering and avoidance. Each fixed step: write the body position into agent.raw.set_npos(), call crowd.update(dt), then feed agent.velocity() + gravity into ExtendedUpdate. Never teleport per frame. Dormant LOD (crowd only, Y from heightAt) beyond 60 m off-screen. Player registered as a crowd agent via requestMoveVelocity | Measured: 20 CharacterVirtual = 0.60 ms per step (0.68 ms with CharacterVsCharacterCollisionSimple); crowd with 20 agents = 0.11-0.15 ms per update; npos write-back test reached the goal with body and agent matching to 1e-6; jolt-physics 1.1.0 types expose mInnerBodyShape and mInnerBodyLayer | MIT (jolt-physics, already a dependency) | verified=True | Already installed (jolt-physics ^1.1.0)
- Jumps, drops and ladders: Per-zone data table of off-mesh links with flags (WALK 1, JUMP 2, LADDER 4, DOOR 8). Per-archetype crowd filters via crowd.getFilter(i) and agent queryFilterType. Custom traversal triggered when cornerFlags[0] & 4 and the agent is within 0.6 m: suspend the agent, play a physics drop or scripted ladder/jump with UAL Jump_* / Climb_* clips, then teleport + requestMoveTarget | Verified that cornerFlags & 4 and state()==DT_CROWDAGENT_STATE_OFFMESH appear; built-in dtCrowd traversal is a linear lerp of (dist/maxSpeed)*0.5 s, which is unsuitable for ladders | n/a | verified=True | agent.raw.get_cornerFlags(i), agent.state(), Detour.DT_CROWDAGENT_STATE_OFFMESH
- AI decision layer (perception, behaviour, companion): Own small modules: Perception (cone + static-only Jolt LOS ray, awareness meter, noise bus, memory) at 5 Hz round-robin; hierarchical FSM brain at 10 Hz with a utility pick inside Combat; attack-token scheduler (max 2 on the player); companion slot-follow with teleport catch-up. Do not adopt Yuka (last release 2022-09-17) | npm registry (yuka 0.7.8 modified 2022-09-17); design in findings section 8 | n/a (first-party code) | verified=True | New code under src/engine/ai (framework split)
- Melee timing data: Hit frames from UAL clips: Sword_Regular_A 0.24/0.43 s, Sword_Regular_B 0.27/0.53, Sword_Heavy_A 0.45/0.73, Sword_Light_A 0.22/0.37, Sword_Regular_C 0.65/2.0, Sword_Attack 0.40/1.53, Punch_Jab 0.18, Kick 0.30. NPC windup played at 0.6x to telegraph; arc hit test (1.7 m reach, ±50°, |dy| < 1.2, static LOS); parry window 0.15 s; poise/stagger with Hit_Knockback. Add the listed clips to KEEP_CLIPS / KEEP_CLIPS_2 | assets-src/chars/anim_full/UAL1.glb and UAL2.glb (Quaternius Universal Animation Library, CC0), hand_r FK speed peak at 30 Hz | CC0 | verified=True | Already in assets-src; edit KEEP_CLIPS in tools/gen/characters.mjs
- Babylon-native navigation plugin: Reject @babylonjs/addons RecastNavigationJSPluginV2: it loads recast from unpkg at runtime by default, its worker mode is under construction (Function.toString blob), and it takes Babylon Meshes. Write a small wrapper instead and use getNavMeshPositionsAndIndices for the debug mesh | @babylonjs/addons 9.29.0 tarball: navigation/factory/common.js, factory.worker.js | Apache-2.0 | verified=True | n/a (not adopted)

## Risks
- recast-navigation-js is pre-1.0 (0.43.x) and minor versions break the API; core/generators/wasm must be the same exact version. The umbrella `recast-navigation` 0.43.1 was published 2026-02-04 and the scoped core/wasm 0.43.1 on 2026-04-07, so pin the scoped packages with npm -E.
- Recast walkableHeight/walkableClimb/walkableRadius are in VOXELS (defaults 2/2/0.5 mean 0.4 m tall agents at ch=0.2), while detailSampleDist/detailSampleMaxError are world units. A wrong unit produces navmesh through doorways or none at all.
- In 0.43.1, generateTiledNavMesh with detailSampleDist=0 crashes (wasm memory access out of bounds in buildPolyMeshDetail). Small detail sampling (1.5 m / 0.2) costs 20-36 s for a 200x200 m town. Use TileCache, or detail 6/1 with tileSize 32.
- NavMeshQuery.computePath returns success:true for PARTIAL paths (verified with a blocked door and an unreachable ledge). The AI must check the distance from path.at(-1) to the goal, otherwise companions and guards will stop at walls believing they arrived.
- dtCrowd's built-in off-mesh traversal is a linear lerp of (horizontal dist / maxSpeed) * 0.5 s, so ladders complete almost instantly and drops look like sliding. Custom traversal is needed. The JS binding doesn't expose the corridor's poly refs or the offmesh animation, so links must be matched by position from our own table.
- Off-mesh link endpoints must lie on the eroded navmesh (at least walkableRadius from walls and ledges), or the link silently doesn't connect. My first ladder test failed for this reason.
- The worker build of the wasm glue hard-codes ENVIRONMENT_IS_WEB=true / ENVIRONMENT_IS_WORKER=false. It has no DOM references and uses fetch + import.meta.url, so a module worker should work, but I did not run it in a browser (rules forbid browsers and dev servers). Vite dev with optimizeDeps.exclude is also untested; only `vite build` was verified.
- Bundling the worker duplicates the 275 KB (30 KB br) glue in a second chunk, and the existing SW plugin precaches every chunk plus the 339 KB .wasm, adding about 175 KB br to the first-visit shell download.
- Navmesh height error versus true terrain is about 0.15-0.18 m mean and up to about 0.57 m. Kinematic NPCs that take Y from the navmesh will float or sink on hills, so use CharacterVirtual or World.heightAt for Y.
- Physics.rayCast currently uses the MOVING object-layer filter. Perception line of sight needs a static-only filter, or NPC inner bodies and debris will block or falsely pass sight checks.
- agent.teleport() resets the path corridor and forces a replan. Syncing physics to the crowd must use agent.raw.set_npos() before crowd.update() (verified in Node), which relies on raw binding fields that could change in future versions.
- The first-visit navmesh bake costs about 0.5-1 s of worker CPU in Node/V8 (likely 2-4x on low-end mobile). Start it right after ensurePhysics during the scripted chapters, and gate the keep chapter's AI on it. The IndexedDB cache key must include the collider hash and NAV_VERSION.
- All recast objects (NavMesh, TileCache, NavMeshQuery, Crowd, QueryFilter, generator intermediates) live in the wasm heap and must be destroy()ed in chapter dispose, as Physics already does for Jolt, or memory leaks across chapters and menu returns.
- The 20-agent budget estimates (CharacterVirtual about 0.6-0.8 ms per step, crowd about 0.15 ms) were measured in Node, not in browsers. Physics.update can run up to 4 substeps per frame at low FPS, multiplying the cost.