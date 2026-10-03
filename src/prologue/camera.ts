import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { input } from "../core/input";
import { settings } from "../core/settings";

export type RigMode = "seat" | "cine" | "player";

/** What the rig follows in "player" mode (implemented by the player controller). */
export interface CameraTarget {
  /** world-space eye position for first person */
  eye(out: Vector3): Vector3;
  /** world-space point the third-person camera orbits around */
  pivot(out: Vector3): Vector3;
  /** keeps the third-person camera out of walls: returns the allowed distance */
  clip?(from: Vector3, dir: Vector3, maxDist: number): number;
  /** distance to the nearest surface along a ray within maxDist, or Infinity */
  rayDist?(from: Vector3, dir: Vector3, maxDist: number): number;
  firstPerson: boolean;
}

const ease = (t: number) => t * t * (3 - 2 * t);
/** third-person over-the-shoulder offset to the right (m) */
const SHOULDER = 0.45;
/** walls pushed the third-person camera this close to the pivot (m): it would be inside the body */
const CLOSE_UP = 0.35;

/**
 * One camera, three behaviours: seated head-look (parented to a seat), scripted cinematics with
 * cuts/moves/shake, and first/third-person following the player.
 */
export class CameraRig {
  camera: FreeCamera;
  mode: RigMode = "cine";
  /** head look relative to the seat/body (radians) */
  yaw = 0;
  pitch = 0;
  yawLimit = 1.9;
  pitchLimits: [number, number] = [-0.95, 0.75];
  /** third-person distance; zoom with mouse wheel */
  distance = 3.2;
  /** player mode, third person: walls brought the camera into the body (the follow target hides it) */
  closeUp = false;
  lookEnabled = true;
  private target: CameraTarget | null = null;
  private move: { from: Vector3; to: Vector3; lookFrom: Vector3; lookTo: Vector3; t: number; dur: number; resolve: () => void } | null = null;
  private lookAt = new Vector3();
  private shakeT = 0;
  private shakeAmp = 0;
  private time = 0;
  /** extra pitch/roll for seat sway */
  sway = true;
  private offSettings: () => void;
  private failed = false;

  constructor(scene: Scene) {
    this.camera = new FreeCamera("eye", new Vector3(0, 0, 0), scene);
    this.camera.minZ = 0.06;
    this.camera.maxZ = 4000;
    this.camera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    this.camera.inertia = 0;
    this.applyFov();
    this.offSettings = settings.on(() => this.applyFov());
    window.addEventListener("wheel", this.onWheel);
    // the global listeners would otherwise keep every disposed world alive
    scene.onDisposeObservable.add(() => this.dispose());
  }

  /** Wheel zoom in third person; only in play (pointer locked), not while scrolling a menu panel. */
  private onWheel = (e: WheelEvent) => {
    if (!input.locked || this.mode !== "player" || !this.target || this.target.firstPerson) return;
    this.distance = Math.max(1.2, Math.min(9, this.distance * (e.deltaY > 0 ? 1.12 : 0.89)));
  };

  private fovOverride: number | null = null;
  private applyFov() {
    this.camera.fov = this.fovOverride ?? (settings.value.fov * Math.PI) / 180;
  }
  setFov(rad: number | null) {
    this.fovOverride = rad;
    this.applyFov();
  }

  get position() {
    this.camera.computeWorldMatrix();
    return this.camera.globalPosition;
  }

  /** Sit: the camera is parented to a node (e.g. a wagon seat) and the player can only turn the head. */
  seat(node: TransformNode, offset: Vector3, yawLimit = 1.9) {
    this.mode = "seat";
    // a glide never advances outside cine mode
    this.endMove();
    this.steer = null;
    this.closeUp = false;
    this.camera.parent = node;
    this.camera.position.copyFrom(offset);
    this.yawLimit = yawLimit;
    this.camera.rotationQuaternion = null;
  }

  /** Hard cut to a world-space shot. */
  cut(pos: Vector3, look: Vector3) {
    this.mode = "cine";
    this.endMove();
    this.steer = null;
    this.closeUp = false;
    this.camera.parent = null;
    this.camera.position.copyFrom(pos);
    this.lookAt.copyFrom(look);
    this.camera.setTarget(look);
  }

  /** Smooth camera move between shots. */
  glide(pos: Vector3, look: Vector3, seconds: number) {
    if (this.mode !== "cine") this.cut(this.position.clone(), this.position.add(this.camera.getDirection(new Vector3(0, 0, -1))));
    return new Promise<void>((resolve) => {
      this.move?.resolve();
      this.move = { from: this.camera.position.clone(), to: pos.clone(), lookFrom: this.lookAt.clone(), lookTo: look.clone(), t: 0, dur: seconds, resolve };
    });
  }

  follow(target: CameraTarget) {
    this.mode = "player";
    this.target = target;
    this.camera.parent = null;
    this.endMove();
    this.steer = null;
  }

  /** End the current glide where it is; whoever awaits it moves on (as when glide() supersedes it). */
  private endMove() {
    const m = this.move;
    this.move = null;
    m?.resolve();
  }

  private steer: { pos: () => Vector3 | null; t: number; dur: number } | null = null;
  /**
   * Player mode: ease the view toward a point for `seconds` (the player can still look around).
   * The steer ends early when `pos` returns null or throws (its target is gone).
   */
  lookToward(pos: Vector3 | (() => Vector3 | null), seconds = 0.8) {
    this.steer = { pos: typeof pos === "function" ? pos : () => pos, t: 0, dur: seconds };
  }
  /** Drop a running lookToward (e.g. when a chapter is skipped). */
  clearSteer() {
    this.steer = null;
  }

  shake(amplitude: number, seconds: number) {
    this.shakeAmp = Math.max(this.shakeAmp, amplitude);
    this.shakeT = Math.max(this.shakeT, seconds);
  }

  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private tmp3 = new Vector3();
  private tmp4 = new Vector3();
  /** Per frame. Never throws: an exception here would escape the render loop and stop the game for good. */
  update(dt: number) {
    try {
      this.tick(dt);
    } catch (e) {
      this.steer = null;
      if (!this.failed) console.error("camera rig", e);
      this.failed = true;
    }
  }

  private tick(dt: number) {
    this.time += dt;
    const [dx, dy] = this.lookEnabled ? input.consumeLook() : (input.consumeLook(), [0, 0]);
    let sx = 0, sy = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * Math.min(1, this.shakeT * 2);
      sx = (Math.sin(this.time * 41) + Math.sin(this.time * 67)) * 0.5 * a;
      sy = (Math.sin(this.time * 53 + 1) + Math.sin(this.time * 79)) * 0.5 * a;
      if (this.shakeT <= 0) this.shakeAmp = 0;
    }
    if (this.mode === "seat") {
      this.yaw = Math.max(-this.yawLimit, Math.min(this.yawLimit, this.yaw - dx));
      this.pitch = Math.max(this.pitchLimits[0], Math.min(this.pitchLimits[1], this.pitch - dy));
      const sway = this.sway ? Math.sin(this.time * 1.7) * 0.004 : 0;
      this.camera.rotation.set(this.pitch + sway + sy, this.yaw + sx, this.sway ? Math.sin(this.time * 1.1) * 0.003 : 0);
      return;
    }
    if (this.mode === "cine") {
      const m = this.move;
      if (m) {
        m.t = Math.min(m.dur, m.t + dt);
        const k = ease(m.dur > 0 ? m.t / m.dur : 1);
        Vector3.LerpToRef(m.from, m.to, k, this.camera.position);
        Vector3.LerpToRef(m.lookFrom, m.lookTo, k, this.lookAt);
        if (m.t >= m.dur) {
          this.move = null;
          m.resolve();
        }
      }
      this.camera.setTarget(this.lookAt);
      this.camera.rotation.x += sy;
      this.camera.rotation.y += sx;
      return;
    }
    // player
    const t = this.target;
    if (!t) return;
    this.yaw -= dx;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - dy));
    if (this.steer) {
      const st = this.steer;
      st.t += dt;
      const from = t.firstPerson ? t.eye(this.tmp2) : t.pivot(this.tmp2);
      let to: Vector3 | null = null;
      try {
        to = st.pos();
      } catch {
        // the target was removed (e.g. a chapter skip disposed the NPC): drop the steer
      }
      if (!to) this.steer = null;
      else {
        const ty = Math.atan2(-(to.x - from.x), -(to.z - from.z));
        const tp = Math.atan2(to.y - from.y, Math.hypot(to.x - from.x, to.z - from.z));
        const k = Math.min(1, dt * 5);
        this.yaw += Math.atan2(Math.sin(ty - this.yaw), Math.cos(ty - this.yaw)) * k;
        this.pitch += (Math.max(-1.35, Math.min(1.35, tp)) - this.pitch) * k;
        if (st.t >= st.dur) this.steer = null;
      }
    }
    const dir = this.tmp.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    if (t.firstPerson) {
      this.closeUp = false;
      t.eye(this.camera.position);
    } else {
      const piv = t.pivot(this.tmp2);
      // over-the-shoulder offset to the right, shortened by a wall there (the pivot must stay in
      // the open, or the back ray below starts inside the wall and finds nothing)
      const right = this.tmp3.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const s = t.clip ? t.clip(piv, right, SHOULDER) : SHOULDER;
      piv.addInPlace(right.scaleInPlace(s));
      const back = dir.scale(-1);
      const d = t.clip ? t.clip(piv, back, this.distance) : this.distance;
      this.camera.position.copyFrom(piv).addInPlace(back.scaleInPlace(d));
      // (right and back are perpendicular)
      this.closeUp = Math.hypot(s, d) < CLOSE_UP;
      this.clearNearPlane(t);
    }
    this.camera.rotation.set(this.pitch + sy, this.yaw + sx, 0);
  }

  /**
   * The near plane reaches `nh` to each side of the camera point. Looking along a wall at a grazing
   * angle, the back ray keeps the point in front of it but the plane's edge cuts into the wall and
   * shows what is behind it (the outside of the tower from its stairwell): step sideways off it.
   */
  private clearNearPlane(t: CameraTarget) {
    if (!t.rayDist) return;
    const cam = this.camera.position;
    const nh = this.camera.minZ * Math.tan(this.camera.fov / 2) + 0.03;
    const right = this.tmp3.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const r = t.rayDist(cam, right, 2 * nh);
    const l = t.rayDist(cam, right.negateToRef(this.tmp4), 2 * nh);
    if (r >= nh && l >= nh) return;
    // between two walls closer than that: the middle; otherwise off the near one
    const x = r + l < 2 * nh ? (r - l) / 2 : r < nh ? r - nh : nh - l;
    cam.addInPlace(right.scaleInPlace(x));
  }

  /** Remove the global listeners (settings, wheel) and drop the follow target. Runs with the scene's disposal. */
  dispose() {
    this.offSettings();
    window.removeEventListener("wheel", this.onWheel);
    this.target = null;
    this.endMove();
    this.steer = null;
  }
}
