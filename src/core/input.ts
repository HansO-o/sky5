import { settings, type Action } from "./settings";

/** Gamepad (standard mapping) buttons per action. */
const PAD: Partial<Record<Action, number>> = {
  jump: 3, // Y
  activate: 0, // A
  ready: 2, // X
  sprint: 4, // LB
  sneak: 10, // L3
  togglePov: 11, // R3
  menu: 9, // Start
};

/**
 * Keyboard / mouse / gamepad state. Look deltas are accumulated between frames and consumed once
 * per frame by whoever owns the camera.
 */
class Input {
  private keys = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private padPrev: boolean[] = [];
  private padNow: boolean[] = [];
  private lookX = 0;
  private lookY = 0;
  mouseButtons = 0;
  locked = false;
  /** Fired on any key-down (for rebinding / menus). Return true to swallow. */
  keyHook: ((e: KeyboardEvent) => boolean) | null = null;
  usingPad = false;

  attach(canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (this.keyHook?.(e)) {
        e.preventDefault();
        return;
      }
      if (e.code === "Tab" || e.code === "F5" || (e.code === "Space" && this.locked)) e.preventDefault();
      if (!e.repeat) this.pressedThisFrame.add(e.code);
      this.keys.add(e.code);
      this.usingPad = false;
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    canvas.addEventListener("mousedown", (e) => {
      this.mouseButtons |= 1 << e.button;
      this.pressedThisFrame.add(`Mouse${e.button}`);
    });
    window.addEventListener("mouseup", (e) => (this.mouseButtons &= ~(1 << e.button)));
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
  }

  /** Call at the end of every frame. */
  endFrame() {
    this.pressedThisFrame.clear();
  }

  /** Look delta in radians (yaw, pitch), sensitivity and invert applied. */
  consumeLook(): [number, number] {
    const s = settings.value.sensitivity * 0.0022;
    const out: [number, number] = [this.lookX * s, this.lookY * s * (settings.value.invertY ? -1 : 1)];
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  down(a: Action) {
    const code = settings.value.keys[a];
    const b = PAD[a];
    return this.keys.has(code) || (b !== undefined && !!this.padNow[b]);
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
