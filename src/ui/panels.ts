import { assets } from "../core/assets/AssetClient";
import { audio } from "../core/audio";
import { input } from "../core/input";
import { ACTION_LABELS, DEFAULT_KEYS, keyLabel, RESERVED_KEY, settings, type Action, type Quality } from "../core/settings";
import { listSaves, type SaveGame } from "../core/saves";
import { heading, styleRange } from "./widgets";

const fmtMB = (b: number) => (b / 1024 / 1024).toFixed(1) + " MB";

/** The game reloads the page itself (清除缓存): main.ts's beforeunload guard doesn't ask then. */
export let reloading = false;

function panel(title: string) {
  closePanel();
  const p = document.createElement("section");
  p.className = "panel";
  p.id = "panel";
  p.setAttribute("role", "dialog");
  p.setAttribute("aria-modal", "true");
  p.setAttribute("aria-label", title);
  p.tabIndex = -1;
  p.appendChild(heading(title));
  // keyboard focus moves into the dialog and Tab cycles through its controls
  p.addEventListener("keydown", (e) => {
    if (e.code !== "Tab") return;
    const f = [...p.querySelectorAll<HTMLElement>("button, input, a[href]")];
    if (!f.length) return;
    const at = document.activeElement;
    if (e.shiftKey && (at === f[0] || at === p)) f[f.length - 1].focus();
    else if (!e.shiftKey && at === f[f.length - 1]) f[0].focus();
    else return;
    e.preventDefault();
  });
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.getElementById("ui")!.appendChild(p);
  p.focus({ preventScroll: true });
  // the rest of the page is out of reach (Tab, clicks) while the dialog is open: the dimmed main menu
  // under it would otherwise still take Tab + Enter (新游戏 behind the settings)
  behind = ["menu", "pause", "scene"].flatMap((id) => document.getElementById(id) ?? []);
  behind.forEach((el) => el.setAttribute("inert", ""));
  return p;
}

let onClose: (() => void) | null = null;
/** Where the focus was before the panel opened (a menu button); it goes back there on close. */
let returnFocus: HTMLElement | null = null;
/** The page behind the open panel, made inert. */
let behind: HTMLElement[] = [];
export function closePanel() {
  const p = document.getElementById("panel");
  if (!p) return false;
  p.remove();
  input.keyHook = null;
  behind.forEach((el) => el.removeAttribute("inert"));
  behind = [];
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  returnFocus = null;
  const cb = onClose;
  onClose = null;
  cb?.();
  return true;
}
export function panelOpen() {
  return !!document.getElementById("panel");
}

function actions(p: HTMLElement, buttons: [string, () => void][]) {
  const a = document.createElement("div");
  a.className = "actions";
  for (const [label, fn] of buttons) {
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = label;
    b.onclick = () => {
      audio.uiTick("select");
      fn();
    };
    a.appendChild(b);
  }
  p.appendChild(a);
}

function row(p: HTMLElement, label: string, control: HTMLElement, out?: HTMLElement) {
  const r = document.createElement("div");
  r.className = "row";
  const l = document.createElement("label");
  l.textContent = label;
  r.append(l, control, out ?? document.createElement("span"));
  p.appendChild(r);
  return r;
}

function slider(p: HTMLElement, label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string) {
  const i = document.createElement("input");
  i.type = "range";
  i.min = String(min);
  i.max = String(max);
  i.step = String(step);
  i.value = String(get());
  styleRange(i);
  const o = document.createElement("output");
  o.textContent = fmt(get());
  i.oninput = () => {
    set(+i.value);
    o.textContent = fmt(+i.value);
  };
  row(p, label, i, o);
}

/** Option picker in the style of a console menu: ‹ value › (click the arrows or the value). */
function stepper<T>(options: [T, string][], get: () => T, set: (v: T) => void) {
  const w = document.createElement("div");
  w.className = "stepper";
  const prev = document.createElement("button"), next = document.createElement("button"), v = document.createElement("span");
  prev.textContent = "◀";
  next.textContent = "▶";
  prev.setAttribute("aria-label", "上一个");
  next.setAttribute("aria-label", "下一个");
  const show = () => (v.textContent = options.find(([x]) => x === get())?.[1] ?? "");
  const step = (d: number) => {
    const k = options.findIndex(([x]) => x === get());
    set(options[(k + d + options.length) % options.length][0]);
    audio.uiTick("move");
    show();
  };
  prev.onclick = () => step(-1);
  next.onclick = () => step(1);
  v.onclick = () => step(1);
  v.style.cursor = "pointer";
  show();
  w.append(prev, v, next);
  return w;
}

function select<T extends string>(p: HTMLElement, label: string, options: [T, string][], get: () => T, set: (v: T) => void) {
  row(p, label, stepper(options, get, set));
}

function checkbox(p: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void) {
  row(p, label, stepper<boolean>([[true, "开"], [false, "关"]], get, set));
}

export function openSettings(close?: () => void) {
  onClose = close ?? null;
  const s = settings;
  const p = panel("设置");
  const h3 = (t: string) => {
    const h = document.createElement("h3");
    h.textContent = t;
    p.appendChild(h);
  };
  h3("画面");
  select<Quality>(p, "画质", [["low", "低"], ["medium", "中"], ["high", "高"]], () => s.value.quality, (v) => s.set("quality", v));
  slider(p, "分辨率缩放", 0.5, 1, 0.05, () => s.value.renderScale, (v) => s.set("renderScale", v), (v) => `${Math.round(v * 100)}%`);
  slider(p, "视野", 60, 100, 1, () => s.value.fov, (v) => s.set("fov", v), (v) => `${v}°`);
  h3("控制");
  slider(p, "鼠标灵敏度", 0.2, 3, 0.05, () => s.value.sensitivity, (v) => s.set("sensitivity", v), (v) => v.toFixed(2));
  checkbox(p, "反转 Y 轴", () => s.value.invertY, (v) => s.set("invertY", v));
  row(p, "潜行方式", stepper<boolean>([[false, "按住"], [true, "切换"]], () => s.value.sneakToggle, (v) => s.set("sneakToggle", v)));
  h3("声音");
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  slider(p, "主音量", 0, 1, 0.01, () => s.value.master, (v) => s.set("master", v), pct);
  slider(p, "音乐", 0, 1, 0.01, () => s.value.music, (v) => s.set("music", v), pct);
  slider(p, "音效", 0, 1, 0.01, () => s.value.sfx, (v) => s.set("sfx", v), pct);
  slider(p, "语音", 0, 1, 0.01, () => s.value.voice, (v) => s.set("voice", v), pct);
  checkbox(p, "字幕", () => s.value.subtitles, (v) => s.set("subtitles", v));

  h3("按键");
  const keys = document.createElement("div");
  keys.className = "keys";
  let stopWaiting = () => {};
  for (const a of Object.keys(DEFAULT_KEYS) as Action[]) {
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = keyLabel(s.value.keys[a]);
    let waiting = false, mouseBound = false;
    const stop = (code?: string) => {
      if (code) s.set("keys", { ...s.value.keys, [a]: code });
      waiting = false;
      b.classList.remove("wait");
      b.textContent = keyLabel(s.value.keys[a]);
      input.keyHook = null;
      stopWaiting = () => {};
    };
    b.onclick = () => {
      if (mouseBound) return void (mouseBound = false); // the click that ends a left-button binding
      stopWaiting();
      waiting = true;
      stopWaiting = stop;
      b.classList.add("wait");
      b.textContent = "按下新按键…";
      input.keyHook = (e) => {
        // the held key that started the wait (Enter on the focused button) repeats: neither binds nor cancels
        if (e.repeat) return true;
        if (e.code === "Escape") stop();
        else if (!e.code || RESERVED_KEY.test(e.code)) b.textContent = "该键不可用";
        else stop(e.code);
        return true;
      };
    };
    // a mouse button is bound by pressing it on the waiting button
    b.onmousedown = (e) => {
      mouseBound = false;
      // e.detail > 1: the second press of a double-click on the button isn't a left-button binding
      if (!waiting || e.button > 2 || e.detail > 1) return;
      e.preventDefault();
      mouseBound = e.button === 0;
      stop(`Mouse${e.button}`);
    };
    b.oncontextmenu = (e) => e.preventDefault();
    row(keys, ACTION_LABELS[a], b);
  }
  p.appendChild(keys);

  h3("存储");
  const usage = document.createElement("span");
  usage.textContent = "计算中…";
  const dl = document.createElement("span");
  const refresh = async () => {
    const st = await assets.stats();
    usage.textContent = `资源缓存 ${fmtMB(st.assetBytes)}（${st.assetCount} 个文件）`;
    const total = assets.progress?.segments.reduce((x, y) => x + y.bytesTotal, 0) ?? 0;
    const done = assets.progress?.segments.reduce((x, y) => x + y.bytesDone, 0) ?? 0;
    dl.textContent = total ? `已下载 ${Math.round((done / total) * 100)}%` : "";
  };
  void refresh();
  const clear = document.createElement("button");
  clear.className = "btn";
  clear.textContent = "清除缓存";
  clear.onclick = async () => {
    if (!confirm("清除全部已下载的游戏资源？清除后将重新加载页面，资源需要重新下载。存档不受影响。")) return;
    await assets.clear();
    reloading = true;
    location.reload();
  };
  row(p, "缓存占用", usage, clear);
  row(p, "下载进度", dl);
  actions(p, [
    ["恢复默认", () => {
      s.reset();
      openSettings(close);
    }],
    ["返回", () => closePanel()],
  ]);
}

export async function openCredits(close?: () => void) {
  onClose = close ?? null;
  const p = panel("制作人员");
  const c = document.createElement("div");
  c.className = "credits";
  c.innerHTML = `<p>《北境：序章》是一部原创的网页游戏作品。剧情、地名、人名与台词均为原创。</p>
    <h3>第三方资源</h3><div id="credit-list">加载中…</div>`;
  p.appendChild(c);
  actions(p, [["返回", () => closePanel()]]);
  const { default: data } = await import("../generated/credits.json");
  const list = c.querySelector("#credit-list")!;
  list.innerHTML = "";
  const kinds: Record<string, string> = { font: "字体", model: "模型", texture: "贴图", hdri: "天空", animation: "动画", music: "音乐", sound: "音效", library: "程序库" };
  const add = (x: { name: string; authors: string[]; source: string; license: string; licenseUrl: string; kind: string; note?: string }) => {
    const d = document.createElement("div");
    const a = document.createElement("a");
    a.href = x.source;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = x.name;
    const lic = document.createElement("a");
    lic.href = x.licenseUrl;
    lic.target = "_blank";
    lic.rel = "noopener";
    lic.className = "lic";
    lic.textContent = x.license;
    d.append(`[${kinds[x.kind] ?? x.kind}] `, a, ` — ${x.authors.join("、")} · `, lic, x.note ? ` · ${x.note}` : "");
    list.appendChild(d);
  };
  data.extra.forEach(add);
  const ph = document.createElement("h3");
  ph.textContent = "Poly Haven（CC0）";
  list.appendChild(ph);
  data.polyhaven.forEach(add);
}

export async function openLoad(onPick: (s: SaveGame) => void, close?: () => void) {
  onClose = close ?? null;
  const p = panel("读取");
  const saves = await listSaves();
  if (!saves.length) {
    const e = document.createElement("p");
    e.className = "empty";
    e.textContent = "没有存档";
    p.appendChild(e);
  }
  const list = document.createElement("div");
  list.className = "saves";
  for (const s of saves) {
    const b = document.createElement("button");
    const kind = { auto: "自动存档", quick: "快速存档", manual: "存档" }[s.kind];
    const cells = [kind, s.label, new Date(s.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })];
    cells.forEach((t, i) => {
      const c = document.createElement("span");
      c.textContent = t;
      if (i === 2) c.className = "when";
      b.appendChild(c);
    });
    b.onclick = () => {
      audio.uiTick("select");
      closePanel();
      onPick(s);
    };
    list.appendChild(b);
  }
  p.appendChild(list);
  actions(p, [["返回", () => closePanel()]]);
}
