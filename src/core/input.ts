import { settings, type Action } from "./settings";

/** Gamepad (standard mapping) buttons per action. */
const PAD: Partial<Record<Action, number>> = {
  jump: 3, // Y
  activate: 0, // A
  ready: 2, // X
  attack: 7, // RT
  block: 6, // LT
  heal: 12, // D-pad up
  sprint: 4, // LB
  sneak: 10, // L3
  togglePov: 11, // R3
  menu: 9, // Start
};

/**
 * Keyboard / mouse / gamepad state. Look deltas are accumulated between frames and consumed once
 * per frame by whoever owns the camera; look that nobody consumed during a frame is dropped.
 * Actions bound to "Mouse0".."Mouse2" read the mouse buttons pressed on the canvas.
 */
class Input {
  private keys = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private padPrev: boolean[] = [];
  private padNow: boolean[] = [];
  private lookX = 0;
  private lookY = 0;
  private lookTaken = false;
  private sneakOn = false;
  mouseButtons = 0;
  /** The left press that (re)locks the pointer is not an attack: Mouse0 reads as up until its mouseup. */
  swallowMouse0 = false;
  locked = false;
  /** Fired on any key-down (for rebinding / menus). Return true to swallow. */
  keyHook: ((e: KeyboardEvent) => boolean) | null = null;
  usingPad = false;

  constructor() {
    // From boot (rebinding works before the engine has loaded), and ahead of every other key handler:
    // a swallowed key (Esc cancelling a rebind) must not also close the main menu's settings panel.
    window.addEventListener(
      "keydown",
      (e) => {
        if (!this.keyHook?.(e)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      { capture: true },
    );
  }

  attach(canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      // Tab is the menu key, but in an open dialog (settings, saves, character creation, the prologue's
      // end card) it moves the focus, also in the pause menu's settings (where the menu key would close the panel)
      if (e.code === "Tab" && !this.locked && document.querySelector("#panel, #creator, #endcard")) return;
      if (this.blocksDefault(e)) e.preventDefault();
      if (!e.repeat) this.pressedThisFrame.add(e.code);
      this.keys.add(e.code);
      this.usingPad = false;
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.mouseButtons = 0;
      this.swallowMouse0 = false;
    });
    canvas.addEventListener("mousedown", (e) => {
      this.mouseButtons |= 1 << e.button;
      // Game's canvas click handler requests the lock on this click
      if (e.button === 0 && !this.locked) this.swallowMouse0 = true;
      else this.pressedThisFrame.add(`Mouse${e.button}`);
    });
    window.addEventListener("mouseup", (e) => {
      this.mouseButtons &= ~(1 << e.button);
      if (e.button === 0) this.swallowMouse0 = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
      this.usingPad = false;
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
    });
  }

  requestLock(canvas: HTMLCanvasElement) {
    if (document.pointerLockElement === canvas) return;
    // unadjustedMovement avoids OS mouse acceleration where supported
    const p = (canvas.requestPointerLock as (o?: unknown) => Promise<void> | void).call(canvas, { unadjustedMovement: true });
    if (p && "catch" in p) p.catch(() => canvas.requestPointerLock());
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Browser default actions the game takes over. */
  private blocksDefault(e: KeyboardEvent) {
    // in play every key is the game's: Space scrolls, ' and / open Firefox's quick find, Ctrl+R/S/D/F reload
    // or open dialogs (Ctrl+W can't be cancelled at all, so Ctrl is never a default binding). Esc
    // always releases the pointer, and F11/F12 stay the browser's.
    if (this.locked) return !["Escape", "F11", "F12"].includes(e.code);
    // F5 quicksaves instead of reloading; Tab (menu) mustn't move the focus off the page
    return e.code === "F5" || e.code === "Tab";
  }

  /** Call once at the start of every frame. */
  poll(dt: number) {
    this.padPrev = this.padNow;
    this.padNow = [];
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((p) => p && p.connected);
    if (pad) {
      this.padNow = pad.buttons.map((b) => b.pressed);
      const dead = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const rx = dead(pad.axes[2] ?? 0), ry = dead(pad.axes[3] ?? 0);
      if (rx || ry || this.padNow.some(Boolean)) this.usingPad = true;
      // stick look: ~180 deg/s at full deflection, expressed in mouse-pixel units
      this.lookX += Math.sign(rx) * rx * rx * 900 * dt;
      this.lookY += Math.sign(ry) * ry * ry * 600 * dt;
    }
    // toggle mode: each press of sneak in play flips it (hold mode reads the key itself). Also before
    // the click that locks the pointer, but not on the menus, while paused or in the character
    // creator (typing a name).
    if (!settings.value.sneakToggle) this.sneakOn = false;
    else if ((this.pressedThisFrame.has(settings.value.keys.sneak) || this.padPressed(PAD.sneak!)) && !document.querySelector("#menu:not(.hidden), #pause, #panel, #creator"))
      this.sneakOn = !this.sneakOn;
  }

  /** A new game or a loaded save starts upright, whatever the toggles were in the last one. */
  resetLatches() {
    this.sneakOn = false;
  }

  /** Call at the end of every frame. */
  endFrame() {
    this.pressedThisFrame.clear();
    // No camera took the look this frame (main menu, paused, a modal UI): drop it, or the stick
    // deflection held meanwhile would spin the camera in one go on the first frame back.
    if (!this.lookTaken) this.lookX = this.lookY = 0;
    this.lookTaken = false;
  }

  /** Look delta in radians (yaw, pitch), sensitivity and invert applied. */
  consumeLook(): [number, number] {
    const s = settings.value.sensitivity * 0.0022;
    const out: [number, number] = [this.lookX * s, this.lookY * s * (settings.value.invertY ? -1 : 1)];
    this.lookX = 0;
    this.lookY = 0;
    this.lookTaken = true;
    return out;
  }

  down(a: Action) {
    if (a === "sneak" && settings.value.sneakToggle) return this.sneakOn;
    const code = settings.value.keys[a];
    const b = PAD[a];
    const m = /^Mouse(\d)$/.exec(code);
    const n = m ? +m[1] : -1;
    const key = m ? !!((this.mouseButtons >> n) & 1) && !(n === 0 && this.swallowMouse0) : this.keys.has(code);
    return key || (b !== undefined && !!this.padNow[b]);
  }

  pressed(a: Action) {
    const code = settings.value.keys[a];
    const b = PAD[a];
    return this.pressedThisFrame.has(code) || (b !== undefined && !!this.padNow[b] && !this.padPrev[b]);
  }

  /** Raw code check (Escape etc.). */
  pressedCode(code: string) {
    return this.pressedThisFrame.has(code);
  }

  padPressed(button: number) {
    return !!this.padNow[button] && !this.padPrev[button];
  }

  /** Left stick / WASD as a -1..1 vector (x right, y forward). */
  move(): [number, number] {
    let x = (this.down("right") ? 1 : 0) - (this.down("left") ? 1 : 0);
    let y = (this.down("forward") ? 1 : 0) - (this.down("back") ? 1 : 0);
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected);
    if (pad) {
      const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
      if (Math.abs(ax) > 0.15) x = ax;
      if (Math.abs(ay) > 0.15) y = -ay;
    }
    return [x, y];
  }
}

export const input = new Input();
