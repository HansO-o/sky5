export type Quality = "low" | "medium" | "high";

export type Action =
  | "forward"
  | "back"
  | "left"
  | "right"
  | "sprint"
  | "sneak"
  | "jump"
  | "activate"
  | "ready"
  | "attack"
  | "block"
  | "heal"
  | "togglePov"
  | "menu"
  | "quicksave";

export const ACTION_LABELS: Record<Action, string> = {
  forward: "前进",
  back: "后退",
  left: "左移",
  right: "右移",
  sprint: "冲刺",
  sneak: "潜行",
  jump: "跳跃",
  activate: "交互",
  ready: "拔出武器",
  attack: "攻击",
  block: "格挡",
  heal: "治疗药水",
  togglePov: "切换视角",
  menu: "菜单",
  quicksave: "快速存档",
};

export const DEFAULT_KEYS: Record<Action, string> = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  sprint: "ShiftLeft",
  // never Ctrl: Ctrl+W (sneak forward) closes the tab, and no page can cancel that
  sneak: "KeyC",
  jump: "Space",
  activate: "KeyE",
  ready: "KeyR",
  attack: "Mouse0",
  block: "Mouse2",
  heal: "KeyQ",
  togglePov: "KeyF",
  menu: "Tab",
  quicksave: "F5",
};

export interface Settings {
  quality: Quality;
  renderScale: number; // 0.5..1
  fov: number; // horizontal-ish degrees, 60..100
  sensitivity: number; // 0.2..3
  invertY: boolean;
  /** false: hold the sneak key; true: each press toggles sneaking */
  sneakToggle: boolean;
  master: number;
  music: number;
  sfx: number;
  voice: number;
  subtitles: boolean;
  keys: Record<Action, string>;
}

const DEFAULTS: Settings = {
  quality: "high",
  renderScale: 1,
  fov: 75,
  sensitivity: 1,
  invertY: false,
  sneakToggle: false,
  master: 0.9,
  music: 0.6,
  sfx: 0.85,
  voice: 1,
  subtitles: true,
  keys: { ...DEFAULT_KEYS },
};

const KEY = "northern.settings.v2";
/** M1/M2 settings: read (and migrated) while there is nothing under KEY yet. */
const KEY_V1 = "northern.settings.v1";
type Listener = (s: Settings) => void;

/** The stored settings, or null when there are none (first run). */
function load(): Partial<Settings> | null {
  try {
    const v2 = localStorage.getItem(KEY);
    if (v2) return JSON.parse(v2);
    const v1 = localStorage.getItem(KEY_V1);
    if (!v1) return null;
    const s: Partial<Settings> = JSON.parse(v1);
    // v1 saved the old Ctrl default with every change; Ctrl+W (sneak forward) closes the tab
    if (s?.keys?.sneak?.startsWith("Control")) s.keys.sneak = DEFAULT_KEYS.sneak;
    return s;
  } catch {
    return null;
  }
}

class SettingsStore {
  value: Settings;
  private listeners = new Set<Listener>();
  constructor() {
    const stored = load();
    this.value = { ...DEFAULTS, ...stored, keys: { ...DEFAULT_KEYS, ...(stored?.keys ?? {}) } };
    if (!stored) this.value.quality = guessQuality();
  }
  set<K extends keyof Settings>(k: K, v: Settings[K]) {
    this.value[k] = v;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {}
    this.listeners.forEach((l) => l(this.value));
  }
  reset() {
    // the same values a reload without stored settings gives (first-run quality guess included)
    this.value = { ...DEFAULTS, quality: guessQuality(), keys: { ...DEFAULT_KEYS } };
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(KEY_V1);
    } catch {}
    this.listeners.forEach((l) => l(this.value));
  }
  on(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

let guessed: Quality | undefined;
/** First-run guess: integrated GPUs start on "low", unknown on "medium". Probed once (it creates a WebGL context). */
function guessQuality(): Quality {
  return (guessed ??= probeQuality());
}

function probeQuality(): Quality {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    const r = ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
    if (/Intel|Iris|UHD|Mali|Adreno|SwiftShader|llvmpipe/i.test(r)) return "low";
    if (/RTX|GTX 1[06-9]|GTX 16|RX [5-7]\d{3}|Radeon Pro|Apple M[2-9]/i.test(r)) return "high";
    return "medium";
  } catch {
    return "medium";
  }
}

export const settings = new SettingsStore();

export function keyLabel(code: string) {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const mouse = /^Mouse(\d)$/.exec(code);
  if (mouse) return ["鼠标左键", "鼠标中键", "鼠标右键"][+mouse[1]] ?? `鼠标键 ${+mouse[1] + 1}`;
  const map: Record<string, string> = {
    ShiftLeft: "左 Shift",
    ShiftRight: "右 Shift",
    ControlLeft: "左 Ctrl",
    ControlRight: "右 Ctrl",
    AltLeft: "左 Alt",
    Space: "空格",
    Tab: "Tab",
    Escape: "Esc",
    Enter: "回车",
  };
  return map[code] ?? code;
}
