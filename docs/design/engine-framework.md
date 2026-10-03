# 《北境》 engine framework: final specification

**Status:** implementation-ready, v1.0.

**Scope:** `/home/user/northern-prologue` is turned into a reusable engine layer (`src/engine`, `tools/engine`). It serves as the base for "large web 3D game demos". 《北境：序章》 stays the flagship content (`src/northern`, `tools/northern`), and a second consumer lives in `demos/template`.

---

## 0. Decisions

### 0.1 Base and verdict

The base design is **incremental**, which scored highest in aggregate (111, against 105 for data-driven and 103 for packages). It has the lowest migration risk and its claims match the repo. The rules it brings:
- One repository, one Vite app per game, an `@engine/*` alias, and no workspaces.
- Configurable singletons.
- Machine-checked boundaries.
- Gates compared against a baseline.
- An early template.

### 0.2 Grafted ideas (source in brackets)

1. **Named checkpoints plus `establish(at, entry)`** [data-driven]. One code path serves new game, load, skip and debug jump. It is introduced through a `legacyChapter` adapter that maps today's numeric `step` to checkpoint names, so `stage.chapter.step` keeps working. Chapters are converted one at a time. `run()` stays plain async code, with **no condition DSL**.
2. **WorldState flags plus ambient systems** [data-driven]: `town.breach`, `town.burning` and `dragon.rampage` drive fires and the rampage. Those systems outlive `DragonChapter.dispose()` and carry into the keep.
3. **A single CAST table** [data-driven/packages], plus `ActorRegistry.script(id, scope)` as the cinematic override for AI [data-driven].
4. **StageManager semantics** [packages]:
   - Serialized, latest wins, with an AbortSignal passed to factories.
   - `try/finally` resets screens, HUD, pause DOM, music and input context.
   - The previous stage is kept if the new one fails.
   It comes with a **PauseController** holding a set of reasons and a **boot intent queue** that replaces the `starting` flag race in `main.ts`.
5. **Asset groups decoupled from chapters** [packages]: `ChapterDef.groups`, a manifest `groups` table, and v1 manifests still parsed with `segment` kept as an alias. The worker receives order, dbName, nearRadius, retries and slots in its `init` message.
6. **Service worker** [packages]: VERSION hashes the *contents* of the decoder files, the cache prefix is set per app with `legacyPrefixes` cleanup (the flagship keeps `shell-`), and `skipWaiting` can be turned off per app.
7. **All Vite-specific code in one engine file** (`src/engine/runtime/vite.ts`), a lightweight form of packages' RuntimeBindings. It holds the worker factory, the Jolt `?url` import, `import.meta.env` and the decoder base. No virtual modules.
8. **Intra-engine layering L0/L1/L2** [packages], checked by script. **check-entry inspects Rollup module ids**, not chunk-name regexes [judge 3].
9. **Melee as analytic swept capsules** [incremental/data-driven]:
   - Socket poses are sampled after animations and swept on the **physics fixed step** [packages R13].
   - Each swing hits a target at most once.
   - Jolt is used only for STATIC-layer occlusion rays; death hands off to the existing `Ragdoll`.
   - Combat runs on world and fixed-step time and is **not** tied to `ScriptApi`.
10. **AI as a plain FSM `Brain`** over a crowd `NavAgent`, with the navmesh **baked offline from the collision node output**. Recast is pinned to one version, which is stored in the nav asset header. There is **no main-thread runtime bake**.
11. **Objectives with failsafes.** `glide`, `walk` and `fly` resolve `{completed:false}` when pre-empted and reject `Cancelled` when their scope is cancelled.
12. **`layout.json` as the single source of truth** for generators and runtime (`WHEEL_R`, `TOWER`, `GATE`, `LAYOUT`). It is a hard prerequisite for the navmesh and collider bakes.
13. **Pipeline** [incremental/packages]:
    - `createBuild/emit/step/finish` extracted verbatim and checked with `--only=menu/` identity.
    - `paths.mjs` for module-relative caches.
    - Start-pack budgets as build failures, a rig clip contract check, and credits taken from provenance.
14. **Explicit glTF extension registration** [judge 3, measured]:
    - The pipeline emits `gltfExtensions` and generated code registers only those.
    - Today the 28 GLBs use exactly 4: `EXT_meshopt_compression`, `KHR_mesh_quantization`, `KHR_texture_basisu`, `KHR_materials_specular`.
    - This removes roughly 104 dead chunks (92 flowGraph/interactivity and 12 splat chunks, out of 433 in `dist/app`).
15. **CSS follows code without render-blocking.** Kit CSS lives in `src/engine/ui/kit.css` and is **inlined into index.html** by a `transformIndexHtml` marker plugin, so there is never a `<link>`. Critical menu CSS and the static `#menu` markup stay in `index.html`.
16. **Deferred SW registration and a critical/deferred precache split** [judge 3, P2]. Today 446 shell files install alongside first boot.
17. **Typed game types without casts.** One `GameTypes` interface is augmented per game, with one tsconfig per game. This replaces `settings as SettingsStore<NorthernSettings>` and `Input<string>`. Typed asset ids come later and are optional (P7).
18. **Recipe table as the docs front page** [data-driven §3.6]. **Template v0 at S15**, before the large world/actor moves.

### 0.3 Rejected

These come from the three judges' must-avoid lists:
- Any gate that needs `node tests/e2e.mjs` to exit 0.
- Relocating to `apps/*` and npm workspaces before decoupling. Files move exactly once.
- `virtual:northern/runtime` and `?worker` on package subpaths.
- Per-file `tsc -b`, export maps, changesets, api-extractor or publish readiness.
- A root engine barrel, or a "content imports only via barrels" rule.
- Removing all singletons mid-migration, and an ambient `services()` locator.
- A declarative Condition/EstablishSpec/AmbientDef DSL, and rewriting chapters inside infrastructure steps.
- Devtools HMR re-establish, worker policy modules loaded by URL, behaviour trees, Residency budgets, and engine stock content (`MANNEQUIN_KIT`, `stock.overcast`, `STOCK_STICK`) before M3.
- Jolt kinematic hurtbox bodies.
- `CombatSystem.attack(..., ScriptApi)`.
- Interiors only as offset regions sharing CSM/IBL/broadphase with no isolation.
- Main-thread runtime navmesh bake.
- `sideEffects: ["**/*.css"]`.
- Any render-blocking stylesheet.
- Renaming any persistent identity, DOM id, button text, perf mark, URL flag or `__game` surface.
- Long-lived shims without a ratchet.
- The template linking `../../src/engine/ui/kit.css` from outside its Vite root.
- Writing M3 code against `Director.cancelAll`, `game.modal` or `ChapterContext.stage`.

### 0.4 Facts verified in the repo (implementers rely on these)

**Test baselines**
- Only `tests/e2e.mjs` has an exit code. It already exits 1 under SwiftShader: README:115 records "ride starts ≤10 s" at **19.6 s ❌**.
- `chain/jump/chapter/dragon/muster/ui/smoke/probe` are log and screenshot drivers. They expect a preview server on :4173 and `/opt/pw-browsers/chromium-1194`. e2e spawns `tools/serve.mjs` on :4190.
- `tests/muster.mjs:45` clicks the stale `[data-sex=f]`; the creator renders `data-sex-step` (`src/ui/creator.ts:86`).

**Entry chunk**
- `dist/app/index-Bkk6Z3So.js` is 27,614 B. The only modulepreload is `AssetClient-*.js` at 2,611 B.

**Code locations**
- `URLSearchParams` appears at **9 sites**: `main.ts:101,155,232`; `Game.ts:67,71`; `engine.ts:34`; `PrologueStage.ts:40`; `chapters/execution.ts:49`; `chapters/dragon.ts:61`.
- Ghost-script source: the global `director.cancelAll(); director.reset();` at `PrologueStage.ts:261-262`.
- Vite-only constructs:
  - `Physics.ts:16` (`jolt-physics.wasm.wasm?url`)
  - `AssetClient.ts:23` (`new Worker(new URL(...))`, spawned at import by the singleton at `:155`)
  - `main.ts:17` (`import.meta.env.PROD`)
  - `loaders.ts:10` (`registerBuiltInGLTFExtensions()`)

**index.html**
- All UI CSS is one inline `<style>`, lines 11-173. Kit rules run from `.panel` through `#fatal` plus the trailing `@media`; `.hidden`, `button`, `.orn*`, `.heading*` and `kbd` come early.
- `#menu` markup is at lines 179-212.
- The subset font `Northern Serif` is used only through `--display`. Subtitles use `--sans` (system fonts), so widening the subset to dialogue text would only grow the font.

**Manifest and storage**
- `public/manifest.json` has 73 assets, keys `{version, generated, assets}`, and no `groups`. Segment counts: cart 35, muster 14, dragon 20, execution 2, menu 2.
- The saves DB is `northern-saves` v1, store `saves`, keyPath `id`.
- Chapters keep a private numeric `step` that tests read at runtime: muster 0..2, execution 0..1 (`?from=block` gives 1), dragon 0..3 (`?from=tower|breach|street`).

**Tools**
- `tools/serve.mjs` resolves its default root relative to itself (`../dist`), so its path is frozen.
- `tools/lib/ktx.mjs:9` and `tools/gen/audio.mjs:11` resolve `.cache` relative to the module.

**Environment:** Node 22.22, Vite 8.3.2, TypeScript 7.0.2 (no `baseUrl`), Babylon 9.29, Jolt 1.1. Recast is not installed yet.

---

## 1. Repository and package structure

### 1.1 End-state tree

```
index.html                       flagship shell: tokens, fonts, menu CSS inline; markers <!-- @engine:kit-base.css --> <!-- @engine:kit.css -->
vite.config.ts                   export default defineGameConfig({ sw: { cachePrefix: "shell-" }, ... })
vite.template.config.ts          export default defineGameConfig({ root: "demos/template", outDir: "../../dist-template", sw: { cachePrefix: "template-shell-", skipWaiting: false } })
tsconfig.base.json               shared compilerOptions + paths {"@engine/*": ["./src/engine/*"]}  (no baseUrl; TS7)
tsconfig.json                    flagship program: extends base; include ["src"]
demos/template/tsconfig.json     template program: extends ../../tsconfig.base.json; include ["src", "../../src/engine", "../../src/vite-env.d.ts"]
tools/tsconfig.json              allowJs+checkJs over tools/engine/**/*.mjs (P-track, optional)
src/
  main.ts                        `import "./northern/main";`
  vite-env.d.ts
  generated/                     pipeline outputs: credits.json, layout.json, gltf-extensions.ts, versions.json (recast pin)
  assets/fonts/                  ui-serif-400/700.woff2 + glyphs.txt (frozen glyph set; S0b)
  engine/                        @engine/*  (no content, no CJK, no asset-id literals, no game DOM ids)
    core/        types.ts scope.ts emitter.ts debug.ts json.ts
    runtime/     index.ts vite.ts                                   (ONLY file allowed Vite-isms)
    platform/    settings.ts input.ts audio.ts saves.ts idb.ts
    assets/      AssetClient.ts asset.worker.ts schedule.ts protocol.ts manifest.ts loaders.ts gltfUtils.ts gltfExtensions.ts
    app/         definition.ts boot.ts App.ts StageManager.ts PauseController.ts Stage.ts loop.ts render.ts PauseMenu.ts debugOverlay.ts stages/BlankStage.ts
    ui/          strings.ts hud.ts screens.ts panels.ts widgets.ts menu.ts kit-base.css kit.css
    script/      Director.ts dialogue.ts
    story/       Chapter.ts Sequencer.ts legacy.ts holdToSkip.ts
    state/       WorldState.ts ambient.ts
    quest/       triggers.ts Objectives.ts QuestLog.ts
    world/       WorldBase.ts heightfield.ts scatter.ts instancing.ts route.ts meshes.ts zones.ts(M5)
    render/      environment.ts materials.ts
    physics/     Physics.ts colliders.ts ragdoll.ts
    actors/      Character.ts CharacterFactory.ts ActorRegistry.ts motion.ts yaw.ts presets/ueMannequin.ts
    anim/        AnimController.ts ProceduralLayer.ts SplineMover.ts            (M1)
    creatures/   Creature.ts RigProfile.ts                                      (M1)
    character/   CharacterMotor.ts InputLatch.ts LocomotionAnimator.ts PlayerController.ts
    camera/      CameraRig.ts
    fx/          projectile.ts vfx.ts(M2)
    combat/      hit.ts vitals.ts weapons.ts CombatSystem.ts MeleeController.ts hurtboxes.ts   (M2)
    nav/         recast.ts NavWorld.ts navAsset.ts                              (M3)
    ai/          Brain.ts AISystem.ts Perception.ts AgentMover.ts states.ts     (M4)
  northern/                      flagship content (imports engine ONLY via @engine/*)
    main.ts definition.ts types.ts strings.zh-CN.ts saveCodec.ts story.ts flags.ts debugAliases.ts PrologueStage.ts
    config/   actions.ts settings.ts segments.ts audio.ts physics.ts player.ts camera.ts
    menu/     MenuStage.ts
    ui/       creator.ts endcard.ts settingsSchema.ts credits.ts
    world/    NorthernWorld.ts atmosphere.ts terrain.ts town.ts layout.ts ambient.ts
    actors/   cast.ts appearance.ts playerBody.ts wagon.ts dragon.ts rigs.ts
    fx/       fire.ts arrow.ts
    chapters/ context.ts cart.ts cartScript.ts muster.ts execution.ts dragon.ts roam.ts (keep.ts exit.ts in K1/K2)
demos/template/
  index.html theme.css public/{manifest.json,data/} src/{main.ts,definition.ts,types.ts,strings.en.ts,ArenaStage.ts,story.ts} tools/build-assets.mjs
tools/
  engine/   paths.mjs check-boundaries.mjs boundary-allow.json check-entry.mjs check-entry.config.json check-glyphs.mjs serve.mjs fonts.mjs
            lib/{gltf,ktx,ktx-thread,hdr,audio}.mjs
            pipeline/{build,verify,upgrade-manifest,gltf-extensions}.mjs
            gen/{shapes,noise,heightfield,scatterpack,terrainChunks,layout,colliders(M3),navmesh(M3),sdf(M5),marchingCubes(M5)}.mjs
            fetch/{polyhaven,http}.mjs
            vite/{defineGameConfig,swPlugin,reportPlugin,inlineKitCss}.ts sw.template.js
            test/{harness,pixeldiff,unit}.mjs
  northern/ build-assets.mjs layout.mjs sources.mjs credits-extra.mjs fetch-sources.mjs fetch-extra.mjs fetch-fonts.mjs preview-terrain.mjs
            gen/{world,terrain,scatter,fir,cart,houses,townbuildings,characters,dragon,audio,keep_interior(M5),cave(M5)}.mjs
  serve.mjs                      frozen 2-line shim → tools/engine/serve.mjs --root <repo>/dist  (tests/e2e.mjs spawns this path)
tests/
  *.mjs (existing names kept)  gate.mjs  gate/{boot,ui-dom,legacy-saves,compare-e2e}.mjs  checkpoints.mjs  template.mjs
  unit/**/*.test.ts  baseline/{e2e.json,gate.json,ui-dom/*.png,checkpoints.json}  results/ (gitignored)
docs/engine/                     §9
```

There is **no `index.ts` barrel anywhere.** Content imports by module path, for example `@engine/physics/Physics`. Babylon side-effect imports (`shadowGeneratorSceneComponent`, `thinInstanceMesh`, `particleSystemComponent`, glTF loader registration) stay in the module that needs them.

### 1.2 Layers (checked by `check-boundaries.mjs`)

| Layer | Directories | May import |
|---|---|---|
| **L0 core** | `core/`, `runtime/` | nothing outside L0. `runtime/vite.ts` may use `import.meta.env`, `?url` and `new Worker(new URL(...))` |
| **L1 boot-safe** | `platform/`, `assets/{AssetClient,manifest,protocol,schedule}.ts`, `ui/{strings,hud,screens,widgets,menu,panels}.ts`, `app/{definition,boot,PauseController,Stage}.ts` | L0, L1. Only `import type` from `@babylonjs/*`. L2 only through `import()` |
| **L2 runtime** | everything else | L0, L1, L2, `@babylonjs/*`, `jolt-physics*`, `@recast-navigation/*` |
| **M3 isolation** | `combat/ ai/ nav/ quest/ state/ anim/ creatures/ world/zones.ts` | no *value* import of the platform singletons (`settings`, `input`, `audio`, `assets`, `hud`). Dependencies come through constructor arguments (ADR-002) |

Content (`src/northern`, `demos/template/src`) imports engine code only through `@engine/*`. `src/engine` never imports content. `demos` never imports `src/northern`, and the reverse is also forbidden.

### 1.3 Config and scripts

```jsonc
// tsconfig.base.json: today's compilerOptions plus paths (TS7 resolves paths relative to this file)
{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
  "lib": ["ES2023","DOM","DOM.Iterable","WebWorker"], "strict": true, "noUnusedLocals": true,
  "noFallthroughCasesInSwitch": true, "skipLibCheck": true, "resolveJsonModule": true,
  "isolatedModules": true, "noEmit": true, "types": ["vite/client"],
  "paths": { "@engine/*": ["./src/engine/*"] } } }
```

Vite gets an explicit alias in `defineGameConfig`, not `resolve.tsconfigPaths`:
`resolve.alias: [{ find: /^@engine\//, replacement: fileURLToPath(new URL("../../src/engine/", import.meta.url)) }]`

`package.json` scripts in the end state:

| Script | Command |
|---|---|
| `typecheck` | `tsc --noEmit -p tsconfig.json && tsc --noEmit -p demos/template/tsconfig.json` |
| `build` | `npm run typecheck && vite build && node tools/engine/check-entry.mjs` (Cloudflare build command unchanged) |
| `build:template` | `vite build -c vite.template.config.ts` |
| `check` | `npm run typecheck && vite build && npm run build:template && node tools/engine/check-boundaries.mjs && node tools/engine/check-entry.mjs && node tools/engine/check-glyphs.mjs` |
| `test:unit` | `node tools/engine/test/unit.mjs` (Vite SSR-builds `tests/unit/**/*.test.ts` with the alias into `.cache/unit/`, then `node --test`) |
| `gate` | `node tests/gate.mjs` |
| `preview` | `node tools/serve.mjs` |
| `build-assets` | `node tools/northern/build-assets.mjs` |
| `fetch-sources` | `node tools/northern/fetch-sources.mjs && node tools/northern/fetch-extra.mjs` |
| `template:assets` | `node demos/template/tools/build-assets.mjs` |
| `test:e2e` | `node tests/e2e.mjs` |
| `test:template` | `node tests/template.mjs` |

**Why one tsconfig per game.** `GameTypes` augmentation is global within a program. Two games in one program would collide, so the template program compiles the engine on its own. That also proves the engine has no flagship coupling.

### 1.4 Frozen identities and test contract

| Kind | Frozen value | Owner after migration |
|---|---|---|
| localStorage | `northern.settings.v1` | `northern/definition.ts` `storage.settingsKey` |
| IndexedDB | `northern-saves` (store `saves`, keyPath `id`), `northern-assets` | `storage.savesDb`, `storage.assetsDb` |
| Data files | `data/<sha16>.<ext>` | pipeline `naming`, SW `dataPattern` |
| SW cache prefix | `shell-` | `vite.config.ts` `sw.cachePrefix` |
| Perf marks | `menu-interactive`, `assets-ready`, `engine-ready`, `menu-3d-ready` (engine); `cart-preloaded`, `cart-started` (`definition.marks`) | `engine/app/boot.ts` |
| DOM | `#scene #smoke #ui #menu nav button[data-act] #version #keyhints #dlstatus #subtitle #toast(.on) #prompt #fade #loadhint #crosshair #pause #panel #endcard #fatal #creator [data-race] [data-sex-step] [data-act=done] input[type=text]` | engine ids in `kit.css`; game ids in `northern/*` |
| Button text | 新游戏 设置 制作人员 读取 继续; pause: 继续 跳过本章 存档 读取 设置 返回主菜单; toasts 进入塔楼 跳进旅店 | `strings.zh-CN.ts` |
| URL flags | `?webgl ?debug ?timescale ?chapter ?from ?roam` (+ new `?checkpoint`) | `engine/core/debug.ts` and `northern/debugAliases.ts` |
| `window.__game` | App: `.stage .pause(on) .save(kind)`; `stage.chapter.{id,step}`, `stage.skipChapter()`, `stage.player.{position,teleport(),canMove}`, `stage.world.{heightAt(),rig.{camera,yaw,pitch,lookToward()},npcs.get(n).{root,bone()}}`, `stage.appearance` | compat getters on `northern/PrologueStage.ts` |
| Other globals | `window.__assetsProgress()`, `window.__stats` | `boot.ts`, `debugOverlay.ts` |

### 1.5 Machine-checked guards

**`tools/engine/check-boundaries.mjs`** uses a regex import scan and resolves relative paths and `@engine/`. It fails on:
1. Layer violations as defined in §1.2.
2. CJK characters in `src/engine/**`: `/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/`.
3. Asset-id literals in the engine: ``/["'`](cart|chars|ph|audio|fx|dragon|town|menu|nav|col|arena)\//``.
4. `location.search` anywhere except `src/engine/core/debug.ts`.
5. `import.meta.env`, `?url`, `?worker` or `new Worker(` outside `src/engine/runtime/vite.ts`.
6. `getElementById("menu"|"creator"|"endcard"|"smoke"|"scene")` in the engine.
7. `node:` imports under `src/` or `demos/*/src`.
8. Relative imports from content into `src/engine`, which must use `@engine/*`.
9. **Deprecation ratchet.** `boundary-allow.json` has the shape `{ "exceptions": [{file, rule, count}], "deprecations": {"musicTracks": 7, "App.modal": 3, ...} }`. The script counts current occurrences, fails if any count rises, and prints the counts that may now be lowered. `exceptions` must be `[]` after S24. `deprecations` must be `{}` after C5.

**`tools/engine/check-entry.mjs`** reads `.cache/build-report.json`. `reportPlugin` writes that file in `writeBundle`, per chunk: `fileName, isEntry, isDynamicEntry, imports, dynamicImports, moduleIds, bytes, brotliBytes`. It checks:
- **Entry closure** (the entry plus transitive static `imports`):
  - no moduleId matches `/node_modules\/(@babylonjs|jolt-physics|@recast-navigation|recast-navigation)\//`;
  - raw size ≤ 40 KB (today 30.2 KB);
  - brotli size ≤ 14 KB.
- **First-screen closure**: the entry closure plus everything reachable from `firstScreenRoots` in `check-entry.config.json` (`src/engine/app/App.ts`, `src/engine/app/render.ts`, `src/northern/menu/MenuStage.ts`). Its brotli size must stay ≤ S0 baseline × 1.05; the baseline is recorded in S0a.
- **Template**: the same checks against `.cache/build-report.template.json`, with a forbid list that adds `src/engine/(combat|nav|ai|creatures)/` until template v2.

**`tools/engine/check-glyphs.mjs`**:
- Before P5: `src/assets/fonts/glyphs.txt` (frozen in S0b) must be a superset of the glyphs the current extractor yields from its sources.
- From P5: it must also cover every glyph in `strings.zh-CN.ts` display tables and `index.html`.
- It works offline because it compares text sets, not woff2 cmaps.

---

## 2. Engine modules: public APIs

Notation: `n` = number, `V3` = `Vector3`, `Disposer = () => void`. APIs not listed keep today's behaviour.

### 2.1 `core` (L0)

```ts
// @engine/core/types.ts: per-game type registry, augmented once per tsconfig program
export interface GameTypes {}
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Quality = "low" | "medium" | "high";
export interface BaseSettings { quality: Quality; renderScale: n; fov: n; sensitivity: n; invertY: boolean;
  master: n; music: n; sfx: n; voice: n; subtitles: boolean; keys: Record<string, string> }
export type Settings    = GameTypes extends { settings: infer S extends BaseSettings } ? S : BaseSettings;
export type Action      = GameTypes extends { action: infer A extends string } ? A : string;
export type SavePayload = GameTypes extends { save: infer P } ? P : Json;
export type Flags       = GameTypes extends { flags: infer F extends Record<string, Json> } ? F : Record<string, Json>;
// northern/types.ts:
// declare module "@engine/core/types" { interface GameTypes { settings: NorthernSettings; action: NorthernAction; save: PrologueSave; flags: NorthernFlags } }

// @engine/core/scope.ts
export class Cancelled extends Error { constructor(readonly reason?: string) }
export const isCancelled = (e: unknown): e is Cancelled => e instanceof Cancelled;
export type Disposer = () => void;
export class Scope {
  constructor(parent?: Scope, name?: string);
  readonly signal: AbortSignal; readonly name: string; get cancelled(): boolean;
  child(name?: string): Scope;                                   // cancelled with the parent
  add(d: Disposer | { dispose(): void }): void;                  // LIFO on cancel; errors logged, not thrown
  wait<T>(p: PromiseLike<T> | ((s: AbortSignal) => PromiseLike<T>)): Promise<T>;  // rejects Cancelled if the scope ends first
  listen(t: EventTarget, type: string, fn: EventListener, o?: AddEventListenerOptions): void;   // signal-bound
  timeout(fn: () => void, ms: number): void;                     // WALL clock (UI only)
  cancel(reason?: string): void;                                 // idempotent
}
// @engine/core/emitter.ts
export class Emitter<T> { on(fn: (v: T) => void, scope?: Scope): Disposer; once(scope?: Scope): Promise<T>; emit(v: T): void; clear(): void }
// @engine/core/debug.ts: the ONLY reader of location.search; ?webgl always honoured, everything else requires ?debug
export interface DebugFlags { readonly enabled: boolean; readonly webgl: boolean; readonly timescale: n;
  has(k: string): boolean; get(k: string): string | null; num(k: string, d: n): n }
export const debug: DebugFlags;
```

### 2.2 `runtime` (L0): the only Vite-specific file

```ts
// @engine/runtime/index.ts
export interface RuntimeBindings {
  assetWorker(): Worker;                 // vite: new Worker(new URL("../assets/asset.worker.ts", import.meta.url), { type: "module", name: "assets" })
  joltWasmUrl(): Promise<string>;        // vite: import("jolt-physics/jolt-physics.wasm.wasm?url")
  recastWasmUrl?(): Promise<string>;     // M3
  decoderBase: string;                   // new URL("decoders/", document.baseURI).href
  production: boolean;                   // import.meta.env.PROD
}
export function configureRuntime(b: RuntimeBindings): void;
export function runtime(): RuntimeBindings;  // throws before configureRuntime (boot does it)
// @engine/runtime/vite.ts
export const viteRuntime: RuntimeBindings;
```

Promoting the engine to a package later means providing other `RuntimeBindings`, which is ADR-001's checklist.

### 2.3 `platform/settings` (L1)

```ts
export interface SettingsConfig<T extends BaseSettings> { storageKey: string; defaults: T; version?: n;
  migrate?(stored: Record<string, unknown>, fromVersion: n): Partial<T>; clamp?(v: T): T; guessQuality?(): Quality | null }
export class SettingsStore<T extends BaseSettings = Settings> {
  configure(c: SettingsConfig<T>): void;          // reads storage; memory fallback when localStorage throws
  get value(): Readonly<T>;                       // dev build throws if read before configure()
  set<K extends keyof T>(k: K, v: T[K]): void;    // debounced save (150 ms); emits with the key
  reset(): void;
  on(fn: (s: T, key: keyof T | null) => void, keys?: readonly (keyof T)[], scope?: Scope): Disposer;  // per-key filter
}
export const settings: SettingsStore<Settings>;   // typed by GameTypes; no casts anywhere
export function guessQualityFromGPU(): Quality;   // today's regexes
```

`App` subscribes with `on(fn, ["quality", "renderScale"])`, so dragging a volume slider no longer re-runs `applyQuality`.

### 2.4 `platform/input` (L1)

```ts
export interface PadMap<A extends string> { buttons: Partial<Record<A, n>>; moveAxes: [n, n]; lookAxes: [n, n];
  deadzone: n; lookPxPerSec: [n, n]; back: n; start: n }
export interface InputConfig<A extends string> { actions: readonly A[]; defaultKeys: Record<A, string>; pad: PadMap<A>;
  mouseRadPerPx: n /* 0.0022 */; reserved?: readonly string[] /* never bindable */;
  bindings(): Record<A, string>; sensitivity(): n; invertY(): boolean }   // last three wired by boot from settings
export type InputContext = "gameplay" | "menu" | "modal" | "text" | "rebind";
export class Input<A extends string = Action> {
  configure(c: InputConfig<A>): void; attach(canvas: HTMLCanvasElement): void;
  poll(dt: n): void; endFrame(): void;
  down(a: A): boolean; pressed(a: A): boolean; released(a: A): boolean; pressedCode(code: string): boolean; padPressed(i: n): boolean;
  move(): [n, n]; consumeLook(): [n, n];                 // look accumulates only in "gameplay"
  pushContext(c: InputContext): Disposer; readonly context: InputContext;   // only the top context gets edges; edges reset on change
  captureNextKey(signal: AbortSignal): Promise<string>;  // replaces keyHook; refuses modifiers/reserved; resolves the code
  requestLock(c: HTMLCanvasElement): void; releaseLock(): void; readonly locked: boolean;
  readonly usingPad: boolean; readonly mouseButtons: n;
}
export const input: Input<Action>;
```

`preventDefault` follows the current bindings instead of the literal `Tab`/`F5`.

### 2.5 `platform/audio` (L1; `AudioContext` is created lazily)

```ts
export type MusicState = "calm" | "tense" | "combat";
export interface AudioConfig { buses: readonly string[]; volumes(s: Settings): Record<string, n>; uiBus?: string; emitterYOffset?: n }
export interface SoundHandle { stop(fade?: n): void; setVolume(v: n, t?: n): void; readonly done: boolean; readonly ready: Promise<void> } // valid before decode
export interface AudioScope { bed(key: string, id: string, vol?: n, fade?: n): SoundHandle;
  loopAt(id: string, pos: () => { x: n; y: n; z: n }, vol?: n): SoundHandle;
  oneShot(id: string, vol?: n, pos?: { x: n; y: n; z: n }, o?: { bus?: string; rate?: n; ref?: n }): SoundHandle; dispose(fade?: n): void }
export class AudioSystem {
  configure(c: AudioConfig): void; unlock(): void; readonly ctx: AudioContext | null;
  load(id: string): Promise<AudioBuffer>; isLoaded(id: string): boolean;
  playMusic(id: string, o?: { fade?: n; volume?: n; loop?: boolean }): Promise<void>; stopMusic(fade?: n): void;
  readonly music: { setTracks(t: Partial<Record<MusicState, string>>): void; setState(s: MusicState): void; reset(): void };
  /** @deprecated (ratchet; removed in C5) */ musicTracks: Partial<Record<MusicState, string>>; /** @deprecated */ setMusicState(s: MusicState): void;
  startBed(key: string, id: string, vol?: n, fade?: n, bus?: string): Promise<void>; setBedVolume(k: string, v: n, t?: n): void;
  setBedRate(k: string, r: n): void; stopBed(k: string, fade?: n): void; stopAllBeds(fade?: n): void;
  emitter(bus?: string): PannerNode | null; setListener(px: n, py: n, pz: n, fx: n, fy: n, fz: n): void;
  playOneShot(id: string, vol?: n, pos?: { x: n; y: n; z: n }, bus?: string, rate?: n, ref?: n): Promise<AudioBufferSourceNode | undefined>;
  uiTick(kind?: "move" | "select"): void; suspend(): void; resume(): void;
  scope(): AudioScope;               // one per stage/chapter; App.onReset → music.reset() + stopAllBeds
}
export const audio: AudioSystem;
```

### 2.6 `platform/saves` and `platform/idb` (L1)

```ts
export type SaveKind = "auto" | "quick" | "manual";
export interface SaveRecord<S = Json> { id: string; kind: SaveKind; label: string; segment: string /* streaming group; persistent field name */;
  createdAt: n; playSeconds: n; state: S; thumb?: string; schema?: n; gameVersion?: string }
export class SaveStore {
  constructor(c: { dbName: string; store?: string /* "saves" */; manualCap?: n });
  write(r: SaveRecord): Promise<void>; list(): Promise<SaveRecord[]>; latest(): Promise<SaveRecord | undefined>; delete(id: string): Promise<void>;
}
export interface SaveCodec<P> { schema: n; decode(r: SaveRecord | null, debug: DebugFlags): P; encode(p: P): Json } // null = new game; legacy M1/M2 handled here
export function openDB(name: string, version: n, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase>;
export function reqP<T>(r: IDBRequest<T>): Promise<T>; export function txDone(tx: IDBTransaction): Promise<void>;
```

### 2.7 `assets`

```ts
// manifest.ts (L1)
export type AssetType = "glb" | "ktx2" | "audio" | "hdr" | "json" | "bin" | "nav";
export interface AssetVariant { url: string; hash: string; size: n }
export interface ManifestEntry extends AssetVariant { id: string; type: AssetType; group?: string; segment: string /* v1 alias, kept */;
  priority: n; pos?: [n, n] | [n, n, n]; optional?: boolean; loop?: boolean; variants?: Record<string, AssetVariant> }
export interface Manifest { schema?: 2; version: string; generated?: string; groups?: { id: string; order: n }[];
  gltfExtensions?: string[]; assets: ManifestEntry[] }
export type ResolvedEntry = Omit<ManifestEntry, "variants"> & { group: string };
export function parseManifest(m: unknown, fallbackOrder: readonly string[]): Manifest & { order: readonly string[] };  // v1 and v2; unknown group → error
export function resolveManifest(m: Manifest, pick: (e: ManifestEntry) => AssetVariant | null): ResolvedEntry[];
export const pickAudioCodec: (e: ManifestEntry) => AssetVariant | null;   // today's opus→aac policy
// AssetClient.ts (L1; not spawned at import)
export interface StreamingConfig { order: readonly string[]; dbName: string; concurrency: n /*6*/; nearRadius: n /*160*/;
  backgroundSlotsWhenUrgent: n /*2*/; maxRetries: n /*3*/ }
export class AssetClient {
  configure(c: Pick<StreamingConfig, "order" | "dbName"> & Partial<StreamingConfig> & { pickVariant?: typeof pickAudioCodec }): void;
  init(m: Manifest, group: string): Promise<string[]>;      // spawns runtime().assetWorker(); calls before ready are queued; worker.onerror rejects pending
  get(id: string): Promise<ArrayBuffer>; setSegment(group: string): void; setPlayerPosition(x: n, z: n): void; setPaused(p: boolean): void;
  stats(): Promise<CacheStats>; clear(): Promise<void>; onProgress(fn: (p: Progress) => void): Disposer; readonly progress: Progress | null;
  segmentProgress(g: string): SegmentProgress | undefined; startPack(g: string): string[]; startPackProgress(g: string): n;
  has(id: string): boolean; entry(id: string): ResolvedEntry | undefined; idsFor(g: string): string[];
}
export const assets: AssetClient;
// schedule.ts: pure rank/evict functions (unit-tested); the worker imports them
export function rank(e: ResolvedEntry, ctx: { order: readonly string[]; current: string; player: [n, n] | null; nearRadius: n; demanded: boolean }): [n, n, n];
// protocol.ts: ToWorker.init gains { config: StreamingConfig }
// loaders.ts (L2): options default to today's values
export interface GlbOptions { animationStartMode?: n /*0*/; compileMaterials?: boolean /*false*/; createInstances?: boolean /*true*/ }
export function loadGLB(id: string, scene: Scene, o?: GlbOptions): Promise<AssetContainer>;
export function loadKTX2(id: string, scene: Scene, o?: { wrap?: boolean; noMipmap?: boolean; anisotropy?: n /*8*/ }): Promise<Texture>;
export function loadJSON<T>(id: string): Promise<T>; export function blobURL(id: string, type?: string): Promise<string>;
// gltfUtils.ts: nextFrame(), instantiateSubset(...) moved unchanged
// gltfExtensions.ts (P1): explicit registration
export type GltfExtFactory = (loader: GLTFLoader) => Promise<IGLTFLoaderExtension>;
export function registerGltfExtensions(list: Record<string, GltfExtFactory>): void;  // called once by boot with src/generated/gltf-extensions.ts
```

### 2.8 `app`

```ts
// Stage.ts (L1, types only)
export interface MenuItem { id: string; label: string; run(): void }
export interface Stage {
  readonly scene: Scene; readonly group: string /* current streaming group → SaveRecord.segment */;
  gameplay: boolean;                         // pause menu + pointer lock allowed
  update(dt: n): void; applyQuality(q: Quality): void; setPaused(p: boolean): void;
  saveState(): { label: string; state: Json } | null; dispose(): void;
  begin?(): void;                            // explicit; replaces the duck call in Game.ts
  pauseItems?(): MenuItem[];                 // replaces duck-typed canSkip/skipChapter
}
export interface GameStage<P> extends Stage { prepare(payload: P, signal: AbortSignal): Promise<void> }  // built behind the menu
export interface StageContext { app: App; services: AppServices; signal: AbortSignal; scope: Scope }
export interface AppServices { settings: SettingsStore<Settings>; input: Input<Action>; audio: AudioSystem; assets: AssetClient;
  saves: SaveStore; hud: Hud; screens: ScreenStack; strings: EngineStrings; debug: DebugFlags }

// StageManager.ts
export class StageManager {
  readonly current: Stage | null; readonly transitioning: boolean; readonly changed: Emitter<Stage | null>;
  transition(make: (ctx: StageContext) => Promise<Stage>, o?: { owned?: boolean /* default true: dispose if superseded */ }): Promise<Stage | null>;
  // serialized; latest wins (earlier factory's signal aborted; its stage disposed if owned)
  // finally: onReset.emit() (hud.reset, screens.reset, pause DOM, audio.music.reset + stopAllBeds, input context → base, crosshair off)
  // on factory failure: previous stage kept, toast strings.boot.startFailed, returns null
}
// PauseController.ts
export type PauseReason = "user" | "visibility" | "pointer" | "modal" | "loading" | "debug";
export class PauseController { set(r: PauseReason, on: boolean): void; has(r: PauseReason): boolean; clear(): void;
  readonly paused: boolean; readonly changed: Emitter<boolean> }
// pause menu shows iff some of {user, visibility, pointer} is set and no screen with pausesWorld is open

// App.ts (L2, class formerly Game; window.__game in debug)
export class App {
  constructor(def: GameDefinition<any>, services: AppServices);
  readonly engine: AbstractEngine; readonly api: "webgpu" | "webgl2";
  readonly stages: StageManager; readonly pausing: PauseController; readonly onReset: Emitter<void>;
  get stage(): Stage | null; get paused(): boolean; timeScale: n; playSeconds: n;
  init(): Promise<void>;                     // createEngine, input.attach, listeners, render loop
  pause(on: boolean): void;                  // = pausing.set("user", on): test contract
  save(kind: SaveKind): Promise<SaveRecord | null>;   // failure → toast, never throws into scripts
  exitToMenu(): Promise<void>;
  /** @deprecated ratchet, removed in S11 follow-up/C2 */ get modal(): boolean; set modal(v: boolean);
}
// loop.ts: frame contract, body wrapped in try/catch (Babylon stops scheduling frames after one throw):
//   input.poll → global keys (top screen/context) → stage.update(dt) → scene.animationTimeScale → scene.render → input.endFrame
//   3 consecutive throws → hud.toast(strings.boot.fatal) once; loop keeps running
// render.ts
export interface RenderOptions { forceWebGL?: boolean; webgpu?: Partial<WebGPUEngineOptions> }
export function createEngine(canvas: HTMLCanvasElement, o?: RenderOptions): Promise<{ engine: AbstractEngine; api: "webgpu" | "webgl2" }>;  // decoders from runtime().decoderBase

// definition.ts (L1): the single object a game hands to the engine
export interface GameDefinition<P = SavePayload> {
  id: string; version: string;
  dom: { canvas: string; ui: string; menu: string; backdrop?: string };        // ids without '#'
  storage: { settingsKey: string; savesDb: string; assetsDb: string };       // frozen identities
  settings: Omit<SettingsConfig<Settings>, "storageKey">;
  input: Omit<InputConfig<Action>, "bindings" | "sensitivity" | "invertY"> & { pause: Action; quicksave?: Action };
  audio: AudioConfig;
  assets: { manifestUrl: string; order: readonly string[]; menuGroup: string; streaming?: Partial<StreamingConfig>;
            gltfExtensions?: () => Promise<Record<string, GltfExtFactory>> };
  render?: RenderOptions; strings: EngineStrings;
  ui: { settings: SettingsSection<Settings>[]; credits?: () => Promise<CreditsData> };
  saves: SaveCodec<P>; menu: { music?: string };
  stages: { menu(ctx: StageContext): Promise<Stage>; createGame(ctx: StageContext): Promise<GameStage<P>>; startGroup(p: P): string };
  marks: { started: string; preloaded?: string };                            // northern: "cart-started", "cart-preloaded"
  sw?: { url: string } | false;
  onReady?(app: App): void;
}
// boot.ts (L1; App is import("./App"); never statically imports Babylon)
export type BootPhase = "shell" | "manifest" | "assets" | "engine" | "menu" | "starting" | "playing" | "failed";
export type BootIntent = { kind: "new" } | { kind: "continue" } | { kind: "load"; save: SaveRecord };
export interface BootHandle { readonly phase: BootPhase; app(): Promise<App>; intent(i: BootIntent): void; showMenu(): Promise<void> }
export function boot<P>(def: GameDefinition<P>, rt?: RuntimeBindings /* default viteRuntime */): BootHandle;
```

`boot()` runs today's `main.ts` sequence in a generic form:
1. `configureRuntime`, then configure settings, input, audio and assets; install the `unhandledrejection` filter for `Cancelled`.
2. Attach the main-menu controller to the DOM menu and set the `menu-interactive` mark.
3. Fetch the manifest network-first, then `assets.init(menuGroup)`, mark `assets-ready`, and call `persist()`.
4. Load `App` lazily, mark `engine-ready`, transition to the menu stage, mark `menu-3d-ready`, then refresh saves and start the menu music.
5. Build `createGame` behind the menu and mark `marks.preloaded`.
6. Process **intents** from a queue. Only one starts at a time; a later intent replaces a queued one that has not started; intents during `starting` are ignored. This replaces the `starting` flag race.
7. On start:
   - `codec.decode`, then `setSegment(startGroup)`, then the `strings.boot.preparing(pct)` hint;
   - `stage.prepare`, then fade, then `stages.transition(owned:false)`;
   - autosave on a new game, mark `marks.started`, fade in.
8. Register the SW (from P2, on idle after `menu-3d-ready`).
9. Expose `__game` and `__assetsProgress` when `debug.enabled`.

### 2.9 `ui`

```ts
// strings.ts: typed tables; no key-string i18n
export interface EngineStrings {
  locale: string; readingTime(text: string): n; keyLabel(code: string): string;
  hud: { loading: string };
  pause: { title: string; resume: string; skip: string; save: string; load: string; settings: string; exitToMenu: string; saved: string; quickSaved: string };
  saves: { title: string; empty: string; kinds: Record<SaveKind, string>; date(t: n): string; failed(m: string): string; delete: string };
  settings: { title: string; on: string; off: string; pressKey: string; reset: string; back: string; prev: string; next: string;
    computing: string; cacheUsage(bytes: n, files: n): string; downloaded(pct: n): string; clearCache: string; confirmClear: string };
  credits: { title: string; back: string; kinds: Record<string, string> };
  boot: { preparing(pct: n | null): string; startFailed(m: string): string; fatal(m: string): string; background(pct: n, mbps: n | null): string; allCached: string };
  prompts: { usingPad(action: string): string };
}
// hud.ts: today's calls + configure/reset/objective
export interface Hud {
  configure(o: { root: HTMLElement; strings: EngineStrings; subtitles: () => boolean }): void;
  subtitle(who: string | null, text: string, force?: boolean): void; clearSubtitle(): void;
  loading(on: boolean, text?: string): void; fade(on: boolean, seconds?: n, signal?: AbortSignal): Promise<void>; flash(strength?: n, seconds?: n): void;
  toast(text: string, ms?: n): void; prompt(text: string | null): void; crosshair(on: boolean): void; downloadStatus(text: string): void;
  objective(text: string | null): void; reset(): void;   // reset() runs on every stage change
}
export const hud: Hud;
// screens.ts: replaces Game.modal and scattered checks; ONE Esc/pad-B route
export interface Screen { id: string; el?: HTMLElement; pointer: "free" | "locked"; input: InputContext; pausesWorld?: boolean;
  onBack?(): boolean /* true = handled */; dispose?(): void }
export interface ScreenHandle { close(): void; readonly closed: boolean }
export class ScreenStack { push(s: Screen, scope?: Scope): ScreenHandle; top(): Screen | null; has(id: string): boolean; readonly size: n;
  back(): boolean; reset(keep?: readonly string[]): void; readonly changed: Emitter<Screen | null> }   // pushes/pops input contexts; focus restore
export const screens: ScreenStack;
// panels.ts: schema-driven
export type SettingRow<T> =
  | { kind: "select"; key: keyof T; label: string; options: [unknown, string][] }
  | { kind: "slider"; key: keyof T; label: string; min: n; max: n; step: n; format(v: n): string }
  | { kind: "toggle"; key: keyof T; label: string }
  | { kind: "keys"; actions: readonly Action[]; labels: Record<string, string> }
  | { kind: "cache" } | { kind: "custom"; build(row: HTMLElement, scope: Scope): void };
export interface SettingsSection<T> { title: string; rows: SettingRow<T>[] }
export interface CreditsData { intro: string; groups: { title?: string; items: { name: string; authors?: string; source?: string; license: string; licenseUrl?: string; kind?: string }[] }[] }
export function configurePanels(o: { schema: SettingsSection<Settings>[]; credits?: () => Promise<CreditsData>; saves: SaveStore }): void;
export function openSettings(): ScreenHandle; export function openCredits(): Promise<ScreenHandle>; export function openLoad(onPick: (s: SaveRecord) => void): Promise<ScreenHandle>;
// widgets.ts
export function heading(title: string, tag?: "h1" | "h2"): HTMLElement; export function orn(kind: "l" | "r" | "mid"): HTMLElement;
export function styleRange(i: HTMLInputElement): HTMLInputElement;
export function menuList(items: MenuItem[] | [string, () => void][], o?: { scope?: Scope }): HTMLElement;  // navigation via input context, not window keydown
// menu.ts: main-menu controller over game-owned DOM (keyboard + ONE pad loop)
export function attachMainMenu(nav: HTMLElement, o: { actions: Record<string, () => void>; visible(): boolean; scope: Scope }): { select(i: n): void; refresh(): void };
// PauseMenu (app/PauseMenu.ts): [resume, ...stage.pauseItems?.(), save, load, settings, exitToMenu] with EngineStrings
```

**Kit CSS** is split into two files:
- `kit-base.css`: `.hidden`, `button`, `.orn*`, `.heading*`, `kbd`.
- `kit.css`: `.panel*`, `.stepper*`, `.credits*`, `.saves*`, `.empty`, `input[type=range]*`, `#pause*`, `.menu-list*`, `#subtitle*`, `#loadhint*`, `#fade*`, `#crosshair`, `#toast*`, `#dlstatus`, `#prompt`, `#endcard*`, `#fatal`, and the `@media (max-width:600px)` block.

Both are moved verbatim, keeping their order. `inlineKitCss` replaces the `<!-- @engine:kit-base.css -->` and `<!-- @engine:kit.css -->` markers with `<style>` blocks in dev and build, and watches the files with a full reload. Tokens read: `--ink --ink-dim --ink-faint --glow --line --line-strong --band --display --serif --sans`, the names that exist today.

### 2.10 `script`

```ts
export interface DialogueSink { subtitle(who: string | null, text: string, force: boolean): void; clearSubtitle(): void }  // hud satisfies it
export interface Speaker { play(clip: string, o?: { blend?: n }): unknown; lookAt(p: V3 | null): void }                    // Character/Creature satisfy it
export interface SayOptions { npc?: Speaker | null; look?: V3 | (() => V3) | null; talk?: string; idle?: string; gap?: n; duration?: n }
export interface ScriptApi {                                     // a Director facade bound to one Scope
  readonly time: n; readonly scope: Scope;
  sleep(s: n): Promise<void>; until(pred: () => boolean, timeout?: n): Promise<boolean>;   // false on timeout
  wait<T>(p: PromiseLike<T>): Promise<T>; say(name: string, text: string, o?: SayOptions): Promise<void>;
  all(...ps: Promise<unknown>[]): Promise<unknown[]>;
  spawn(name: string, fn: (s: ScriptApi) => Promise<void>): ScriptApi;   // child scope; Cancelled swallowed, other errors logged
  after(s: n, fn: () => void): Disposer;                                  // game-time timer (replaces setTimeout in FX/scripts)
}
export class Director {
  constructor(o: { dialogue: DialogueSink; readingTime(text: string): n; subtitlesForced?: boolean });
  update(dt: n): void; scoped(scope: Scope): ScriptApi;
  cancelAll(): void;                 // cancels every wait (stage dispose)
  /** @deprecated no-op since S1; ratchet */ reset(): void;
}
```

**Motion promise rule**, applied by every helper (`walkPath`, `rig.glide`, `SplineMover.move`, `Creature.fly`, `shootProjectile`, `hud.fade` with a signal):
- If the passed `signal` aborts, the promise **rejects `Cancelled`**.
- If a newer command pre-empts it (or `stopWalk`/`stop` is called), the promise **resolves `{ completed: false }`**.
- On natural completion it resolves `{ completed: true }`.

Existing `await` sites ignore the value, so the change is source-compatible.

### 2.11 `story`

```ts
export type Entry = "new" | "load" | "continued" | "skip" | "debug";
export interface StoryPosition { chapter: string; checkpoint: string | null; state: Json | null }
export interface ChapterRun<S extends Json = Json> {
  readonly checkpoint: string; readonly step: n;                 // step = checkpoints.indexOf(checkpoint): test compat
  establish(at: string /* a checkpoint or "end" */, entry: Entry, state: S | null): Promise<void>;  // FULL world state for that point
  run(from: string): Promise<void>;                              // plain async script from that checkpoint
  update?(dt: n): void; save(): S | null; dispose(): void;
}
export type ChapterCtx<Ctx> = Ctx & { id: string; script: ScriptApi; scope: Scope;
  checkpoint(name: string, o?: { autosave?: boolean /* default true */ }): Promise<void> };
export interface ChapterDef<Ctx, S extends Json = Json> {
  id: string; label: string; groups: readonly string[];          // streaming groups, decoupled from id
  seamless?: boolean; checkpoints: readonly [string, ...string[]];
  needs?(ctx: Ctx, signal: AbortSignal): Promise<void>;         // e.g. ensureTown
  make(ctx: ChapterCtx<Ctx>): ChapterRun<S>;
}
export function defineChapter<Ctx, S extends Json = Json>(d: ChapterDef<Ctx, S>): ChapterDef<Ctx, S>;
// legacy.ts: today's Chapter contract behind an adapter (removed in C5)
export interface LegacyChapter { id: string; label: string; seamless?: boolean; prepare(resume: Record<string, unknown> | null, continued?: boolean): Promise<void>;
  run(resume: Record<string, unknown> | null): Promise<void>; update?(dt: n): void; save(): Record<string, unknown>; skip?(): void; dispose(): void }
export function legacyChapter<Ctx>(o: { id: string; label: string; groups: readonly string[]; seamless?: boolean;
  checkpoints: readonly [string, ...string[]]; make(ctx: ChapterCtx<Ctx>): LegacyChapter }): ChapterDef<Ctx>;
//   establish(at, entry, state) → prepare(at === checkpoints[0] && !state ? null : { ...state, step: index(at) }, entry === "continued")
//   establish("end", "skip") → skip?.();  run(from) → run(resume of the last establish); step → inner.step
// Sequencer.ts: PrologueStage.play() made generic
export interface SequencerHooks { fade(on: boolean, s: n): Promise<void>; setGroups(g: readonly string[]): void; autosave(): Promise<void>;
  clearTransient(): void /* subtitle, prompt */; finished(): Promise<void>; error(e: unknown, chapter: string): "skip" | "end" }
export class Sequencer<Ctx> {
  constructor(o: { chapters: readonly ChapterDef<Ctx>[]; ctx: Ctx; director: Director; hooks: SequencerHooks });
  readonly current: { id: string; step: n; checkpoint: string } | null;   // stage.chapter returns this view
  readonly canSkip: boolean;
  prepare(at: StoryPosition, entry: Entry, signal: AbortSignal): Promise<void>;   // builds behind the menu
  play(signal: AbortSignal): Promise<"finished" | "aborted">;
  skip(): Promise<void>; jump(at: StoryPosition): Promise<void>;                  // debug: same path as load
  position(): StoryPosition; dispose(): void;
}
// holdToSkip.ts (from cart.ts:177-188)
export function holdToSkip(o: { held(): boolean; seconds: n; onProgress(k: n): void; onSkip(): void }): (dt: n) => void;
```

**Sequencer invariants:**
- Each chapter run gets a fresh child `Scope`, and its `ScriptApi` is `director.scoped(scope)`.
- The scope is cancelled on **both** skip and normal completion, before `dispose()`.
- The skip resolver is bound to a run token captured before the fade.
- `current = null` between `dispose` and the next `establish`.
- `signal.aborted` is checked after every `await`.
- An autosave failure produces a toast and never aborts the story.
- A per-chapter error boundary calls `hooks.error` and falls back to `establish("end", "skip")`.
- The story never advances while paused.

### 2.12 `state` (E1)

```ts
export interface Saveable<T extends Json = Json> { readonly key: string; readonly version: n; save(): T; load(d: T, fromVersion: n): void | Promise<void> }
export interface WorldSnapshot { v: 1; flags: Record<string, Json>; parts: Record<string, { v: n; d: Json }> }
export class WorldState {
  constructor(defaults: Flags);
  get<K extends keyof Flags>(k: K): Flags[K]; set<K extends keyof Flags>(k: K, v: Flags[K]): void;
  on<K extends keyof Flags>(k: K, fn: (v: Flags[K]) => void, scope?: Scope): Disposer;
  register(s: Saveable): Disposer; snapshot(): WorldSnapshot;
  restore(s: WorldSnapshot | undefined): Promise<void>;          // unknown parts kept verbatim (forward-compatible)
}
// ambient.ts: persistent world effects derived from flags (plain predicates, no DSL)
export interface AmbientSystem { id: string; active(state: WorldState): boolean; start(scope: Scope): void | Promise<void> }  // stopped by scope cancel
export class AmbientRunner { constructor(state: WorldState, systems: readonly AmbientSystem[], parent: Scope); sync(): void /* on flag change + after restore */; dispose(): void }
```

### 2.13 `world` and `render`

```ts
export interface Ground { heightAt(x: n, z: n): n }
export interface UpdateBus { onUpdate(fn: (dt: n) => void, scope?: Scope): Disposer }
export interface WorldSystem { update?(dt: n, cam: V3): void; applyQuality?(q: Quality): void; dispose(): void }
export interface WorldOptions { look: { consumeLook(): [n, n] }; fov(): n; camera?: Partial<CameraProfile>; emitterYOffset?: n }
export class WorldBase implements Ground, UpdateBus {
  constructor(engine: AbstractEngine, o: WorldOptions);            // right-handed scene, picking off (today's flags)
  readonly scene: Scene; readonly rig: CameraRig; readonly scope: Scope; time: n; disposed: boolean;
  physics: Physics | null; env: Environment | null; factory: CharacterFactory | null; readonly actors: ActorRegistry;
  get npcs(): ReadonlyMap<string, Character>;                       // test contract
  npc(name: string, spec?: Omit<CharacterSpec, "name">): Character; removeNpc(name: string): void;   // falls back to the CAST table
  setGround(g: Ground): void; heightAt(x: n, z: n): n; attachPhysics(p: Physics): void;  // world owns and disposes it
  onUpdate(fn: (dt: n) => void, scope?: Scope): Disposer; addSystem(s: WorldSystem): Disposer; addShadowCasters(m: AbstractMesh[]): void;
  loopEmitter(id: string, pos: () => V3, vol?: n): SoundHandle;
  ensure<T>(key: string, load: (signal: AbortSignal) => Promise<T>): Promise<T>;   // cached; rejected loads evicted
  update(dt: n): void;   // physics → updaters → rig → systems → listener + emitters → assets.setPlayerPosition
  applyQuality(q: Quality): void /* no-op unless the tier changed */; dispose(): void;
}
export class HeightField implements Ground { static parse(b: ArrayBuffer): HeightField; readonly n: n; x0: n; z0: n; step: n; h: Float32Array; heightAt(x: n, z: n): n }
export interface ScatterSetDef { asset: string; node?: (k: n) => string; types: readonly string[]; maxDistance: n; kind: string;
  foliage?: boolean; wind?: n; shadowCasterMaxDistance?: n; revealDistance?: n }
export class ScatterField implements WorldSystem { static parse(b: ArrayBuffer): ScatterField; data(type: string): Float32Array;
  add(c: AssetContainer, d: ScatterSetDef, env: Environment | null): void; stream(d: ScatterSetDef, scene: Scene): void;
  lodTable(kind: string, tiers: Record<Quality, n[]>): void }
export { InstancedSet, prepareForInstancing, type LodLevel } from "./instancing";   // moved unchanged
export class Route { constructor(r: { x: n[]; y: n[]; z: n[] }); pos(s: n, out?: V3): V3; dir(s: n, out?: V3): V3; yaw(s: n): n; readonly length: n }  // + end-tangent fallback
export function meshesUnder(c: AssetContainer, node?: string): Mesh[];
// render/environment.ts
export interface AtmospherePreset { fog: { color: [n, n, n]; density: n }; sun: { dir: [n, n, n]; intensity: n; color: [n, n, n] };
  fill: { intensity: n; sky: [n, n, n]; ground: [n, n, n] }; environmentIntensity: n; grade: Record<string, n> }
export interface AtmosphereDef { skyEnv: string; skyTexture: string; base: AtmospherePreset; presets?: Record<string, AtmospherePreset>;
  shadows: Record<Quality, { size: n; cascades: n } | null>; shadowMaxZ: n }
export interface Environment { sun: DirectionalLight; readonly shadows: CascadedShadowGenerator | null; pipeline: DefaultRenderingPipeline;
  addShadowCaster(m: AbstractMesh): void /* auto-removed on mesh dispose */; removeShadowCaster(m: AbstractMesh): void; applyQuality(q: Quality): void;
  setMood(k: n, preset?: string): void /* compat: lerp base → presets[preset ?? "mood"] */; blendTo(preset: string, seconds: n): void; dispose(): void }
export function createEnvironment(scene: Scene, camera: Camera, def: AtmosphereDef): Promise<Environment>;
// render/materials.ts: 5-slot GLSL/WGSL kept; layer names passed in (no codegen)
export function createTerrainMaterial(scene: Scene, layers: readonly [string, string, string, string, string]): { material: PBRMaterial; plugin: TerrainSplatPlugin };
export class WindPlugin { static time: n; amplitude: n; baseHeight: n; constructor(m: Material) }
```

### 2.14 `physics`

```ts
export interface LayerDef { name: string; broadphase: 0 | 1; collides: readonly string[] }
export interface PhysicsConfig { layers: readonly LayerDef[]; queryLayer: string; maxBodies?: n; maxBodyPairs?: n; maxContacts?: n;
  fixedDt?: n /*1/60*/; maxSubsteps?: n /*4*/; gravity?: [n, n, n] }
export const DEFAULT_PHYSICS: PhysicsConfig;                       // exactly today's STATIC/MOVING/DEBRIS/RAGDOLL matrix
export const L: { STATIC: 0; MOVING: 1; DEBRIS: 2; RAGDOLL: 3 };   // for DEFAULT_PHYSICS users
export function loadJolt(): Promise<JoltInstance>;                  // wasm URL from runtime()
export class Physics {
  static create(c?: PhysicsConfig, signal?: AbortSignal): Promise<Physics>; layer(name: string): n; readonly alpha: n;
  addStaticMesh(pos: ArrayLike<n>, idx: ArrayLike<n>, layer?: string): BodyID;
  addHeightField(x0: n, z0: n, size: n, samples: n, sample: (x: n, z: n) => n): BodyID;
  addBox(c: V3, half: V3, rot?: Quaternion, o?: { dynamic?: boolean; mass?: n; node?: TransformNode; layer?: string | n; friction?: n }): BodyID;
  addCapsule(a: V3, b: V3, r: n, o?: { layer?: string; node?: TransformNode; kinematic?: boolean }): BodyID;
  sync(id: BodyID, node: TransformNode): void; setVelocity(id: BodyID, v: V3, w?: V3): void; removeBody(id: BodyID): void;
  onStep(fn: (dt: n) => void): Disposer /* pre-step, today's API */; onPostStep(fn: (dt: n, stepTime: n) => void): Disposer;
  update(dt: n): void; rayCast(from: V3, dir: V3, maxDist: n, layer?: string): n;
  readonly tempAllocator: unknown; readonly movingBPFilter: unknown; readonly movingObjFilter: unknown; bodyFilter: unknown; shapeFilter: unknown;
  dispose(): void;                                                  // idempotent; also removes ragdoll constraints
}
export function appendWorldGeometry(m: AbstractMesh, pos: n[], idx: n[]): void;
export function buildStaticColliders(ph: Physics, meshes: AbstractMesh[], root: TransformNode, o?: { layer?: string; signal?: AbortSignal; perFrame?: boolean }): Promise<BodyID[]>;
export interface RagdollProfile { parts: readonly { bone: string; end: string | null; radius: n; parent: string | null }[];
  limits: Record<string, [n, n, n, n]>; mass: { torso: n; limb: n }; headLength: n; layer?: string }
export interface RagdollBody { root: TransformNode; bone(n: string): TransformNode | undefined; stopAnimations(): void; stopMotion?(): void }
export class Ragdoll { constructor(ph: Physics, body: RagdollBody, profile: RagdollProfile, impulse?: V3, atBone?: string); dispose(): void }
// actors/presets/ueMannequin.ts: bone names + ragdoll data only, no art
export const UE_MANNEQUIN: { ragdoll: RagdollProfile; bones: { head: "Head"; neck: "neck_01"; spine: ["spine_02", "spine_03"]; handR: "hand_r"; handL: "hand_l"; pelvis: "pelvis" } };
```

### 2.15 `actors`, `character`, `camera`

```ts
export interface PlayOptions { loop?: boolean; speed?: n; blend?: n; offset?: n }
export interface Animatable { readonly root: TransformNode; readonly meshes: AbstractMesh[]; play(clip: string, o?: PlayOptions): unknown }
export interface CharacterSpec { name: string; body?: string; outfit: readonly string[]; hair?: readonly string[]; face?: boolean }
export interface FactoryOptions { partPattern: RegExp; faceParts: readonly string[]; headBone: string; clipAliases?: Record<string, string> }
export class CharacterFactory { constructor(scene: Scene, bodies: Record<string, AssetContainer | null>, anims: AssetContainer[], o: FactoryOptions);
  setBody(key: string, c: AssetContainer): void; create(spec: CharacterSpec): Character; clipNames(): string[] }
export class Character implements Animatable, RagdollBody, Speaker {
  readonly name: string; readonly root: TransformNode; readonly meshes: AbstractMesh[]; headDown: n;
  play(clip: string, o?: PlayOptions): AnimationGroup;   // logical alias ("walk") or raw clip name
  clipLength(clip: string): n; lookAt(p: V3 | null): void; postAnimate(dt: n): void; stopAnimations(): void; stopMotion(): void;
  bone(name: string): TransformNode | undefined; setEnabled(on: boolean): void; dispose(): void }
export class ActorRegistry {                              // CAST table + script ownership
  constructor(world: WorldBase, cast: Record<string, CharacterSpec>);
  get(name: string): Character | undefined; spawn(name: string, spec?: Partial<CharacterSpec>): Character; remove(name: string): void;
  script(name: string, scope: Scope): Character;          // cinematic override: suspends Brain/NavAgent for the scope's lifetime (M4)
}
// motion.ts / yaw.ts
export interface MotionWorld extends Ground, UpdateBus {}
export function walkPath(w: MotionWorld, ch: Character, pts: V3[], o?: { speed?: n; clip?: string; ground?: boolean; arrive?: string; signal?: AbortSignal }): Promise<{ completed: boolean }>;
export function stopWalk(ch: Character): void;
export function stand(w: MotionWorld, ch: Character, x: n, z: n, look?: { x: n; z: n }, clip?: string): void;   // cancels walks
export function faceTo(ch: Animatable, p: { x: n; z: n }): void; export function setYaw(ch: Animatable, forwardYaw: n): void;
export const forwardYawFromDir: (dx: n, dz: n) => n; export const modelYaw: (forwardYaw: n) => n; export const dirFromForwardYaw: (y: n) => [n, n];
// character/
export interface PlayerProfile { radius: n; height: n; speeds: { sneak: n; walk: n; run: n; sprint: n }; jump: n; eyeHeight: n; crouchEye: n;
  pivot: { stand: n; crouch: n }; maxSlopeDeg: n; stepUp: n; stickDown: n; mass: n; strength: n; padWalkBelow: n; layer?: string }
export interface LocomotionClips { idle: string; walk: string; jog: string; sprint: string; crouchIdle: string; crouchMove: string;
  jumpStart: string; jumpLoop: string; jumpLand: string; below: { idle: n; walk: n; jog: n }; rate: { crouch: n; walk: n; jog: n; sprint: n } }
export interface PlayerControls { move(): [n, n]; sprint(): boolean; sneak(): boolean; jump(): boolean; togglePov(): boolean; usingPad(): boolean }
export class InputLatch { latch(key: string): void; consume(key: string): boolean; bufferTime: n }   // jump latched at render rate, consumed by the next fixed step
export class CharacterMotor { constructor(ph: Physics, p: PlayerProfile, start: V3);
  readonly position: V3 /* interpolated by alpha */; readonly velocity: V3; readonly onGround: boolean;
  step(intent: { vx: n; vz: n; jump: boolean }, dt: n): { jumped: boolean; landed: boolean }; teleport(p: V3): void /* zero velocity + RefreshContacts */; dispose(): void }
export class LocomotionAnimator { constructor(body: Animatable, clips: LocomotionClips); update(speed: n, grounded: boolean, crouch: boolean, dt: n): void;
  override(scope: Scope): void /* yields to scripts and melee */ }
export class PlayerController implements CameraTarget {
  constructor(ph: Physics, rig: CameraRig, body: Animatable, start: V3, yaw: n, p: PlayerProfile, c: PlayerControls, clips: LocomotionClips | null);
  firstPerson: boolean; enabled: boolean; canMove: boolean; canJump: boolean; sprinting: boolean; sneaking: boolean; bodyYaw: n; speed: n; body: Animatable;
  readonly motor: CharacterMotor; readonly animator: LocomotionAnimator | null; readonly position: V3; readonly onGround: boolean;
  teleport(p: V3, yaw?: n): void; update(dt: n): void; setEyeHeight(h: n): void; setBody(b: Animatable, heightScale?: n): void; dispose(): void;
  eye(out: V3): V3; pivot(out: V3): V3; clip(from: V3, dir: V3, max: n): n }
// camera/
export interface CameraTarget { eye(out: V3): V3; pivot(out: V3): V3; clip?(from: V3, dir: V3, max: n): n; firstPerson: boolean }
export interface CameraProfile { shoulder: n /*0.45*/; distance: n /*3.2*/; zoom: [n, n] /*1.2..9*/; pitchLimit: n /*1.35*/; seatYawLimit: n /*1.9*/; minZ: n; maxZ: n }
export class CameraRig {
  constructor(scene: Scene, o: { look: { consumeLook(): [n, n] }; fov(): n; profile?: Partial<CameraProfile>; scope?: Scope; wheel?: EventTarget });
  camera: FreeCamera; mode: "seat" | "cine" | "player"; yaw: n; pitch: n; distance: n; lookEnabled: boolean; sway: boolean; readonly position: V3;
  seat(node: TransformNode, offset: V3, yawLimit?: n): void; cut(pos: V3, look: V3): void;
  glide(pos: V3, look: V3, seconds: n, signal?: AbortSignal): Promise<{ completed: boolean }>;
  follow(t: CameraTarget): void; lookToward(p: V3 | (() => V3 | null), seconds?: n): Disposer; shake(amp: n, seconds: n): void;
  setFov(rad: n | null): void; zoom(dir: 1 | -1): void; update(dt: n): void; dispose(): void;   // drops settings + wheel listeners
}
```

### 2.16 `fx`

```ts
export function shootProjectile(w: MotionWorld & { scene: Scene }, template: (s: Scene) => Mesh, from: V3, to: () => V3,
  o?: { speed?: n; arc?: n; signal?: AbortSignal }): Promise<{ mesh: Mesh; hit: V3; completed: boolean }>;   // template cached per Scene (WeakMap)
// vfx.ts (M2, second consumer = combat sparks/blood): pooled presets, ref-counted textures (never disposeOnStop), priority light pool
export interface ParticlePreset { texture: string; capacity: n; life: [n, n]; size: [n, n]; rate: n; colors: [string, string, string];
  blend: "add" | "standard"; emitter: { kind: "cone" | "sphere" | "cylinder" | "box"; [k: string]: unknown }; gravity?: n; sheet?: { cols: n; rows: n; fps: n } }
export class Vfx implements WorldSystem { constructor(w: WorldBase, presets: Record<string, ParticlePreset>);
  preload(names: string[]): Promise<void>; spawn(name: string, at: V3 | (() => V3), o?: { scale?: n; seconds?: n; scope?: Scope }): { stop(): void };
  light(at: () => V3, color: [n, n, n], intensity: n, priority: n): { stop(): void }; update(dt: n): void; dispose(): void }
```

### 2.17 M3 `anim` and `creatures` (M1)

```ts
export interface RigProfile {
  asset: string; scale: n; forward: "+z" | "-z"; pivot?: [n, n, n];
  clips: Record<string, { clip: string; offset?: [n, n, n]; loop?: boolean }>;   // logical → asset clip + root re-centre
  bones: Record<string, string>;                                                // jaw, head, neck0..n, mouth …
  sockets?: Record<string, { bone: string; position?: [n, n, n]; rotation?: [n, n, n] }>;
  procedural?: Record<string, { bones: readonly string[]; axis: [n, n, n]; max: n }>;
  ragdoll?: RagdollProfile; hurtboxes?: readonly { bone: string; to?: string; radius: n; zone?: "head" | "body" | "limb" }[];
  locomotion?: { kind: "ground" | "flying" | "hybrid"; speeds: Record<string, n>; bank?: n }; nav?: { radius: n; height: n };
}
export class AnimController {    // one fade manager per layer, game-time blends, cancels the in-flight fade; shared by Character and Creature
  constructor(scene: Scene, groups: ReadonlyMap<string, AnimationGroup>, clock: () => n);
  play(clip: string, o?: PlayOptions & { layer?: string }): { done: Promise<void>; stop(blend?: n): void };
  length(clip: string): n; has(clip: string): boolean; readonly current: string | null; stopAll(): void; dispose(): void }
export class ProceduralLayer { constructor(scene: Scene); set(bone: TransformNode, fn: (base: Quaternion, out: Quaternion) => void): Disposer; dispose(): void }  // restore-before-animate
export class SplineMover { constructor(node: TransformNode, bus: UpdateBus);
  move(points: V3[], speed: n, o?: { bank?: n; signal?: AbortSignal }): Promise<{ completed: boolean }>; stop(): void }      // arc-length Catmull-Rom
export class Creature implements Animatable, Speaker, RagdollBody {
  static create(world: WorldBase, p: RigProfile, signal?: AbortSignal): Promise<Creature>;
  readonly root: TransformNode; readonly meshes: AbstractMesh[]; readonly anim: AnimController; readonly procedural: Record<string, n>;
  play(name: string, o?: PlayOptions): unknown; bone(logicalOrName: string): TransformNode | undefined; socket(name: string): TransformNode;
  fly(points: V3[], speed: n, o?: { clip?: string; signal?: AbortSignal }): Promise<{ completed: boolean }>;
  setYaw(yaw: n, pitch?: n, roll?: n): void; lookAt(p: V3 | null): void; stopAnimations(): void; dispose(): void;
}
```

### 2.18 M3 `combat` (M2)

```ts
// hit.ts: pure math, unit-tested
export interface Seg { a: V3; b: V3 }
export function segSegClosest(p0: V3, p1: V3, q0: V3, q1: V3, out?: { s: n; t: n; d2: n }): { s: n; t: n; d2: n };
export function sweptCapsuleHit(prev: Seg, cur: Seg, r: n, target: Seg, tr: n, samples: n): { hit: boolean; u: n; point: V3 } ;  // u ∈ [0,1] along the sweep
// vitals.ts
export interface Vital { value: n; max: n; regen: n; regenDelay: n }
export class Vitals { constructor(o: { health: n; stamina: n; staminaRegen?: n; poise?: n });
  health: Vital; stamina: Vital; poise: Vital; readonly dead: boolean; spend(stat: "stamina", amount: n): boolean;
  apply(h: Hit): { damage: n; staggered: boolean; killed: boolean }; update(dt: n): void; readonly onDeath: Emitter<Hit> }
// weapons.ts
export interface AttackDef { id: string; clip: string; stamina: n; damage: n; windup: n; active: [n, n]; recovery: n; knockback?: n; poiseDamage?: n; combo?: { next: string; window: [n, n] } }
export interface WeaponDef { id: string; asset: string; node?: string; socket: string; grip?: { position: [n, n, n]; rotation: [n, n, n] };
  blade: { from: [n, n, n]; to: [n, n, n]; radius: n }; attacks: readonly AttackDef[];
  block?: { clip: string; angleDeg: n; staminaPerHit: n }; sounds?: { swing?: string; hit?: Record<string, string> } }
export function attachToSocket(mesh: TransformNode, socket: TransformNode, grip?: WeaponDef["grip"]): Disposer;   // generalises the axe-on-hand code in execution.ts
// hurtboxes.ts: one source with the ragdoll
export interface Hurtbox { owner: Combatant; a: TransformNode; b?: TransformNode; radius: n; zone: "head" | "body" | "limb" }
export function hurtboxesFrom(profile: RagdollProfile | RigProfile["hurtboxes"], body: RagdollBody, owner: Combatant): Hurtbox[];
export interface Combatant { id: string; team: string; vitals: Vitals; hurtboxes: Hurtbox[]; root: TransformNode; body: Animatable;
  blocking?(): boolean; onHit?(h: Hit): void }
export interface Hit { attacker: Combatant; target: Combatant; attack: AttackDef; point: V3; dir: V3; zone: string; blocked: boolean; damage: n }
export interface AttackHandle { readonly done: Promise<"hit" | "miss" | "interrupted">; cancel(): void }
export class CombatSystem implements WorldSystem {
  constructor(o: { world: WorldBase; physics: Physics; hostile: Record<string, readonly string[]>; occlusionLayer?: string /* "STATIC" */ });
  add(c: Combatant): Disposer; equip(c: Combatant, w: WeaponDef, socket: TransformNode, mesh?: TransformNode): WeaponInstance;
  attack(c: Combatant, w: WeaponInstance, attackId: string): AttackHandle | null;   // null: no stamina / dead / staggered / busy
  block(c: Combatant, on: boolean): void; readonly onHit: Emitter<Hit>; readonly onDeath: Emitter<Combatant>;
  update(dt: n): void /* game-time timers, stamina regen */; dispose(): void;
}
export class MeleeController { constructor(player: PlayerController, combat: CombatSystem, self: Combatant, weapon: WeaponInstance,
  controls: { attack(): boolean; heavy(): boolean; block(): boolean }); update(dt: n): void }   // drives LocomotionAnimator.override
```

**Timing contract.** This resolves the clash between animation running at render rate and physics running at a fixed step.
1. `scene.onAfterAnimationsObservable` samples each active weapon's blade segment in world space into a two-entry pose ring `{prev, cur}`, stamped with game time.
2. `physics.onPostStep(dt, stepTime)` runs for every attack whose active window `[windup + active0, windup + active1]` overlaps the step's game-time span. It interpolates blade poses between `prev` and `cur` for that span. Latency is at most one render frame, about 16-33 ms.
3. It sweeps against all hostile hurtbox capsules: a sphere-distance broadphase, then `sweptCapsuleHit` with `samples = ceil(angularTravel / 0.15 rad)`.
4. Each target is hit at most once per swing.
5. An occlusion check casts `rayCast` from the attacker's chest to the hit point on STATIC.
6. Damage, stagger and impulse are applied within the same step.
7. Death switches the target to `Ragdoll` with the hit impulse, or to a death clip when the profile has no ragdoll.

Scripts await `script.wait(handle.done)`.

### 2.19 M3 `nav` and `ai` (M3, M4)

```ts
// nav/navAsset.ts: binary header written by tools/engine/gen/navmesh.mjs
export interface NavAssetHeader { magic: "NFNAV"; version: 1; recast: string /* exact pinned version */; agent: { radius: n; height: n; maxClimb: n; maxSlopeDeg: n };
  bounds: [n, n, n, n, n, n]; tiled: boolean; zone?: string }
export class NavVersionMismatch extends Error {}
// nav/recast.ts: lazy, like loadJolt
export function loadRecast(): Promise<typeof import("@recast-navigation/core")>;
// nav/NavWorld.ts: NO runtime bake on the main thread
export interface NavAgentParams { radius: n; height: n; maxSpeed: n; maxAcceleration: n; separation?: n }
export interface NavAgent { readonly id: n; position(out: V3): V3; velocity(out: V3): V3; moveTo(p: V3): boolean; stop(): void; teleport(p: V3): void;
  readonly arrived: boolean; suspended: boolean; remove(): void }
export class NavWorld implements WorldSystem {
  static fromAsset(buf: ArrayBuffer, o?: { maxAgents?: n }): Promise<NavWorld>;    // throws NavVersionMismatch (surfaced at boot validation)
  addTiles(buf: ArrayBuffer, zone: string): void; removeTiles(zone: string): void;   // interiors and caves
  findPath(from: V3, to: V3): V3[] | null; closest(p: V3, out?: V3): V3 | null; randomAround(p: V3, r: n): V3 | null;
  raycast(from: V3, to: V3): { hit: boolean; t: n }; addAgent(at: V3, p: NavAgentParams): NavAgent;
  addObstacle(c: V3, r: n, h: n): Disposer; debugMesh(scene: Scene, on: boolean): void; update(dt: n): void; dispose(): void }
// ai/
export interface Perception { canSee(eye: V3, target: V3, forward: V3, maxDist: n, fovDeg: n): boolean;   // STATIC ray occlusion
  readonly noise: Emitter<{ at: V3; loudness: n; source: string }> }
export function createPerception(ph: Physics, o?: { layer?: string }): Perception;
export interface BrainState<C> { enter?(c: C): void; update(c: C, dt: n): string | null; exit?(c: C): void }
export class Brain<C> { constructor(states: Record<string, BrainState<C>>, initial: string, ctx: C);
  readonly state: string; update(dt: n): void; go(s: string): void; suspend(scope: Scope): void /* cinematic override */; dispose(): void }
export class AISystem implements WorldSystem { add(b: Brain<any>, o?: { hz?: n /* default 10 */ }): Disposer; maxBrainsPerFrame: n; update(dt: n): void }   // time-sliced
export class AgentMover { constructor(agent: NavAgent, body: Character | Creature, clips: LocomotionClips, ground: Ground); update(dt: n): void }
// states.ts: reusable FSM states, shipped only once both the template and the flagship use them
export const states: { idle(): BrainState<AiCtx>; patrol(points: V3[]): BrainState<AiCtx>; chase(o: { giveUp: n }): BrainState<AiCtx>;
  melee(o: { range: n; pick?(c: AiCtx): string }): BrainState<AiCtx>; follow(o: { leader: () => V3; offset: [n, n] }): BrainState<AiCtx>; stagger(): BrainState<AiCtx>; dead(): BrainState<AiCtx> };
export interface AiCtx { self: Combatant | null; body: Character | Creature; agent: NavAgent; perception: Perception; target(): Combatant | null; combat: CombatSystem | null; blackboard: Record<string, Json> }
```

Enemies use the states idle, patrol, chase, attack, stagger and dead. A companion uses follow, assist and wait. `ActorRegistry.script(id, scope)` calls `brain.suspend(scope)` and sets `agent.suspended = true` until the scope ends.

### 2.20 M3 `quest` (E2)

```ts
export interface Volume { contains(p: { x: n; y: n; z: n }): boolean }
export const Trigger: { sphere(c: V3, r: n): Volume; box(c: V3, half: V3, yaw?: n): Volume; column(x: n, z: n, r: n, y0?: n, y1?: n): Volume };
export interface ObjectiveDef { id: string; text: string; announce?: "toast" | "tracker" | "both" /* flagship "both": tests read #toast */;
  prompt?: string | ((usingPad: boolean) => string); done(): boolean; waypoint?(): V3 | null;
  failsafe?: { after: n /* game seconds */; resolve(): void /* teleport or force-complete */ } }
export class Objectives { constructor(o: { hud: Hud; usingPad(): boolean });
  run(d: ObjectiveDef, script: ScriptApi): Promise<"met" | "failsafe">; readonly active: ObjectiveDef | null; clear(): void }
export class QuestLog implements Saveable { readonly key: "quests"; readonly version: 1;
  set(quest: string, stage: string, data?: Record<string, Json>): void; stage(quest: string): string | null; readonly onChange: Emitter<string>;
  save(): Json; load(d: Json, v: n): void }
```

### 2.21 M3 `world/zones` for interiors and caves (M5)

```ts
export interface ZoneDef { id: string; groups: readonly string[]; mode: "sameScene" | "ownScene"; root?: string /* asset id */;
  colliders?: string; nav?: string; atmosphere?: string; audio?: { bed?: string; music?: string };
  portals: { id: string; at: [n, n, n]; radius: n; to: { zone: string; portal: string } }[] }
export class ZoneManager implements WorldSystem {
  constructor(o: { world: WorldBase; nav: NavWorld | null; physics: Physics });
  define(z: ZoneDef): void; readonly current: string;
  enter(id: string, o: { via?: string; scope: Scope; fade?: n }): Promise<void>;
  // sameScene: stream groups → fade → enable root, toggle casters (env.removeShadowCaster for the inactive zone),
  //            add/remove the zone's static bodies, nav.addTiles/removeTiles, env.blendTo(atmosphere), beds/music
  // ownScene:  separate Scene + Physics; WorldBase.scene swaps; for caves far from the town (M5b, only when profiling demands it)
}
```

---

## 3. Game-content plug-in contract

### 3.1 The definition

Data, a few lazy factories and a codec. There are no registration side effects.

```ts
// src/northern/definition.ts: imports light modules only (check-entry enforces this)
import type { GameDefinition } from "@engine/app/definition";
export const northern: GameDefinition<PrologueSave> = {
  id: "northern", version: "M2",
  dom: { canvas: "scene", ui: "ui", menu: "menu", backdrop: "smoke" },
  storage: { settingsKey: "northern.settings.v1", savesDb: "northern-saves", assetsDb: "northern-assets" },   // FROZEN
  settings: { defaults: DEFAULTS },
  input: { actions: ACTIONS, defaultKeys: DEFAULT_KEYS, pad: PAD, mouseRadPerPx: 0.0022, reserved: ["F5", "Tab"], pause: "menu", quicksave: "quicksave" },
  audio: { buses: ["music", "sfx", "voice", "ambience"], volumes: (s) => ({ music: s.music, sfx: s.sfx, ambience: s.sfx, voice: s.voice }) },
  assets: { manifestUrl: "./manifest.json", order: SEGMENTS, menuGroup: "menu", gltfExtensions: () => import("../generated/gltf-extensions").then((m) => m.extensions) },
  strings: zhCN, ui: { settings: settingsSchema, credits: () => import("./ui/credits").then((m) => m.credits()) },
  saves: prologueCodec, menu: { music: "audio/music_menu" },
  stages: {
    menu: async (ctx) => new (await import("./menu/MenuStage")).MenuStage(ctx).init(),
    createGame: async (ctx) => new (await import("./PrologueStage")).PrologueStage(ctx).init(),
    startGroup: (p) => groupsOf(p.chapter)[0],
  },
  marks: { started: "cart-started", preloaded: "cart-preloaded" },
  sw: { url: "./sw.js" },
};
// src/northern/main.ts
import { boot } from "@engine/app/boot"; import { northern } from "./definition"; boot(northern);
```

### 3.2 Registration means passing arrays and tables

- **Story:** `src/northern/story.ts` exports `CHAPTERS: ChapterDef<NorthernCtx>[]`. `?debug&roam` returns a *different* array with `{ id: "roam", groups: ["muster"] }`; the module-level array is no longer mutated.
- **Cast:** `northern/actors/cast.ts` holds `CAST: Record<string, CharacterSpec>`, the single place for outfits and hair. Today they are copied in `cart.ts:62-77`, `muster.ts:51-58` and `execution.ts:56-85`.
- **Rigs, weapons and effects:** `RigProfile` (dragon), `WeaponDef`, `ParticlePreset`, `AtmosphereDef`, `PhysicsConfig` (adds `RUBBLE`), `PlayerProfile`, `LocomotionClips`, `CameraProfile` and clip aliases are passed straight into engine constructors.
- **World state:** `northern/flags.ts` holds `FLAGS` (typed via `GameTypes.flags`). `northern/world/ambient.ts` holds `AMBIENT: AmbientSystem[]` (house fires, rampage, meteors, archers). `Saveable`s are registered on `WorldState`.
- **Layout:** `src/generated/layout.json` is the only source of positions for both runtime and generators. `northern/world/layout.ts` re-exports it with types.

### 3.3 Chapter authoring

```ts
// src/northern/chapters/dragon.ts (C4 shape, abridged)
export const dragonChapter = defineChapter<NorthernCtx, { houses: number[] }>({
  id: "dragon", label: "巨龙袭城", groups: ["dragon"], seamless: true,
  checkpoints: ["platform", "tower", "breach", "street"],
  needs: (c, signal) => c.town.ensure(signal),
  make: (c) => new DragonRun(c),     // class with establish(at, entry, state) / run(from) / save() / dispose()
});
// establish("breach", entry) sets ALL state for that point: flags town.breach = town.burning = dragon.rampage = true,
// cast placement via c.cast, player teleport + canMove, music state, mood; ambient systems start from flags.
// run(from) is plain async: `if (from === "platform") { …; await c.checkpoint("tower"); } if (from <= "tower") …` (use index helpers)
```

Rules:
- `establish` is the **only** way into a chapter. New game, load, skip (`"end"`) and debug jump all go through it.
- `run` is plain async code on `c.script`.
- Background loops use `c.script.spawn`.
- Persistent effects are flags plus ambient systems, never chapter-owned objects.
- Chapters never import other chapters; shared positions live in `layout.json`.

### 3.4 Overrides (all explicit)

- The game's own `Stage` and `GameStage`.
- `NorthernWorld extends WorldBase`, the only sanctioned subclass point.
- `Stage.pauseItems()`.
- `SettingRow { kind: "custom" }`.
- Game `Screen`s (the creator).
- `App.onReset` for game UI that must die on a stage change (the end card).
- Profiles for every tunable.

There is no monkey-patching, module aliasing or global hook.

### 3.5 Theming

- **Tokens:** the game sets `--ink --ink-dim --ink-faint --glow --line --line-strong --band --display --serif --sans` in its own inline `<style>`.
- **Structure:** `kit-base.css` and `kit.css` are inlined at the marker positions.
- **Decoration:** fonts, `#menu`, `.title .seal`, `#version`, `#keyhints`, `#smoke` and the end-card art stay in the game's HTML and CSS.
- **Strings:** `EngineStrings` (`zh-CN` for northern, `en` for the template).

### 3.6 Content-code rules (enforced by script or review)

- No `location.search`; use `debug` and `northern/debugAliases.ts`.
- No `document.*` outside `Screen` implementations and `PrologueStage` compat.
- No module-level mutable state; use `WorldState` or chapter state.
- No `setTimeout` in gameplay; use `script.after`.
- Every long-lived handle is added to a `Scope`.

### 3.7 Recipe table (docs front page)

| You want to add… | You write | Engine/pipeline does |
|---|---|---|
| An NPC | one `CAST` entry | spawn via `world.npc()`/`actors.spawn`, shadows, look-at |
| A chapter | `defineChapter` + an entry in `story.ts` + checkpoints | sequencing, skip, checkpoint autosave, debug jump (`?chapter=&checkpoint=`), load |
| A persistent world effect | a flag in `FLAGS` + an `AmbientSystem` | starts and stops on flag changes, re-derived on load, survives chapter boundaries |
| An objective | an `ObjectiveDef` with `failsafe` | HUD toast/tracker, prompt by input device, no soft-lock |
| A creature | `RigProfile` + a pipeline `creatureImport` config | AnimController, procedural layers, SplineMover, hurtboxes, nav agent |
| A weapon | `WeaponDef` + a GLB node | socket attach, swept hits, stamina, sounds |
| An enemy | cast/creature + `Combatant` + `Brain` states + `NavAgent` | perception, chase/attack, death ragdoll, cinematic override |
| An interior or cave | a pipeline generator + `ZoneDef` + portals | streaming gate, atmosphere blend, colliders, nav tiles |
| A UI string | a field in `strings.zh-CN.ts` | font subset coverage check (P5) |
| A setting | a `SettingRow` in `settingsSchema.ts` | panel row, persistence, per-key apply |

---

## 4. Asset pipeline configuration model

### 4.1 Engine vs game

| Engine `tools/engine/**` | Game `tools/northern/**`, `demos/template/tools/**` |
|---|---|
| `pipeline/build.mjs`: `createBuild`, extracted verbatim from `build-assets.mjs:28-70,351-388` | `build-assets.mjs`: the `step` bodies, `PH` table, `TERRAIN_LAYERS`, `STREAMED`, groups, positions |
| `lib/{gltf,ktx,ktx-thread,hdr}.mjs` moved unchanged; `lib/audio.mjs` = `encode()` from `gen/audio.mjs` with cache key `v: 2` unchanged | `AUDIO` table, `buildAudio()` |
| `gen/shapes.mjs`, `gen/noise.mjs` (valueNoise/fbm/ridged/smoothstep/rng from `gen/world.mjs`), `gen/heightfield.mjs` (writer for the 16-byte-header format `HeightField.parse` reads), `gen/scatterpack.mjs` (`packScatter`), `gen/terrainChunks.mjs` (chunker + skirts, parameterised by `height`/`detail`) | `gen/world.mjs` (route, TOWN/GATE), terrain params, scatter rules, `fir` (SRC becomes a parameter), `cart`, `houses`, `townbuildings`, `characters` (Quaternius regexes, `KEEP_CLIPS`), `dragon` |
| `gen/layout.mjs`: `emitLayout(obj)` → `src/generated/layout.json` (+ `.d.ts`) | `tools/northern/layout.mjs`: `CART`, `SEATS`, `TOWER`, `INN`, `KEEP`, `GATE`, `LAYOUT`, `HOUSES`, `WAIT` as one object, imported by generators **and** emitted |
| `pipeline/gltf-extensions.mjs`: scans emitted GLBs → `manifest.gltfExtensions` + `src/generated/gltf-extensions.ts` | none |
| `pipeline/upgrade-manifest.mjs`: v1 → v2 without rebuilding (no `assets-src` needed) | none |
| `gen/colliders.mjs`, `gen/navmesh.mjs` (M3; `@recast-navigation/generators` in Node, pinned exact), `gen/sdf.mjs` + `gen/marchingCubes.mjs` (M5) | which nodes are solid, agent params, per-group/zone bake config; `keep_interior.mjs`, `cave.mjs` |
| `fetch/polyhaven.mjs`, `fetch/http.mjs` (download + sha256 + unzip, preflight for ffmpeg/unzip) | `sources.mjs`, `fetch-extra.mjs` URL tables (pinned revisions over time), `credits-extra.mjs` |
| `fonts.mjs` (Google Fonts `text=` subsetter, writes `glyphs.txt`) | `fetch-fonts.mjs` config: family, weights, text sources |
| `serve.mjs` (`--root` required; hashed rule adds `data/<sha16>`) | `tools/serve.mjs` frozen shim |
| `paths.mjs` (`ROOT`, `CACHE = <repo>/.cache`) fixes `ktx.mjs:9` and `audio.mjs:11` | none |
| `vite/*`, `test/*` | the `vite.*.config.ts` call sites and the `tests/*.mjs` scenarios |

### 4.2 `createBuild`

```js
// tools/engine/pipeline/build.mjs (JSDoc-typed)
export function createBuild({
  root, outDir /* public/data */, manifestPath, generatedDir /* src/generated */, cacheDir /* <repo>/.cache */,
  groups /* ordered ids */, only /* --only prefix */, naming = "data/{hash16}.{ext}",
  budgets /* { startPack?: Record<group, brotliBytes>, maxAsset?: brotliBytes } → build failure */,
  credits /* { out, extra, provenance: true } */,
}) → {
  emit(id, { group /* alias: segment */, priority = 50, type, ext, data, pos, variants, optional, loop }) → Promise<Entry>,
  step(prefix, fn) → Promise<void>,          // --only reuse of previous entries via .cache/build-index.json (fallback: id prefix)
  source(relPath) → absPath,                 // records provenance (credits come from what the build actually read)
  layout(obj) → void,                        // merged into generated/layout.json
  finish() → Promise<Summary>,               // optional flags, #aac fold, sort (localeCompare), version = sha(id+hash pairs),
                                             // groups table, gltfExtensions + codegen, build-index (_step/_br moved out of the manifest),
                                             // orphan deletion ONLY if the previous manifest parsed + validated, budgets, credits
}
```

### 4.3 Manifest schema v2 (written from S27; runtime parses v1 and v2)

```json
{ "schema": 2, "version": "<12 hex, unchanged formula>",
  "groups": [{"id":"menu","order":0},{"id":"cart","order":1}, …],
  "gltfExtensions": ["EXT_meshopt_compression","KHR_mesh_quantization","KHR_texture_basisu","KHR_materials_specular"],
  "assets": [{ "id","url","hash","size","type","group","segment","priority","pos?","optional?","loop?","variants?" }] }
```

The `generated` timestamp is dropped. `_step` and `_br` move to `.cache/build-index.json`. Version hashes stay unchanged; the manifest bytes change once, and so does the SW VERSION, once.

### 4.4 Vite plugins (`tools/engine/vite/`)

```ts
export function defineGameConfig(o: { root?: string; outDir?: string; publicDir?: string; sw: SwOptions | false;
  report?: string /* .cache/build-report[.template].json */; kitCss?: boolean /* default true */ }): UserConfig;
// = today's build options (base "./", assetsDir "app", assetsInlineLimit 0, modulePreload.polyfill false, worker.format es) + @engine alias
//   + reportPlugin + inlineKitCss + swPlugin
export interface SwOptions {
  template?: string;                     // tools/engine/vite/sw.template.js
  cachePrefix: string;                   // flagship "shell-" (frozen); template "template-shell-"
  legacyPrefixes?: string[];             // also deleted on activate
  dataPattern?: string;                  // "/data/[0-9a-f]{16}\\.\\w+$"
  manifest?: string;                     // "manifest.json"
  extraDirs?: string[];                  // ["decoders"]
  hashContents?: string[];               // ["decoders"]: VERSION = sha256(shell list + manifest bytes + these files' contents)
  skipWaiting?: boolean;                 // flagship true (today); template false → posts {type:"update-available"}
  deferred?: string[];                   // P2: globs precached after the start pack, not at install
}
```

### 4.5 Node types for M3

| Node | Engine module | Output | Contract |
|---|---|---|---|
| `colliders` | `gen/colliders.mjs` | `col/<zone>` (bin trimesh) | taken from tagged nodes (`COL_*`) or simplified render meshes; the runtime stops rebuilding colliders from render meshes |
| `navmesh` | `gen/navmesh.mjs` | `nav/<zone>` (type `nav`, `NFNAV` header) | input = **only** collider outputs + heightfield samples within `layout.json` bounds; recast version pinned exact in `package.json` and written to `src/generated/versions.json`; off-mesh links from layout anchors |
| `interior` / `cave` | `gen/sdf.mjs`, `gen/marchingCubes.mjs` + game generators | render GLB + `col/*` + `nav/*` + `zones.json` (bounds, atmosphere, bed, groups, portals) | uses the same `layout.json` |
| `rigPack` check | `pipeline/verify.mjs assertClips(glb, required[])` | none | build fails if a clip from `LocomotionClips`, a `RigProfile.clips` entry or a chapter clip list is missing (`characters.mjs` currently falls back silently) |
| budgets | `finish()` | none | start pack per group (cart ≤ 9 MB br; template arena ≤ 2 MB) |

---

## 5. File-by-file move and split table

Kinds: **MOVE** (engine, unchanged or with constants turned into parameters), **SPLIT**, **CONTENT** (stays game-side and moves once into `northern/`), **SHIM** (frozen path, with a reason), **NEW**. The step column refers to §6.

### 5.1 `src/` runtime

| Today | Destination | Kind | Step | Notes (coupling cut) |
|---|---|---|---|---|
| `src/main.ts` | `engine/ui/menu.ts` (lines 21-85 menu nav, one pad loop) · `northern/saveCodec.ts` (`toPrologueSave`, M1 legacy, `?chapter`) · `engine/app/boot.ts` (89-150, 164-271) · `northern/{main,definition}.ts`; `src/main.ts` = one line | SPLIT | S10, S9, S13 | 9 `URLSearchParams` sites in S2; Chinese strings → `strings.zh-CN.ts` |
| `src/sw.template.js` | `tools/engine/vite/sw.template.js` (parameterised) | MOVE | S14 | prefix, data pattern, manifest path, skipWaiting |
| `src/vite-env.d.ts` | unchanged | — | — | |
| `src/generated/credits.json` | unchanged (pipeline output) | — | — | `layout.json` (S28), `gltf-extensions.ts` (P1), `versions.json` (M3) added |
| `src/assets/fonts/*.woff2` | unchanged + `glyphs.txt` | — | S0b | path referenced by index.html |
| `src/core/settings.ts` | `engine/platform/settings.ts` + `engine/core/types.ts` · `northern/config/{settings,actions}.ts` · `northern/strings.zh-CN.ts` (`ACTION_LABELS`, key names) · `northern/types.ts` (augmentation) | SPLIT | S4 | Action union and storage key inside the generic store |
| `src/core/input.ts` | `engine/platform/input.ts`; `PAD` → `northern/config/actions.ts` | SPLIT | S5 | PAD, Tab/F5 preventDefault, look constants, `keyHook` |
| `src/core/audio.ts` | `engine/platform/audio.ts`; bus mapping → `northern/config/audio.ts` | SPLIT | S8 | fixed buses, ambience follows sfx, global `musicTracks` |
| `src/core/saves.ts` | `engine/platform/saves.ts` | MOVE | S9 | DB name, `SegmentId` import |
| `src/core/assets/idb.ts` | `engine/platform/idb.ts` | MOVE | S3 | |
| `src/core/assets/AssetClient.ts` | `engine/assets/AssetClient.ts` | MOVE | S6 | singleton spawn at import (`:23,:155`), concurrency 6 (`:79`) |
| `src/core/assets/asset.worker.ts` | `engine/assets/asset.worker.ts` + `engine/assets/schedule.ts` | MOVE | S6 | `:11, 24-26, 49, 61-62` constants and order → init config |
| `src/core/assets/manifest.ts` | `engine/assets/manifest.ts`; `SEGMENTS`/`SegmentId` → `northern/config/segments.ts` | SPLIT | S6 | `manifest.ts:2` story order |
| `src/core/assets/protocol.ts` | `engine/assets/protocol.ts` | MOVE | S6 | `segment: string`, `init.config` |
| `src/game/Game.ts` | `engine/app/{App,StageManager,PauseController,Stage,loop,PauseMenu,debugOverlay}.ts` | SPLIT | S1 (frame try/catch), S12 | Chinese labels, duck typing (`:141`, `:168-171`), `modal`, raw pad 9/1, `SegmentId` |
| `src/game/engine.ts` | `engine/app/render.ts` | MOVE | S7 | decoder base via runtime; `?webgl` via `debug` |
| `src/game/loaders.ts` | `engine/assets/{loaders,gltfUtils}.ts` | MOVE | S7 (P1 for ext registration) | glTF options as parameters; `registerBuiltInGLTFExtensions` replaced in P1 |
| `src/scenes/MenuStage.ts` | `northern/menu/MenuStage.ts`; engine gets `app/stages/BlankStage.ts` (NEW) | CONTENT | S13, S15 | `menu/smoke` tuning is content |
| `src/physics/Physics.ts` | `engine/physics/Physics.ts` + `northern/config/physics.ts` | SPLIT | S18 | fixed layers, matrix and capacities |
| `src/physics/ragdoll.ts` | `engine/physics/ragdoll.ts` + `engine/actors/presets/ueMannequin.ts` | SPLIT | S18 | `import { stopWalk } from "../prologue/actors"` → `body.stopMotion?.()` |
| `src/prologue/Director.ts` | `engine/script/{Director,dialogue}.ts` | MOVE | S1 | `hud` and `Character` imports, 0.19 s/char constant, global cancel flag |
| `src/prologue/PrologueStage.ts` | `northern/PrologueStage.ts` (move in S16); `play/skipChapter/canSkip/prepareChapter` → `engine/story/Sequencer.ts`; `appendWorldGeometry` + grouping → `engine/physics/colliders.ts` (S18); end card → `northern/ui/endcard.ts`; `CHAPTERS` → `northern/story.ts` | SPLIT | S16, S18 | `:34-41` registry and `?roam` splice, `:251` setSegment(ch.id), `:261-262`, `:276-298`, duplicated physics ownership |
| `src/prologue/World.ts` | `engine/world/{WorldBase,heightfield,scatter}.ts`; `meshesUnder` → `engine/world/meshes.ts` (S3); content → `northern/world/NorthernWorld.ts` | SPLIT | S22 | `World.ts:1` Dragon import, ids at `:72-106`, LOD tables, `ensureFemale`/`ensureDragon` → `ensure()` |
| `src/prologue/actors.ts` | `engine/actors/{motion,yaw}.ts` | MOVE | S19 | clip names via aliases; cancellable walks |
| `src/prologue/camera.ts` | `engine/camera/CameraRig.ts` + `northern/config/camera.ts` | SPLIT | S20 | settings/input singletons, window wheel listener |
| `src/prologue/player.ts` | `engine/character/{CharacterMotor,InputLatch,LocomotionAnimator,PlayerController}.ts` + `northern/config/player.ts` | SPLIT | S21 | input singleton, action names, constants |
| `src/prologue/playerBody.ts` | `northern/actors/playerBody.ts` | CONTENT | S24 | |
| `src/prologue/wagon.ts` | `northern/actors/wagon.ts` (`WHEEL_R` from `layout.json` in S28) | CONTENT | S24 | no engine `SplineVehicle` until a second use |
| `src/prologue/dragon.ts` | `northern/actors/dragon.ts` → `RigProfile` in `northern/actors/rigs.ts` + behaviour over `@engine/creatures/Creature` | CONTENT→SPLIT | S24, M1 | `fly()` resolving on interrupt → `{completed:false}` |
| `src/prologue/fx/fire.ts` | `northern/fx/fire.ts`; patterns → `engine/fx/vfx.ts` | CONTENT→SPLIT | S24, M2 | `setTimeout` → `script.after`; texture refcount |
| `src/prologue/fx/arrow.ts` | `engine/fx/projectile.ts` + `northern/fx/arrow.ts` | SPLIT | S24 | module-level `shared` template |
| `src/prologue/chapters/types.ts` | `engine/story/legacy.ts` (LegacyChapter) + `northern/chapters/context.ts` | SPLIT | S16 | `ChapterContext.stage` concrete; `id: SegmentId` |
| `src/prologue/chapters/cart.ts` | `northern/chapters/cart.ts` | CONTENT | S16 (move), C1 (v2) | hold-to-skip → `holdToSkip` |
| `src/prologue/chapters/cartScript.ts` | `northern/chapters/cartScript.ts` | CONTENT | S16 | `lineDuration` → `strings.readingTime` (C1) |
| `src/prologue/chapters/muster.ts` | `northern/chapters/muster.ts` | CONTENT | S16, C2 | `WAIT` → `layout.json`; `game.modal` → screen session |
| `src/prologue/chapters/execution.ts` | `northern/chapters/execution.ts` | CONTENT | S16, C3 | `import { WAIT } from "./muster"` removed; `?from` read removed (S17) |
| `src/prologue/chapters/dragon.ts` | `northern/chapters/dragon.ts` + `northern/world/ambient.ts` + `northern/flags.ts` | CONTENT | S16, C4 | loops → ambient systems; `?from` read removed (S17) |
| `src/prologue/chapters/roam.ts` | `northern/chapters/roam.ts` (`{id:"roam", groups:["muster"]}`) | CONTENT | S16 | fake `"muster"` id |
| `src/ui/hud.ts` | `engine/ui/hud.ts` | MOVE | S10 | default text `加载中` → strings |
| `src/ui/widgets.ts` | `engine/ui/widgets.ts` | MOVE | S10 | hard-coded W/S/Enter/E |
| `src/ui/panels.ts` | `engine/ui/panels.ts` + `northern/ui/{settingsSchema,credits}.ts` | SPLIT | S11 | Chinese strings, Poly Haven credits, hard-coded sections and kind labels |
| `src/ui/creator.ts` | `northern/ui/creator.ts` (implements `Screen`, has `close()`) | CONTENT | S11 | orphaned creator, modal flag, no cancel |
| `src/world/appearance.ts` | `northern/actors/appearance.ts` | CONTENT | S24 | engine AppearanceSystem only with a second consumer |
| `src/world/characters.ts` | `engine/actors/{Character,CharacterFactory,ActorRegistry}.ts` + `northern/actors/cast.ts` (`Part`, `OUTFITS`, `CAST`, aliases, `PART_RE`) | SPLIT | S19 | game data in the factory |
| `src/world/environment.ts` | `engine/render/environment.ts` + `northern/world/atmosphere.ts` | SPLIT | S23 | `FOG_COLOR`, sky ids, burning mood |
| `src/world/instancing.ts` | `engine/world/instancing.ts` | MOVE | S3 | |
| `src/world/materials.ts` | `engine/render/materials.ts`; `LAYERS` → `northern/world/terrain.ts` | SPLIT | S23 | fixed five layer names |
| `src/world/route.ts` | `engine/world/route.ts` | MOVE | S3 | |
| `src/world/town.ts` | `northern/world/town.ts` + `northern/world/layout.ts` | CONTENT | S24, S28 | `GATE`, `LAYOUT`, `HOUSES`, tower dims duplicated with tools |

### 5.2 Root, config, public

| Today | Destination | Kind | Step | Notes |
|---|---|---|---|---|
| `index.html` | stays; kit CSS → `src/engine/ui/kit-base.css`, `kit.css`, with two markers at the original positions | SPLIT | S10 | no `<link>`; DOM-only pixel diff ≤ 0.5% |
| `vite.config.ts` | alias + report (S0a) → `defineGameConfig` (S14) | SPLIT | S0a, S14 | plugin → `tools/engine/vite/swPlugin.ts` |
| — | `vite.template.config.ts` | NEW | S15 | |
| `tsconfig.json` | `tsconfig.base.json` + flagship `tsconfig.json` (S0a) + `demos/template/tsconfig.json` (S15) | SPLIT | S0a, S15 | |
| `package.json` | scripts (S0a, S15, S26); recast pinned exact (M3) | edit | — | |
| `package-lock.json` | regenerated only in M3 | — | M3 | |
| `README.md` | commands updated; links to `docs/engine` | edit | S26 | |
| `.gitignore` | add `dist-template`, `tests/results` | edit | S15 | |
| `shared/` (empty) | deleted | delete | S28 | replaced by `src/generated/layout.json` |
| `public/manifest.json` | upgraded to schema 2 by `upgrade-manifest.mjs` | edit | S27 | hashes unchanged |
| `public/data/*` | unchanged | — | — | |
| `public/decoders/*` | unchanged; content-hashed into SW VERSION | — | S14 | |

### 5.3 `tools/`

| Today | Destination | Kind | Step | Notes |
|---|---|---|---|---|
| `tools/build-assets.mjs` | `tools/engine/pipeline/build.mjs` + `tools/northern/build-assets.mjs` | SPLIT | S25 | identity check: `--only=menu/` |
| `tools/lib/{gltf,hdr,ktx,ktx-thread}.mjs` | `tools/engine/lib/` | MOVE | S25 | `ktx.mjs:9` cache via `paths.mjs` |
| `tools/gen/shapes.mjs` | `tools/engine/gen/shapes.mjs` | MOVE | S25 | |
| `tools/gen/world.mjs` | `tools/engine/gen/noise.mjs` + `tools/northern/gen/world.mjs` | SPLIT | S26 | |
| `tools/gen/terrain.mjs` | `tools/engine/gen/terrainChunks.mjs` + `tools/northern/gen/terrain.mjs` | SPLIT | S26 | the template needs the chunker |
| `tools/gen/scatter.mjs` | `tools/engine/gen/scatterpack.mjs` + `tools/northern/gen/scatter.mjs` | SPLIT | S26 | |
| `tools/gen/audio.mjs` | `tools/engine/lib/audio.mjs` + `tools/northern/gen/audio.mjs` | SPLIT | S26 | `audio.mjs:11` cache; key `v: 2` unchanged |
| `tools/gen/{fir,cart,houses,townbuildings,characters,dragon}.mjs` | `tools/northern/gen/` | CONTENT | S26 | `fir.mjs:10` SRC → param; constants → `tools/northern/layout.mjs` (S28) |
| `tools/fetch-sources.mjs` | `tools/engine/fetch/polyhaven.mjs` + `tools/northern/fetch-sources.mjs` | SPLIT | S26 | |
| `tools/fetch-extra.mjs` | `tools/engine/fetch/http.mjs` + `tools/northern/fetch-extra.mjs` | SPLIT | S26 | |
| `tools/fetch-fonts.mjs` | `--print-glyphs` (S0b); `tools/engine/fonts.mjs` + `tools/northern/fetch-fonts.mjs` (S26); string tables (P5) | SPLIT | S0b, S26, P5 | |
| `tools/{sources,credits-extra,preview-terrain}.mjs` | `tools/northern/` | CONTENT | S26 | |
| `tools/serve.mjs` | `tools/engine/serve.mjs`; `tools/serve.mjs` stays as a **frozen shim** (`--root <repo>/dist`) | MOVE+SHIM | S26 | e2e spawns this path; default root is module-relative |

### 5.4 `tests/`

| Today | Change | Step |
|---|---|---|
| `tests/e2e.mjs` | unchanged (frozen); compared by `tests/gate/compare-e2e.mjs` | — |
| `tests/chain.mjs`, `tests/jump.mjs` | assertions added (exit 1 on pageerror, timeout, wrong chapter; jump: `step === 3`), via `tools/engine/test/harness.mjs` | S0b |
| `tests/muster.mjs` | `[data-sex=f]` → `[data-sex-step="1"]` | S0b |
| `tests/{chapter,dragon,ui,smoke,probe}.mjs` | unchanged; wrapped by `gate.mjs` (pageerror and selector assertions) | S0b |
| NEW | `tests/gate.mjs`, `tests/gate/{boot,ui-dom,compare-e2e}.mjs` | S0b |
| NEW | `tests/gate/legacy-saves.mjs` | S9 |
| NEW | `tests/template.mjs`, `tests/checkpoints.mjs`, `tests/unit/**` | S15, S17, S0a+ |

---

## 6. Migration plan

### 6.1 Gates

All gates start with **G0**. Browser gates start `tools/serve.mjs --port 4173` themselves if nothing is listening.

| Gate | Command | Checks | Approx. time |
|---|---|---|---|
| **G0** | `npm run check && npm run test:unit` | typecheck of every tsconfig program, vite build of every config, check-boundaries, check-entry, check-glyphs, unit tests | 1-2 min |
| **G1** | G0 + `node tests/gate.mjs --level 1` | `gate/boot.mjs`: `?webgl&debug`, `menu-3d-ready`, click 新游戏, `cart-started`, no pageerror. `gate/ui-dom.mjs`: menu, settings, credits, pause and load screens with `#scene,#smoke{visibility:hidden}` and transitions/animations disabled, pixel diff against `tests/baseline/ui-dom/*.png` (changed pixels ≤ 0.5% at channel delta > 16). `tests/template.mjs` from S15 | ~5 min |
| **G2** | G0 + `--level 2` | G1 + `chain.mjs` (asserting) + `jump.mjs` (asserting step 3) + `ui.mjs` (all selectors found, no pageerror) + `gate/legacy-saves.mjs` (from S9) | ~30 min |
| **G3** | G0 + `--level 3` | G2 + `e2e.mjs` via compare-e2e + `CH=muster`, `CH=execution`, `CH=dragon node tests/chapter.mjs` (end reached, no pageerror) + `dragon.mjs` + `checkpoints.mjs` (from S17) | ~75 min |

**Baseline policy**
- **e2e PASS set:** the set must equal `tests/baseline/e2e.json`. A known FAIL ("ride starts ≤ 10 s", 19.6 s at baseline) may stay FAIL, but its value must be ≤ baseline × 1.25. If it exceeds that, rerun once and use the median of the two runs. Any other new FAIL fails the gate.
- **Retries:** timeouts are retried once; assertion failures and page errors are not.
- **Baseline changes:** baseline files change only in a step that says so. The commit message records before and after values.

**Working rules for every step**
- Use one branch and one PR per step.
- Where possible, make a **move-only commit** (`git mv` plus import rewrites, reviewed with `git diff -M --color-moved`), then a **logic commit**.
- Update `docs/engine/migration-log.md` with the step id, files moved, any new shim or deprecation, and the ratchet counts.
- Never edit `tests/e2e.mjs`.
- Never rename a §1.4 identity.
- No M3 code (combat, AI, keep/exit chapters) before its prerequisites in §6.3.

### 6.2 Steps

Each step has its goal, the work, how to verify it, and when it is done.

**S0a: static guard rails and unit runner. No runtime change.**
- *Do:*
  - `tsconfig.base.json` + `tsconfig.json` (include `["src"]`).
  - In `vite.config.ts`: the `@engine` alias and an inline `reportPlugin` that writes `.cache/build-report.json`.
  - `tools/engine/{check-boundaries.mjs, boundary-allow.json, check-entry.mjs, check-entry.config.json}`, with today's entry and first-screen numbers recorded.
  - `tools/engine/test/unit.mjs` + `tests/unit/sanity.test.ts`.
  - Scripts `typecheck`, `check`, `test:unit`.
- *Verify:*
  - `npm run check && npm run test:unit`.
  - Negative test: temporarily add `import "@babylonjs/core/scene";` to `src/main.ts`. `node tools/engine/check-entry.mjs` must exit 1. Revert.
- *Done when:* the report shows the entry closure at 27.6 + 2.6 KB and the budgets are committed.

**S0b: harness, asserting tests and baselines.**
- *Do:*
  - `tools/engine/test/{harness,pixeldiff}.mjs` (Chromium from `PW_CHROMIUM`, default `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; shots in `SHOTS_DIR`; sharp-based diff).
  - Assertions added to `chain.mjs` and `jump.mjs`; the `muster.mjs` selector fixed.
  - `tests/gate.mjs` + `tests/gate/{boot,ui-dom,compare-e2e}.mjs`.
  - `tools/fetch-fonts.mjs --print-glyphs` (offline) writes `src/assets/fonts/glyphs.txt`; add `tools/engine/check-glyphs.mjs`.
  - Run G3 twice and commit `tests/baseline/*`.
- *Verify:* `node tests/gate.mjs --level 3` exits 0. Then temporarily add `throw new Error()` in `MusterChapter.run`; `node tests/chain.mjs` must exit 1. Revert.
- *Done when:* baselines are committed and the README "Testing" section points to `gate.mjs`.

**S1: scoped cancellation (the ghost-script fix).**
- *Do:*
  - Add `engine/core/{scope,emitter}.ts`.
  - `git mv src/prologue/Director.ts src/engine/script/Director.ts` and add `dialogue.ts`. `Director` takes `{ dialogue: hud, readingTime }`; content passes `t => Math.max(2.4, t.length * 0.19 + 0.8)` from `src/prologue/readingTime.ts`, which moves to `strings.zh-CN.ts` in S10.
  - Add `Director.scoped(scope)`.
  - `PrologueStage` creates a child `Scope` per chapter (in `prepareChapter` and the `play` loop) and gives `make` a context copy with `director: director.scoped(scope)`. It calls `scope.cancel()` on skip **and** on completion, before `dispose()`.
  - Delete `cancelAll()/reset()` at `:261-262`; `reset()` becomes a no-op added to the deprecation ratchet.
  - Add `unhandledrejection` → `isCancelled` → `preventDefault` in `main.ts`.
  - Wrap the `Game.frame` body in try/catch.
- *Verify:* G2. Add a chain assertion: within 8 s after each skip, `#subtitle` text is never a line from the previous chapter. The previous chapter's lines are gathered from the subtitle log before the skip.
- *Done when:* `director.reset` no longer appears in content.

**S2: one debug-flags module.**
- *Do:* add `engine/core/debug.ts`; replace all **9** `URLSearchParams` sites.
- *Verify:* G1 + `node tests/jump.mjs` (`?from=breach`) + `CH=dragon node tests/chapter.mjs`.
- *Done when:* check-boundaries rule 4 is active with zero exceptions.

**S3: leaf moves (zero logic).**
- *Do:* move `world/route.ts` and `world/instancing.ts` → `engine/world/`, `core/assets/idb.ts` → `engine/platform/idb.ts`, and extract `World.meshesUnder` → `engine/world/meshes.ts`.
- *Verify:* G1.

**S4: settings and GameTypes.**
- *Do:*
  - Add `engine/core/types.ts`, `engine/platform/settings.ts` (configure, per-key `on`, memory fallback, dev assert).
  - Add `northern/config/{settings,actions}.ts`, `northern/strings.zh-CN.ts`, `northern/types.ts` (augmentation).
  - `main.ts` calls `settings.configure({ storageKey: "northern.settings.v1", defaults })` first.
  - `Game` listens with `on(fn, ["quality", "renderScale"])`.
- *Verify:* G1. ui-dom adds a scenario: change FOV, reload, check the value persisted under `localStorage["northern.settings.v1"]`.
- *Done when:* the repo has no `as SettingsStore<` cast.

**S5: input contexts.**
- *Do:*
  - `engine/platform/input.ts` with `pushContext` and `captureNextKey`; panels rebinding uses `captureNextKey`.
  - Move `PAD` and the look constants into config; preventDefault follows the bindings.
  - `Game.modal` also pushes a `"modal"` context.
- *Verify:* G2. ui-dom adds a scenario: rebind jump to `KeyJ`, check the label, reset.

**S6: assets core.**
- *Do:*
  - Move AssetClient, worker, protocol and manifest to `engine/assets/`; extract `schedule.ts`.
  - `SEGMENTS` → `northern/config/segments.ts`.
  - The worker `init` carries `config`; the worker is spawned lazily via `runtime().assetWorker()` with a send queue. Create `engine/runtime/{index,vite}.ts`.
  - `parseManifest` handles v1 and v2; `variants` becomes a Record; `saves` uses `segment: string`.
- *Verify:* `tests/unit/schedule.test.ts` (rank order identical to today's for a fixture of 73 entries), `tests/unit/manifest.test.ts`, then G3 (e2e covers cache, SW second visit and offline play).
- *Done when:* the same `northern-assets` DB is used, so a second visit downloads about 0 bytes.

**S7: loaders and render.**
- *Do:* `game/loaders.ts` → `engine/assets/{loaders,gltfUtils}.ts` (option defaults equal today's); `game/engine.ts` → `engine/app/render.ts` (decoder base from runtime).
- *Verify:* G3. Decoder URLs are on the offline path.

**S8: audio.**
- *Do:* `AudioConfig`, the `music` sub-API (with `musicTracks`/`setMusicState` as deprecated aliases in the ratchet), `AudioScope`, and `SoundHandle` returned synchronously.
- *Verify:* G2. A unit test checks that a handle stopped before decode never plays (mocked `AudioContext`).

**S9: saves and codec.**
- *Do:*
  - `engine/platform/saves.ts` (`SaveStore`), `northern/saveCodec.ts` (`toPrologueSave` + M1/M2); writes add `schema: 1` and `gameVersion`.
  - Add `tests/gate/legacy-saves.mjs`. It injects into `northern-saves.saves`:
    - an M1 record `{id:"auto", state:{s:900, line:3, time:80}}`;
    - an M2 record `{id:"quick", state:{chapter:"dragon", state:{step:2}, appearance}}`.
    For each it clicks 继续 and asserts `stage.chapter.id` and `step`.
- *Verify:* G2 (includes legacy-saves).

**S10: UI kit, part 1.**
- *Do:*
  - `engine/ui/{strings,hud,widgets,menu}.ts`, and the main-menu controller extracted from `main.ts`.
  - `kit-base.css` and `kit.css` moved verbatim behind markers, plus the `inlineKitCss` plugin (registered inline in `vite.config.ts` until S14).
  - `strings.zh-CN.ts` holds every engine string, `readingTime` and `keyLabel`.
  - `check-glyphs` sources = `glyphs.txt` ∪ `strings.zh-CN.ts`.
- *Verify:* G1 with pixel diff. `grep -c "<link" dist/index.html` gives the same count as the baseline (2: icon and preload). `check-entry` passes.

**S11: UI kit, part 2.**
- *Do:*
  - `engine/ui/screens.ts` (`ScreenStack`, one Back route) and schema-driven `engine/ui/panels.ts`.
  - `northern/ui/{settingsSchema,credits}.ts`.
  - The creator becomes a `Screen` with `close()`; `Game.modal` becomes a getter/setter shim over `screens.has("creator")` (ratchet).
  - Remove the second B handler in `main.ts`.
- *Verify:* G2 (`ui.mjs` covers settings, credits, creator, pause and load) + ui-dom.

**S12: App, StageManager and PauseController.**
- *Do:*
  - `src/game/Game.ts` → `engine/app/{App,StageManager,PauseController,Stage,loop,PauseMenu,debugOverlay}.ts`.
  - Add `Stage.begin?`/`pauseItems?`; `PrologueStage.pauseItems()` returns the 跳过本章 item.
  - `onReset` handles HUD, screens, pause DOM, music reset, beds and input context.
  - `main.ts` keeps importing `App` **dynamically**.
- *Verify:* G3. Manual check: Esc, Tab, visibility change and pointer-lock loss with the creator open; pressing New then Load quickly → latest wins and nothing is orphaned.
- *Done when:* `src/game/` is deleted.

**S13: boot and the definition.**
- *Do:*
  - `engine/app/{definition,boot}.ts` with the intent queue; `northern/{main,definition}.ts`; `src/main.ts` is one line.
  - `MenuStage` → `northern/menu/MenuStage.ts`.
  - SW registration via `runtime().production`.
  - `__game`/`__assetsProgress` exposed by boot.
- *Verify:* G3. `check-entry` shows the entry closure ≤ 40 KB with no Babylon module ids.

**S14: Vite config factory and SW plugin.**
- *Do:*
  - `tools/engine/vite/{defineGameConfig,swPlugin,reportPlugin,inlineKitCss}.ts`.
  - `src/sw.template.js` → `tools/engine/vite/sw.template.js` with injected `cachePrefix`, `legacyPrefixes`, `dataPattern`, `manifest`, `skipWaiting`.
  - `hashContents: ["decoders"]`.
- *Verify:* G3. `diff <(sed 's/VERSION = .*//' dist/sw.js) <(sed 's/VERSION = .*//' baseline-sw.js)` shows only template comments.

**S15: template v0 and per-game tsconfig.**
- *Do:*
  - `demos/template/**` (§7 v0), `engine/app/stages/BlankStage.ts`, `vite.template.config.ts`, `demos/template/tsconfig.json`, `tests/template.mjs`.
  - Typecheck runs both programs. Add `dist-template` to `.gitignore`.
- *Verify:* G1, which now includes `npm run build:template` and `node tests/template.mjs`. check-boundaries passes (no import from northern). check-entry runs on the template report.
- *Done when:* any hidden coupling found here is fixed in the engine, with no template workaround.

**S16: story engine.**
- *Do:*
  - `engine/story/{Chapter,legacy,Sequencer,holdToSkip}.ts`.
  - `git mv` `PrologueStage` and the chapters into `src/northern/`; `chapters/types.ts` splits into `legacy.ts` + `northern/chapters/context.ts`.
  - `northern/story.ts` declares the chapters with `legacyChapter`:
    - cart `checkpoints ["ride"]`, `groups ["cart"]`;
    - muster `["rollcall","creator","follow"]`;
    - execution `["sentence","block"]`;
    - dragon `["platform","tower","breach","street"]`;
    - roam `{id:"roam", groups:["muster"], checkpoints:["free"]}`.
  - The Sequencer replaces `play/skipChapter/prepareChapter`. `stage.chapter` returns `{id, step, checkpoint}`. Saves add a `checkpoint` field.
  - End card → `northern/ui/endcard.ts`, removed on `onReset`.
- *Verify:* G3.

**S17: checkpoint jump and the jump test loop.**
- *Do:*
  - Add `?debug&chapter=<id>&checkpoint=<name>` through `Sequencer.prepare(at, "debug")`.
  - `northern/debugAliases.ts` maps `from=block` → `execution@block` and `from=tower|breach|street` → `dragon@<name>`.
  - Remove the `location.search` reads in `execution.ts` and `dragon.ts`.
  - `tests/checkpoints.mjs` iterates chapter × checkpoint. For each it asserts within 60 s: no pageerror, `stage.chapter.checkpoint === name`, a player when on foot, and finite camera numbers. It writes `tests/baseline/checkpoints.json`; known failures there are tracked as bug-track #10 tickets.
- *Verify:* G3 (now includes `checkpoints.mjs` in compare mode) + `node tests/jump.mjs`.

**S18: physics.**
- *Do:*
  - `engine/physics/{Physics,colliders,ragdoll}.ts` with `PhysicsConfig`, where `DEFAULT_PHYSICS` is today's matrix.
  - `northern/config/physics.ts` adds `RUBBLE` (same matrix as RAGDOLL, so behaviour does not change); `breakBreach` uses it.
  - `actors/presets/ueMannequin.ts`; ragdoll call sites pass a body with `stopMotion`.
- *Verify:* G3 (muster ragdoll, dragon breach debris, jump).

**S19: actors.**
- *Do:*
  - `engine/actors/{motion,yaw,Character,CharacterFactory,ActorRegistry}.ts`; `northern/actors/cast.ts` (`CAST`).
  - `World.npc(name)` falls back to `CAST`.
  - `walkPath(signal)` resolves `{completed}`; `stand` cancels walks.
  - Chapters pass `signal: ctx.scope.signal` at their walk call sites.
- *Verify:* G3 + `tests/unit/yaw.test.ts`.

**S20: camera.**
- *Do:* `engine/camera/CameraRig.ts` (look source, fov function, profile, scope; `glide` with `{completed}` and a signal; `dispose` removes the wheel and settings listeners) + `northern/config/camera.ts`.
- *Verify:* G3 (cart seat camera, muster close-up, dragon glides).

**S21: player.**
- *Do:* `engine/character/{CharacterMotor,InputLatch,LocomotionAnimator,PlayerController}.ts`; jump latched at render rate; `northern/config/player.ts`.
- *Verify:* G3. `jump.mjs` landing coordinates within 0.05 m of the baseline log.

**S22: WorldBase.**
- *Do:*
  - `engine/world/{WorldBase,heightfield,scatter}.ts`.
  - `northern/world/NorthernWorld.ts` holds the asset ids, scatter table, LOD tiers and `setupTrees`.
  - `ensureFemale`/`ensureDragon` → `ensure()`; `attachPhysics` ends the double ownership.
- *Verify:* G3. `__stats` draw calls and triangles at the cart start are within ±5% of the baseline (gate/boot records `__stats`).

**S23: environment and materials.**
- *Do:* `engine/render/{environment,materials}.ts` with `AtmosphereDef` and presets (`setMood` kept as compat); `northern/world/{atmosphere,terrain}.ts`.
- *Verify:* G2 + ui-dom unchanged + chapter screenshots: dragon mood by eye, plus mean-luminance diff ≤ 3% against the baseline smoke shots.

**S24: content regroup and cleanup.**
- *Do:*
  - Move `wagon`, `dragon`, `fire`, `arrow`, `town`, `appearance` and `playerBody` into `northern/` (§5.1). Add `engine/fx/projectile.ts` (per-scene template).
  - Delete the empty `src/{core,game,world,prologue,scenes,physics,ui}`.
  - `boundary-allow.json.exceptions = []`.
- *Verify:* G3.

**S25: tools, part 1.**
- *Do:* `tools/engine/paths.mjs`; move `lib/*` and `gen/shapes.mjs` to `tools/engine/`; extract `createBuild` into `tools/engine/pipeline/build.mjs`; create `tools/northern/build-assets.mjs`; `tools/build-assets.mjs` becomes a one-line shim (removed in S26).
- *Verify:*
  - `node -e 'for (const f of [...]) await import(f)'` import smoke test over `tools/engine/**`.
  - `node tools/northern/build-assets.mjs --only=menu/ && node tools/engine/pipeline/verify.mjs --against-git HEAD`: the `assets` array is byte-identical; only `generated` may differ.
  - `ls .cache/ktx | wc -l` unchanged (cache hit).
  - Then G0.

**S26: tools, part 2.**
- *Do:*
  - Split the generators, fetchers and fonts (§5.3); `tools/engine/serve.mjs` plus the frozen `tools/serve.mjs` shim.
  - Update `package.json` scripts and the README.
- *Verify:* the S25 identity check again, `node tools/serve.mjs --port 4199` serves `dist/`, then G1 + `node tests/e2e.mjs` compare (it spawns the shim).

**S27: manifest v2.**
- *Do:* `tools/engine/pipeline/upgrade-manifest.mjs` (adds `schema`, `groups`, `gltfExtensions`, `group`; drops `generated`; moves `_step`/`_br` into `.cache/build-index.json`); `finish()` writes v2 natively.
- *Verify:*
  - `node tools/engine/pipeline/upgrade-manifest.mjs && node tools/engine/pipeline/verify.mjs` (all 73 hashes unchanged, no orphans).
  - Unit test: v1 and v2 parse to the same `ResolvedEntry[]`.
  - Then G3.

**S28: `layout.json` as the single source.**
- *Do:*
  - `tools/northern/layout.mjs` is imported by the generators and emitted to `src/generated/layout.json`.
  - `wagon.ts` `WHEEL_R`, `town.ts` `GATE`/`LAYOUT`/`HOUSES`/tower dims and muster `WAIT` read from it. Delete `shared/`.
- *Verify:* first `node tools/engine/pipeline/verify.mjs --layout`, which compares every runtime constant before and after (exact). Then G3.

**S29: template v1.**
- *Do:* §7 v1 (own pipeline assets, world, physics, player, camera, objectives, WorldState saves). Needs E1 and E2; run them first if they are not done.
- *Verify:* `npm run template:assets && npm run build:template && node tests/template.mjs` + G0.

**E1: WorldState and save schema 2.**
- *Do:*
  - `engine/state/{WorldState,ambient}.ts`; `northern/flags.ts`.
  - Payload `{ story: StoryPosition, appearance, world: WorldSnapshot }`; codec migrates schema 1 → 2.
  - `gate/legacy-saves.mjs` adds a schema-1 M2 record and a schema-2 record.
- *Verify:* unit tests (snapshot round trip; unknown parts kept) + G2.

**E2: objectives, triggers and quest log.**
- *Do:* `engine/quest/{triggers,Objectives,QuestLog}.ts`; `hud.objective`; failsafes.
- *Verify:* unit tests (a failsafe fires after N game seconds with a fake clock) + G0.

**C1: cart to v2.**
- *Do:* `defineChapter`, `establish("ride", entry, {s,line,time})` and `establish("end")`, `holdToSkip`, `lineDuration` → `strings.readingTime`.
- *Verify:* G3 (e2e offline ride, chain hold-Space skip) + `checkpoints.mjs`.

**C2: muster to v2.**
- *Do:* `establish` per checkpoint rebuilds Rowan's fate, ragdoll absence, creator-done appearance and `canMove`. The creator becomes a screen session inside the chapter scope. `WAIT` comes from `layout.json`. This fixes the muster resume bug.
- *Verify:* G3; `checkpoints.mjs` shows all three muster checkpoints passing (baseline updated with the reason).

**C3: execution to v2.**
- *Do:* `["sentence","block"]`; the axe attachment uses a content helper; `establish("end")` puts the dragon on the tower.
- *Verify:* G3.

**C4: dragon to v2 with ambient systems.**
- *Do:*
  - Flags `town.burning`, `town.breach`, `town.housesBurning: number[]`, `dragon.rampage`, `dragon.alive`.
  - `northern/world/ambient.ts` holds `houseFires`, `rampage`, `meteors` and `archers` under the **story** scope. FireFx is owned by `NorthernWorld`, not the chapter.
  - `inTower`/`inInn` become `Objectives` with failsafes (toasts 进入塔楼 and 跳进旅店 unchanged).
- *Verify:* G3 + `jump.mjs` + `checkpoints.mjs`. A new assertion in `checkpoints.mjs`: after the dragon chapter's `establish("end")`, fires are still active (`__game.stage.world.ambientActive("houseFires") === true`).

**C5: remove deprecations.**
- *Do:* delete `legacy.ts`, the `PrologueStage` compat fields (except the test-contract getters), the audio aliases, `App.modal` and `Director.reset`. `boundary-allow.json.deprecations = {}`.
- *Verify:* G3.

**M1: animation and creatures.**
- *Do:* `engine/anim/*`, `engine/creatures/*`. `Character.play` delegates to `AnimController`. The dragon becomes a `RigProfile` in `northern/actors/rigs.ts` with roar and breath behaviour in `northern/actors/dragon.ts`; `fly` resolves `{completed}`.
- *Verify:* G3 (`dragon.mjs`, chain) + unit test for SplineMover arc length.

**M2: combat (template first).**
- *Do:*
  - `engine/combat/*`; `engine/fx/vfx.ts` (sparks and blood are the second consumer of the FireFx patterns).
  - Template v2a: a training dummy (`Vitals` + capsule hurtboxes), a stick weapon on a socket, and `MeleeController`.
- *Verify:* unit tests for `segSegClosest` and `sweptCapsuleHit` (tunnelling at 3 rad/frame is caught; one hit per swing). `tests/template.mjs` asserts the dummy's health drops after a scripted attack. Then G0.

**M3: colliders, navmesh and NavWorld.**
- *Do:*
  - Add `@recast-navigation/core` and `@recast-navigation/generators` at the **same exact version**; generate `src/generated/versions.json`.
  - `tools/engine/gen/{colliders,navmesh}.mjs`; `engine/nav/*` with `recastWasmUrl` in runtime bindings.
  - Template `nav/arena`, then flagship `col/town` and `nav/town`.
- *Verify:* a unit test that rejects a header version mismatch; an agreement test (sample 200 navmesh points; each has a collider below it within 0.5 m). Template test: `findPath` from spawn to beacon is not null. Then G0 + G1.

**M4: AI.**
- *Do:* `engine/ai/*`; `ActorRegistry.script` override. Template v2b: the dummy chases and attacks, and a companion follows.
- *Verify:* the template test asserts the dummy's distance to the player decreases over 3 s and that `script()` freezes it. Unit tests for Brain transitions. Then G1.

**M5: zones, interiors and caves.**
- *Do:* `engine/world/zones.ts` (sameScene first), `env.blendTo`, pipeline `sdf`/`marchingCubes` + `tools/northern/gen/{keep_interior,cave}.mjs` → `zones.json`.
- *Verify:* template "hut" zone enter and exit (atmosphere preset changed, nav tiles swapped, no pageerror). Shadow-caster counts are restored on exit.

**M6: a second non-human creature (e.g. a wolf).**
- *Do:* `RigProfile` + `Brain` + `NavAgent`, which proves the `Creature` abstraction beyond the dragon; the clip-contract check covers it.
- *Verify:* template or flagship debug spawn test.

**K1 and K2: keep and exit chapters**, written directly as v2 chapters on combat, AI, zones and objectives.
- *Verify:* G3 with chain extended to `keep` and `exit`; `checkpoints.mjs` covers the new checkpoints.

**P track (performance; interleave once its prerequisite is done)**
- **P1 (after S7): explicit glTF extensions.** Generate `src/generated/gltf-extensions.ts` from `public/data` GLBs and replace `registerBuiltInGLTFExtensions`. *Verify:* `ls dist/app | grep -ci flowgraph` → 0 and the chunk count drops by about 104. G3, since offline play-through loads every chapter's GLBs.
- **P2 (after S14): deferred SW registration and precache split.** Register on `requestIdleCallback` after `menu-3d-ready`; `deferred` globs (story chunks, jolt and recast wasm) are cached after the start pack or on first use. *Verify:* G3; e2e "second visit served by SW" and offline play-through pass. Record first-screen bytes.
- **P3 (after S15): tree-shake proof.** The template report must contain no `engine/(combat|nav|ai|creatures)` modules until template v2. This is a check-entry forbid list.
- **P4 (after M2): lazy segment code.** `ChapterDef.requires` (`"combat" | "nav" | "ai"`) becomes a dynamic `import()` in `needs`. When a group starts streaming, modulepreload its chunks. *Verify:* check-entry first-screen closure has no combat, nav or ai.
- **P5 (after C5): font subset from string tables.** `tools/northern/fetch-fonts.mjs` reads the display sections of `strings.zh-CN.ts` and `index.html`; check-glyphs fails on any missing glyph.
- **P6 (after S19): per-frame allocations.** Fix `Character.postAnimate` (about 10 temporaries per NPC per frame) and add an allocation counter to the debug overlay.
- **P7 (optional, after K2): generated id types.** `src/generated/ids.d.ts` (asset ids, clip names) through `GameTypes.assetId`, plus boot-time validation of referenced ids in `?debug`.

### 6.3 Ordering and critical path

```
S0a → S0b → S1 → S2 → S3 → S4 → S5 → S6 → S7 → S8 → S9 → S10 → S11 → S12 → S13 → S14 → S15
                                         │                                              │
                                         └─ P1                                          ├─ P2, P3
S15 → S16 → S17 → S18 → S19 → S20 → S21 → S22 → S23 → S24 ──┐
S14 ─────── (tools, parallel) S25 → S26 → S27 → S28 ────────┤
                                                            ├→ E1 → E2 → S29 (template v1)
                                                            └→ C1 → C2 → C3 → C4 → C5
S29 + S28 + C4 → M1 → M2 → M3 → M4 → M5 → M6 → K1 → K2     (P4 after M2, P5 after C5, P6 after S19)
```

- **Critical path for M3 (task #13):** S0a … S24 → E1 → E2 → S28 → S29 → M1 → M2 → M3 → M4 → C4 → K1.
- **Parallel work:** S25-S28 run alongside S16-S24 because they touch different files. The C-track runs alongside M1-M2.
- **Prohibited:** combat, AI, keep or exit code before S24 + E2.

---

## 7. Template demo (`demos/template`, "Proving Ground")

```
demos/template/
  index.html          #scene #ui #menu nav[data-act=new|continue|load|settings]; inline tokens (system-ui fonts, different palette);
                      <!-- @engine:kit-base.css --> <!-- @engine:kit.css --> markers (inlined by the plugin; no path outside the Vite root)
  public/manifest.json + public/data/*   v0: {schema:2, groups:[menu,arena], assets:[]}; v1+: generated by tools/build-assets.mjs, committed, < 300 KB
  src/main.ts         import { boot } from "@engine/app/boot"; import { template } from "./definition"; boot(template);
  src/types.ts        declare module "@engine/core/types" { interface GameTypes { settings: TemplateSettings; action: TemplateAction; save: ArenaSave; flags: TemplateFlags } }
  src/definition.ts   storage { settingsKey: "template.settings.v1", savesDb: "template-saves", assetsDb: "template-assets" };
                      actions [forward, back, left, right, jump, sprint, attack, block, interact, menu, quicksave]; strings: en; marks.started: "game-started"
  src/strings.en.ts   EngineStrings (readingTime: words / 3.2 + 1)
  src/ArenaStage.ts   GameStage<ArenaSave> (< 250 lines)
  src/story.ts        v1+: one v2 chapter "beacon" { checkpoints: ["start", "lit"] }
  tools/build-assets.mjs  createBuild({ outDir: "demos/template/public/data", groups: ["menu","arena"], budgets: { startPack: { arena: 2e6 } } })
                          → arena/heightfield (gen/heightfield), arena/ground (terrainChunks), arena/pillars + arena/beacon (shapes), col/arena, nav/arena (M3)
vite.template.config.ts   defineGameConfig({ root: "demos/template", outDir: "../../dist-template", sw: { cachePrefix: "template-shell-", skipWaiting: false } })
tests/template.mjs        harness; serves dist-template on port 0
```

**Versions**
- **v0 (S15):** BlankStage menu backdrop. `ArenaStage` uses `CreateGround` plus a box avatar moved by `input.move()` with a simple follow camera and no physics. It has a saved position, settings, rebinding, a pause item "Respawn", saves and exit to menu.
- **v1 (S29):** its own pipeline assets, `WorldBase` + `HeightField` + `Physics` + `PlayerController` (capsule `Animatable`, no skeleton, `clips: null`), `CameraRig`, `Director`, the `beacon` chapter with an `Objectives` failsafe, `WorldState` + `QuestLog` in saves, `Trigger.sphere`.
- **v2 (M2 to M5):** a training dummy (`Vitals`, `Combatant`, capsule hurtboxes, stick weapon via `attachToSocket`), a `Brain` (idle → chase → melee), a `NavAgent` on a pipeline-baked `nav/arena`, a companion following, and a "hut" zone.

**Acceptance criteria ("reuse proven")**
- Zero imports from `src/northern/**` (check-boundaries).
- Its own tsconfig program compiles the engine with no northern code present.
- Definition < 150 lines; stages < 250 lines.
- check-entry passes on the template report; P3 tree-shake proof until v2.
- `tests/template.mjs` passes this sequence:
  1. boot → `menu-interactive` → `menu-3d-ready`
  2. New → `game-started`
  3. hold W for 2 s → position changed
  4. (v1+) teleport to the beacon → objective complete → quicksave
  5. reload → Continue → position, checkpoint and quest stage restored
  6. settings: rebind jump to `KeyJ` → the label changes
  7. pause menu shows "Respawn" → exit to menu
  8. (v2) the dummy's health decreases after an attack; the dummy's distance to the player decreases.

---

## 8. Placement of upcoming modules

| Module | Engine path | Content path (northern) | Pipeline | Prerequisites | First consumer | Step |
|---|---|---|---|---|---|---|
| World-state save/load | `state/WorldState.ts`, `state/ambient.ts`, `platform/saves.ts` codec schema 2 | `flags.ts`, `world/ambient.ts`, `saveCodec.ts` | none | S9, S16 | legacy-save fixture, then C4 | E1 |
| Objectives and quests | `quest/{triggers,Objectives,QuestLog}.ts`, `hud.objective` | chapter scripts | none | S10, E1 | template v1 beacon | E2 |
| Non-human creatures | `anim/*`, `creatures/{Creature,RigProfile}.ts` | `actors/rigs.ts` (dragon, wolf), `actors/dragon.ts` behaviour | `characters`/`dragon` generators + `assertClips` | S19, S22 | dragon (flagship) | M1, M6 |
| Melee combat | `combat/*`, `fx/vfx.ts` | `config/weapons.ts`, cast `Combatant` setups, hit-reaction clip map (`Hit_Chest`, `Hit_Head`) | weapon GLB nodes, clip contract | S18, S19, S21, M1 | template dummy | M2 |
| Navmesh | `nav/{recast,NavWorld,navAsset}.ts` | `layout.json` bounds and links, per-zone bake config | `colliders.mjs` → `navmesh.mjs` (one geometry source), pinned recast | S28, M2 | template arena | M3 |
| Enemy and companion AI | `ai/*`, `ActorRegistry.script` | brains per enemy type, companion settings | none | M2, M3 | template dummy and companion | M4 |
| Interiors and caves | `world/zones.ts`, `render/environment.ts blendTo` | `ZoneDef`s, atmosphere presets `keep`, `cave` | `sdf.mjs`, `marchingCubes.mjs`, `keep_interior.mjs`, `cave.mjs` → render + col + nav + `zones.json` | M3 | template hut, then the keep | M5 |
| Keep and exit chapters | none | `chapters/{keep,exit}.ts` (v2) | groups `keep`, `exit` (already in `SEGMENTS`) | C4, M2-M5 | flagship | K1, K2 |

Design notes that are binding:
- **Combat timing:** §2.18. Combat never awaits on `ScriptApi`; cinematics wrap `handle.done`.
- **AI and cinematics:** while a chapter scripts an actor, it holds `cast.script(id, c.scope)`. Brains and agents resume automatically when the scope ends.
- **Navmesh:** baked only in the pipeline. A runtime version mismatch throws `NavVersionMismatch`; the dev build shows it in an overlay and the boot validation in `?debug` fails tests. There is no main-thread fallback bake.
- **Interiors:** `sameScene` for the keep, which connects to the town square. `ownScene` only for the exit cave, and only if profiling shows CSM or broadphase cost above 1.5 ms per frame.
- **Persistence:** every M3 system with state implements `Saveable` (QuestLog, persistent actors, Vitals of named actors, breach, fires through flags).

---

## 9. Documentation outline (`docs/engine/`)

1. `README.md`: the recipe table from §3.7 as the front page. What the engine is and is not (no ECS, no DI container, one App per page). Layer diagram and boundary rules. Glossary: stage, group, chapter, checkpoint, scope, screen, zone.
2. `getting-started.md`: copy `demos/template`, rename the storage keys and SW prefix, `npm run template:assets`, `build:template`, `test:template`.
3. `architecture.md`: boot phases and intents, the frame-order contract, StageManager guarantees, PauseController reasons, the scope tree (stage → story → chapter → beat), ownership and dispose rules.
4. `game-definition.md`: every field, with the northern and template definitions side by side.
5. `modules/*.md`, one page each with API, example and pitfalls: `assets settings input audio saves ui script story state quest world render physics actors character camera fx anim creatures combat nav ai zones`.
6. `content-guide.md`: `defineChapter`, checkpoints, `establish` and `"end"`, the motion promise rule, CAST, flags and ambient systems, strings and reading time, theming tokens and the DOM id contract, debug flags and checkpoint jump.
7. `pipeline.md`: `createBuild`, manifest v2, groups and start packs, budgets, `layout.json`, provenance and credits, caches and determinism, gltf-extensions codegen, colliders/navmesh/interior nodes, fonts and glyph checks.
8. `saves-and-state.md`: record envelope, codec migrations (worked M1 → schema 2 example), `Saveable`, `WorldState`, versioning policy, frozen identities.
9. `testing.md`: the `__game` and marks contract, harness, gates G0-G3, baselines and how to change them, the pixel-diff rules, the checkpoint loop, unit runner.
10. `performance.md`: entry and first-screen budgets, check-entry, SW precache policy, glTF extensions, LOD tables, per-frame allocation rules.
11. `conventions.md`: right-handed scene, yaw convention `forward = (-sin, -cos)`, +Z model forward, metres, game time vs wall time.
12. `migration-log.md`: the §5 table with step status, shims and ratchet counts.
13. `adr/`:
    - 001 Same-repo alias, Vite-first engine (`runtime/vite.ts`). Promotion checklist: `git mv src/engine packages/engine/src`, per-directory exports with no root barrel, peers, app-provided `RuntimeBindings`, `tools/engine` → `packages/{pipeline,vite,testkit}`. Trigger: a second repository.
    - 002 Configurable singletons; one App per page; M3 modules take dependencies through constructors.
    - 003 Scopes instead of a global cancel; `{completed}` vs `Cancelled`.
    - 004 Checkpoints and `establish`; chapters stay imperative.
    - 005 Analytic melee on the fixed step.
    - 006 Build-time navmesh only, pinned recast.
    - 007 `GameTypes` augmentation and one tsconfig per game.
    - 008 Frozen persistent identities.
    - 009 Inlined kit CSS; no render-blocking stylesheets.
    - 010 Asset groups decoupled from chapters.

---

## 10. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | Configure-before-read: a module reads `settings.value` or bindings at import time | Dev-build asserts in the getters; boot configures before importing `App`; no reads at module evaluation (review rule) |
| 2 | Entry or first-screen bloat (Babylon reaching the entry closure) | check-entry by module id, a 40 KB entry budget and a first-screen budget of baseline × 1.05; stages imported dynamically; L1 may use only `import type` from Babylon |
| 3 | Player data loss from renamed identities | Values live only in `definition.ts`; legacy-save fixture from S9; SW `legacyPrefixes`; check-boundaries greps that `northern-saves`/`northern-assets`/`northern.settings.v1` appear only in `definition.ts` |
| 4 | Worker URL breaks | Worker factory is in `runtime/vite.ts` with a static relative URL; S6 is gated by G3 (offline e2e) |
| 5 | Babylon side-effect imports dropped by splits | No barrels; side-effect imports stay with their users; G2/G3 after every split; P1 has a GLB-coverage check (manifest `gltfExtensions` ⊆ registered) |
| 6 | Behaviour drift from scope cancellation (S1) | Fires and flight are `onUpdate`-driven; the chain subtitle assertion; the `Cancelled` rejection filter; C4 moves persistent effects to the story scope |
| 7 | e2e already fails; SwiftShader timing noise | Compare PASS sets; known-FAIL value ≤ × 1.25 with a median rerun; DOM-only pixel diffs with the canvas hidden; draw calls and triangles ±5% instead of 3D pixel diffs |
| 8 | CSS cascade change | Verbatim, same-order move to marker positions, inlined (no `<link>`), pixel diff ≤ 0.5% |
| 9 | Alias mismatch between `tsc` and Vite under TS 7 | `paths` in the base config with no `baseUrl`, an explicit `resolve.alias`, and G0 running both tools for both programs |
| 10 | Untyped tool scripts and module-relative caches | `paths.mjs`; import smoke test; `--only=menu/` identity check; audio cache key `v: 2` kept; optional `tools/tsconfig.json` with checkJs |
| 11 | Font glyph gaps or growth | Frozen `glyphs.txt` (S0b); display-only string tables (P5); dialogue uses system `--sans`, so the subset does not grow |
| 12 | Over-generalising | Second-consumer rule; deferred list (devtools, behaviour trees, AppearanceSystem, SplineVehicle, Residency, stock content, policy URLs, packaging) |
| 13 | Recast weight and version skew | Lazy `loadRecast` per `requires`; exact version pin; `NFNAV` header check; agreement test against colliders; no runtime bake |
| 14 | Layout drift between generators and runtime | `layout.json` (S28) is a hard prerequisite for M3; `verify.mjs --layout` |
| 15 | One App per page | ADR-002; the instance-per-App upgrade stays mechanical because every consumer already goes through `configure()`/`reset()`, and M3 modules take dependencies by constructor |
| 16 | Large mechanical diffs hide logic changes | Move-only commit, then logic commit; `git diff -M --color-moved`; at most one subsystem per step |
| 17 | Deprecated shims linger | The `boundary-allow.json` deprecation ratchet: counts can only fall and must reach `{}` in C5 |
| 18 | Interior isolation | Zone `sameScene` toggles casters, bodies and nav tiles; an `ownScene` escape hatch with a profiling threshold |
| 19 | Melee timing nondeterminism | Fixed-step sweeps over interpolated poses; unit-tested math; one hit per swing |