// Boot: the menu (plain DOM in index.html) is usable as soon as this small module runs. The engine,
// the 3D menu background and everything else load lazily behind it.
import { assets } from "./core/assets/AssetClient";
import type { Manifest } from "./core/assets/manifest";
import { audio } from "./core/audio";
import { latestSave, listSaves, writeSave, type SaveGame } from "./core/saves";
import { input } from "./core/input";
import { closePanel, openCredits, openLoad, openSettings, panelOpen, reloading } from "./ui/panels";
import { hud } from "./ui/hud";
import type { Game } from "./game/Game";

const t0 = performance.now();
const canvas = document.getElementById("scene") as HTMLCanvasElement;
const menuEl = document.getElementById("menu")!;
const buttons = [...menuEl.querySelectorAll<HTMLButtonElement>("nav button")];
const mark = (name: string) => performance.mark(name);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW registration failed", e));
}

// ---------------------------------------------------------------- menu navigation
let sel = buttons.findIndex((b) => !b.disabled);
function select(i: number) {
  const enabled = buttons.filter((b) => !b.disabled);
  if (!enabled.length) return;
  const cur = enabled.indexOf(buttons[sel]);
  const next = enabled[(cur + i + enabled.length) % enabled.length];
  sel = buttons.indexOf(next);
  buttons.forEach((b, k) => b.classList.toggle("sel", k === sel));
  next.focus({ preventScroll: true });
}
/** The default choice: the first enabled button (继续 once there is a save). */
function selectFirst() {
  sel = buttons.findIndex((b) => !b.disabled);
  select(0);
}
buttons.forEach((b, k) =>
  b.addEventListener("mouseenter", () => {
    if (b.disabled || k === sel) return;
    sel = k;
    buttons.forEach((x, j) => x.classList.toggle("sel", j === sel));
    audio.uiTick("move");
  }),
);
select(0);

/** Whether the main menu takes input: not under a panel, and not while it fades out for a starting game. */
function menuVisible() {
  return !menuEl.classList.contains("hidden") && !menuEl.classList.contains("fade") && !panelOpen();
}

window.addEventListener("keydown", (e) => {
  audio.unlock();
  // the main menu's panels (in play Game closes the pause menu's in its frame: handling the same Esc
  // here too would close the panel and then resume the game); a pending rebind takes its Esc first
  // through input.keyHook (and its auto-repeat must not close the panel either, if Esc is held)
  if (panelOpen() && e.code === "Escape" && !e.repeat && !menuEl.classList.contains("hidden")) {
    closePanel();
    return;
  }
  if (!menuVisible()) return;
  if (["ArrowUp", "KeyW"].includes(e.code)) {
    select(-1);
    audio.uiTick("move");
  } else if (["ArrowDown", "KeyS"].includes(e.code)) {
    select(1);
    audio.uiTick("move");
  } else if (["Enter", "KeyE", "Space"].includes(e.code)) {
    e.preventDefault();
    buttons[sel].click();
  }
});
window.addEventListener("pointerdown", () => audio.unlock(), { once: false });

// gamepad navigation on the menu (the game loop polls it in-game)
let padPrev: boolean[] = [];
function padLoop() {
  const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected);
  if (pad && menuVisible()) {
    const now = pad.buttons.map((b) => b.pressed);
    const edge = (i: number) => now[i] && !padPrev[i];
    if (edge(12)) select(-1);
    if (edge(13)) select(1);
    if (edge(0)) {
      audio.unlock();
      buttons[sel].click();
    }
    padPrev = now;
  } else if (pad && !menuEl.classList.contains("hidden") && panelOpen() && pad.buttons[1]?.pressed) {
    // B closes the main menu's panels; in play Game owns B (this loop runs first in every frame:
    // closing the pause menu's panel here would make Game's B resume the game)
    closePanel();
  }
  requestAnimationFrame(padLoop);
}
requestAnimationFrame(padLoop);

// ---------------------------------------------------------------- boot
/** public/manifest.json's version when this bundle was built (vite.config.ts `define`). */
declare const __MANIFEST_VERSION__: string;

async function fetchManifest(init: RequestInit): Promise<Manifest> {
  const r = await fetch("./manifest.json", init);
  if (!r.ok) throw new Error(`manifest ${r.status}`);
  return r.json();
}

/**
 * The service worker answers the page and manifest.json separately (network first, cache after a
 * timeout), so right after a deploy one can come from the new release and the other from the old one.
 * Only run against the manifest this bundle was built with.
 */
async function loadManifest(): Promise<Manifest> {
  const m = await fetchManifest({ cache: "no-cache" });
  if (!import.meta.env.PROD || m.version === __MANIFEST_VERSION__) return m;
  console.warn(`[assets] manifest ${m.version} is not from this build (${__MANIFEST_VERSION__})`);
  // a stale cached manifest: the network has ours ("reload" requests skip the service worker's cache)
  const net = await fetchManifest({ cache: "reload", signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (net?.version === __MANIFEST_VERSION__) return net;
  // the server has moved on and this page is the stale part: reload once so everything matches
  if (net && reloadOnce(`manifest-${net.version}`)) return new Promise<never>(() => {});
  // offline, or reloading didn't help: this build's own manifest is precached in its shell cache
  return (await cachedManifest(__MANIFEST_VERSION__)) ?? m;
}

function reloadOnce(key: string) {
  try {
    if (sessionStorage.getItem("northern.reload") === key) return false;
    sessionStorage.setItem("northern.reload", key);
  } catch {
    return false;
  }
  location.reload();
  return true;
}

async function cachedManifest(version: string): Promise<Manifest | null> {
  try {
    for (const k of await caches.keys()) {
      if (!k.startsWith("shell-")) continue;
      const r = await (await caches.open(k)).match("./manifest.json", { ignoreSearch: true });
      const m = r ? ((await r.json()) as Manifest) : null;
      if (m?.version === version) return m;
    }
  } catch {
    // no Cache Storage (insecure context) or an unreadable entry
  }
  return null;
}

const manifestP = loadManifest();
// get(), startPack() and setSegment() need the manifest in the worker first
const assetsReady = manifestP.then((m) => assets.init(m, "menu"));

let gameP: Promise<Game> | null = null;
function getGame() {
  gameP ??= (async () => {
    const { Game } = await import("./game/Game");
    const g = new Game(canvas);
    await g.init();
    mark("engine-ready");
    // Ctrl+W and friends close the tab before the page sees them: ask first while a game is running
    window.addEventListener("beforeunload", (e) => {
      if (reloading || !g.stage?.gameplay) return;
      e.preventDefault();
      e.returnValue = "";
    });
    g.onExitToMenu = () => {
      // the game's music states end with it (a later visit to its chapter sets its state again)
      audio.resetMusicState();
      // back on the menu the cursor starts on 继续 again, not on the 新游戏 the last game came from
      selectFirst();
      void showMenu().catch((e) => {
        console.error(e);
        // the menu scene didn't come up and the game is still there: back to its pause menu (after
        // the end card, the plain menu over it)
        if (g.stage?.gameplay) {
          hud.toast("无法返回主菜单", 4000);
          g.pause(true);
        } else {
          void hud.fade(false, 0.3);
          menuEl.classList.remove("hidden", "fade");
          // the prologue just finished has written autosaves: 继续 and 读取 are enabled now
          void refreshSaves();
        }
      });
    };
    if (new URLSearchParams(location.search).has("debug")) (window as unknown as { __game: Game }).__game = g;
    g.loadSave = (s) => startFromSave(s);
    return g;
  })();
  return gameP;
}

async function showMenu() {
  // 新游戏 works on the DOM menu before the engine is up: once a game is starting it owns the screen
  // (the menu, the asset segment, the music) until its stage is on screen, so every step after an
  // await gives way to it. So does a start since this call, even one already over: a game that came
  // up stays up, and a failed one shows its own menu
  const gen = starts;
  const stale = () => starting || starts !== gen;
  const game = await getGame();
  if (stale()) return;
  assets.setSegment("menu");
  const { MenuStage } = await import("./scenes/MenuStage");
  if (stale()) return;
  // after a failed start the menu scene is usually still up
  if (!(game.stage instanceof MenuStage)) {
    try {
      await game.setStage(async () => {
        const menu = new MenuStage(game.engine);
        try {
          await menu.init();
          // a game started while the scene loaded (and may be on screen by now): not replaced by it
          if (stale()) throw new Error("menu superseded by a game start");
        } catch (e) {
          menu.dispose();
          throw e;
        }
        return menu;
      });
    } catch (e) {
      // that game reports its own failure and brings the menu back then
      if (stale()) return;
      throw e;
    }
  }
  if (stale()) return;
  menuEl.classList.remove("hidden", "fade");
  // back from a game left on a black screen (a chapter change, a skip): nothing clears it on the menu
  void hud.fade(false, 0.3);
  document.getElementById("smoke")!.classList.add("off");
  // a saves DB that hangs (it times out after seconds) doesn't hold up the music and the preload:
  // 继续/读取 are enabled whenever it answers
  await Promise.race([refreshSaves(), new Promise((r) => setTimeout(r, 1500))]);
  if (stale()) return;
  // a start's stopMusic also drops the theme while it loads; before the first click or key it waits
  // on the suspended AudioContext and fades in with it
  void audio.playMusic("audio/music_menu", { fade: 4, volume: 0.8 }).catch(() => {});
  // build the ride behind the menu straight away (downloads overlap with parsing/compiling)
  void preloadPrologue();
}

async function refreshSaves() {
  // without the saves DB (storage blocked, private mode) 继续/读取 stay disabled and 新游戏 still works
  const has = !!(await latestSave().catch((e) => {
    console.warn("saves unavailable", e);
    return undefined;
  }));
  const cont = buttons.find((b) => b.dataset.act === "continue")!;
  // with a save 继续 is the default (Enter on 新游戏 starts over and replaces the autosave), unless
  // the player has already moved the cursor
  const toCont = has && cont.disabled && buttons[sel].dataset.act === "new";
  cont.disabled = !has;
  buttons.find((b) => b.dataset.act === "load")!.disabled = !has;
  if (toCont || buttons[sel].disabled) selectFirst();
}

// ---------------------------------------------------------------- prologue preloading
// The world and the first chapter are built behind the menu (downloads overlap with parsing and
// shader compilation), so "新游戏" only has to fade.
type PrologueStageT = import("./prologue/PrologueStage").PrologueStage;
type PrologueSaveT = import("./prologue/PrologueStage").PrologueSave;
let preload: Promise<PrologueStageT> | null = null;
function preloadPrologue() {
  preload ??= (async () => {
    const game = await getGame();
    await assetsReady;
    const tw = performance.now();
    // request the ride's start pack now (it jumps the queue); init() consumes each asset as it lands
    void Promise.all(assets.startPack("cart").map((id) => assets.get(id))).then(() =>
      console.info(`[timing] start pack ready +${(performance.now() - tw).toFixed(0)} ms`),
    );
    const { PrologueStage } = await import("./prologue/PrologueStage");
    const st = new PrologueStage(game);
    try {
      await st.init();
    } catch (e) {
      // a half-built world still holds its scene, textures and models
      st.dispose();
      throw e;
    }
    mark("cart-preloaded");
    return st;
  })();
  preload.catch(() => (preload = null));
  return preload;
}

/** Saves from M1 stored the ride state directly. */
function toPrologueSave(save: SaveGame | null): PrologueSaveT {
  // debug: start a new game at any chapter (?debug&chapter=muster)
  const q = new URLSearchParams(location.search);
  if (!save && q.has("debug") && q.get("chapter")) return { chapter: q.get("chapter") as PrologueSaveT["chapter"], state: null };
  if (!save) return { chapter: "cart", state: null };
  const st = save.state as Record<string, unknown>;
  if (st && typeof st.chapter === "string") return st as unknown as PrologueSaveT;
  return { chapter: "cart", state: st };
}

/**
 * There is one autosave slot and every chapter checkpoint goes there: a new game keeps the save it
 * replaces as a second autosave in 读取 instead of losing it. Not when that save is still on the ride
 * (say the last new game's own start): then auto-prev keeps the real checkpoint from before it.
 * Keeping it is best-effort: the new game's own autosave always runs, and reports its own failure.
 */
async function newGameAutosave(game: Game) {
  try {
    const prev = (await listSaves()).find((s) => s.id === "auto");
    if (prev && toPrologueSave(prev).chapter !== "cart") await writeSave({ ...prev, id: "auto-prev" });
  } catch (e) {
    console.warn("auto-prev not kept", e);
  }
  await game.save("auto");
}

let starting = false;
/** Starts so far: a showMenu() from before the latest start gives way to it (see there). */
let starts = 0;
async function startFromSave(save: SaveGame | null) {
  if (starting) return;
  starting = true;
  const mine = ++starts;
  audio.unlock();
  audio.uiTick("select");
  // the menu stops taking input right away, not after the engine comes up (seconds on a first visit)
  menuEl.classList.add("fade");
  hud.loading(true, "正在准备");
  let game: Game | undefined;
  // what a failed start has to take down again: the stage it built and its progress listener
  let built: PrologueStageT | undefined;
  let off: (() => void) | undefined;
  try {
    game = await getGame();
    const ps = toPrologueSave(save);
    assets.setSegment(ps.chapter);
    let ready = false;
    off = assets.onProgress(() => {
      if (!ready) hud.loading(true, `正在准备 ${Math.round(assets.startPackProgress(ps.chapter) * 100)}%`);
    });
    const st = await preloadPrologue();
    built = st;
    preload = null; // a later "new game" builds a fresh stage
    await st.prepareChapter(ps);
    ready = true;
    hud.loading(false);
    // only now that the load can no longer fail: until then the music is the game's still being played
    // (读取 from its pause menu), or the menu's
    audio.stopMusic(2.5);
    // a new stage: the last game's music states don't carry over
    audio.resetMusicState();
    await hud.fade(true, 1.0);
    menuEl.classList.add("hidden");
    // the CSS smoke is still up if the game was started before the 3D menu was
    document.getElementById("smoke")!.classList.add("off");
    // a sneak toggled on in the last game (exit to menu, or 读取 from the pause menu) doesn't carry over
    input.resetLatches();
    await game.setStage(async () => st);
    // the game is on screen: it no longer holds the menu off (返回主菜单 from a pause during the fade-in)
    starting = false;
    // the game is running now: a failed autosave must not throw the player back to the menu, nor hold
    // the fade-in (a saves DB that hangs takes seconds to time out)
    if (!save) void newGameAutosave(game).catch((err) => console.warn("autosave failed", err));
    mark("cart-started");
    console.info(`[timing] cart started ${(performance.now() - t0).toFixed(0)} ms after boot`);
    await hud.fade(false, 2.5);
  } catch (e) {
    console.error(e);
    // a stage that never reached the screen still holds a whole world (scene, GPU resources, physics)
    if (built && game?.stage !== built) built.dispose();
    hud.loading(false);
    void hud.fade(false, 0.3);
    // the menu scene, its music and the preload behind it: this start stopped or used them up, or
    // began before the 3D menu was up (showMenu gives way to a start, so clear the flag first)
    if (starts === mine) starting = false;
    // 读取 from the pause menu: that game is still on and Game reopens its pause menu
    if (!game?.stage?.gameplay) {
      menuEl.classList.remove("hidden", "fade");
      if (game) void showMenu().catch((err) => console.error(err));
    } else assets.setSegment(game.stage.segment);
    alert("无法开始游戏：" + (e instanceof Error ? e.message : String(e)));
  } finally {
    off?.();
    // not a later start's flag (one can begin during this start's fade-in)
    if (starts === mine) starting = false;
  }
}

for (const b of buttons) {
  b.addEventListener("click", async () => {
    // the focused button still answers Enter/Space by itself while the menu fades out for a start
    if (!menuVisible()) return;
    audio.unlock();
    switch (b.dataset.act) {
      case "new":
        void startFromSave(null);
        break;
      case "continue": {
        const s = await latestSave();
        if (s) void startFromSave(s);
        break;
      }
      case "load":
        audio.uiTick("select");
        void openLoad((s) => void startFromSave(s));
        break;
      case "settings":
        audio.uiTick("select");
        openSettings();
        break;
      case "credits":
        audio.uiTick("select");
        void openCredits();
        break;
    }
  });
}

if (new URLSearchParams(location.search).has("debug")) {
  (window as unknown as { __assetsProgress: () => unknown }).__assetsProgress = () => {
    const p = assets.progress;
    if (!p) return null;
    return { done: p.segments.reduce((s, x) => s + x.bytesDone, 0), total: p.segments.reduce((s, x) => s + x.bytesTotal, 0) };
  };
}

// download status line on the menu
assets.onProgress((p) => {
  const total = p.segments.reduce((s, x) => s + x.bytesTotal, 0);
  const done = p.segments.reduce((s, x) => s + x.bytesDone, 0);
  if (!total) return;
  if (done >= total) hud.downloadStatus(menuEl.classList.contains("hidden") ? "" : "全部资源已缓存，可离线游玩");
  else if (!p.caching) hud.downloadStatus(menuEl.classList.contains("hidden") ? "" : "无法使用本地缓存，资源将在需要时下载");
  else if (!menuEl.classList.contains("hidden"))
    hud.downloadStatus(`后台下载资源 ${Math.round((done / total) * 100)}%${p.bps > 0 ? ` · ${(p.bps / 1e6).toFixed(1)} MB/s` : ""}`);
  else hud.downloadStatus("");
});

// saves live in their own DB: 继续 and 读取 don't wait for the manifest and the asset worker
void refreshSaves();

(async () => {
  try {
    await assetsReady;
    mark("assets-ready");
    void navigator.storage?.persist?.().catch(() => {});
    void listSaves().catch(() => {});
    await showMenu();
    mark("menu-3d-ready");
    const mi = performance.getEntriesByName("menu-interactive")[0]?.startTime ?? 0;
    console.info(`[timing] menu interactive at ${mi.toFixed(0)} ms; 3D menu ready at ${performance.now().toFixed(0)} ms (since navigation start)`);
  } catch (e) {
    console.error(e);
    const f = document.createElement("div");
    f.id = "fatal";
    f.textContent = "启动失败：" + (e as Error).message + "。需要支持 WebGL2 或 WebGPU 的桌面浏览器。";
    document.body.appendChild(f);
  }
})();
mark("menu-interactive");
