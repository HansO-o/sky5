// Boot: the menu (plain DOM in index.html) is usable as soon as this small module runs. The engine,
// the 3D menu background and everything else load lazily behind it.
import { assets } from "./core/assets/AssetClient";
import type { Manifest } from "./core/assets/manifest";
import { audio } from "./core/audio";
import { latestSave, listSaves, type SaveGame } from "./core/saves";
import { closePanel, openCredits, openLoad, openSettings, panelOpen } from "./ui/panels";
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
buttons.forEach((b, k) =>
  b.addEventListener("mouseenter", () => {
    if (b.disabled || k === sel) return;
    sel = k;
    buttons.forEach((x, j) => x.classList.toggle("sel", j === sel));
    audio.uiTick("move");
  }),
);
select(0);

function menuVisible() {
  return !menuEl.classList.contains("hidden") && !panelOpen();
}

window.addEventListener("keydown", (e) => {
  audio.unlock();
  if (!menuEl.classList.contains("hidden") && panelOpen() && e.code === "Escape") {
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
  } else if (pad && panelOpen() && pad.buttons[1]?.pressed) {
    closePanel();
  }
  requestAnimationFrame(padLoop);
}
requestAnimationFrame(padLoop);

// ---------------------------------------------------------------- boot
const manifestP: Promise<Manifest> = fetch("./manifest.json", { cache: "no-cache" }).then((r) => {
  if (!r.ok) throw new Error(`manifest ${r.status}`);
  return r.json();
});

let gameP: Promise<Game> | null = null;
function getGame() {
  gameP ??= (async () => {
    const { Game } = await import("./game/Game");
    const g = new Game(canvas);
    await g.init();
    mark("engine-ready");
    g.onExitToMenu = () => void showMenu();
    if (new URLSearchParams(location.search).has("debug")) (window as unknown as { __game: Game }).__game = g;
    g.loadSave = (s) => void startFromSave(s);
    return g;
  })();
  return gameP;
}

async function showMenu() {
  const game = await getGame();
  assets.setSegment("menu");
  const { MenuStage } = await import("./scenes/MenuStage");
  await game.setStage(async () => new MenuStage(game.engine).init());
  menuEl.classList.remove("hidden", "fade");
  document.getElementById("smoke")!.classList.add("off");
  await refreshSaves();
  void audio.playMusic("audio/music_menu", { fade: 4, volume: 0.8 }).catch(() => {});
  // build the ride behind the menu straight away (downloads overlap with parsing/compiling)
  void preloadPrologue();
}

async function refreshSaves() {
  const has = !!(await latestSave());
  buttons.find((b) => b.dataset.act === "continue")!.disabled = !has;
  buttons.find((b) => b.dataset.act === "load")!.disabled = !has;
  if (buttons[sel].disabled) select(0);
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
    const tw = performance.now();
    // request the ride's start pack now (it jumps the queue); init() consumes each asset as it lands
    void Promise.all(assets.startPack("cart").map((id) => assets.get(id))).then(() =>
      console.info(`[timing] start pack ready +${(performance.now() - tw).toFixed(0)} ms`),
    );
    const { PrologueStage } = await import("./prologue/PrologueStage");
    const st = new PrologueStage(game);
    await st.init();
    mark("cart-preloaded");
    return st;
  })();
  preload.catch(() => (preload = null));
  return preload;
}

/** Saves from M1 stored the ride state directly. */
function toPrologueSave(save: SaveGame | null): PrologueSaveT {
  if (!save) return { chapter: "cart", state: null };
  const st = save.state as Record<string, unknown>;
  if (st && typeof st.chapter === "string") return st as unknown as PrologueSaveT;
  return { chapter: "cart", state: st };
}

let starting = false;
async function startFromSave(save: SaveGame | null) {
  if (starting) return;
  starting = true;
  audio.unlock();
  audio.uiTick("select");
  try {
    const game = await getGame();
    const ps = toPrologueSave(save);
    assets.setSegment(ps.chapter);
    let ready = false;
    const off = assets.onProgress(() => {
      if (!ready) hud.loading(true, `正在准备 ${Math.round(assets.startPackProgress(ps.chapter) * 100)}%`);
    });
    hud.loading(true, "正在准备");
    menuEl.classList.add("fade");
    audio.stopMusic(2.5);
    const st = await preloadPrologue();
    preload = null; // a later "new game" builds a fresh stage
    await st.prepareChapter(ps);
    ready = true;
    off();
    hud.loading(false);
    await hud.fade(true, 1.0);
    menuEl.classList.add("hidden");
    await game.setStage(async () => st);
    if (!save) await game.save("auto");
    mark("cart-started");
    console.info(`[timing] cart started ${(performance.now() - t0).toFixed(0)} ms after boot`);
    await hud.fade(false, 2.5);
  } catch (e) {
    console.error(e);
    hud.loading(false);
    void hud.fade(false, 0.3);
    menuEl.classList.remove("hidden", "fade");
    alert("无法开始游戏：" + (e as Error).message);
  } finally {
    starting = false;
  }
}

for (const b of buttons) {
  b.addEventListener("click", async () => {
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
  else if (!menuEl.classList.contains("hidden"))
    hud.downloadStatus(`后台下载资源 ${Math.round((done / total) * 100)}%${p.bps > 0 ? ` · ${(p.bps / 1e6).toFixed(1)} MB/s` : ""}`);
  else hud.downloadStatus("");
});

(async () => {
  try {
    const manifest = await manifestP;
    await assets.init(manifest, "menu");
    mark("assets-ready");
    void navigator.storage?.persist?.().catch(() => {});
    void refreshSaves();
    void listSaves();
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
