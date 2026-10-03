import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { audio } from "../core/audio";
import { CommandSlot } from "../engine/anim/commandSlot";
import { angleAround, interval, orbitPoints, strafeRun, type P3, type Rng } from "../engine/anim/flight";
import { Cancelled, type ScriptScope } from "./Director";
import type { Dragon } from "./dragon";
import type { FireFx } from "./fx/fire";
import type { TownFires } from "./fx/townFires";
import type { World } from "./World";

/** What the dragon is doing: an ambient behaviour, a scripted flight, or nothing. */
export type DragonMode = "idle" | "scripted" | "pass" | "circuit" | "rampage" | "hidden";

export interface RampageSpec {
  /** the circuit's centre (x, z) */
  center: { x: number; z: number };
  /** circuit radius (m) */
  r: number;
  /** circuit heights (absolute world y) */
  yMin: number;
  yMax: number;
  /** chance per lap segment of a strafing run over an unburnt house instead (default 0.55) */
  strafe?: number;
}

export interface CircuitOptions {
  /** flight speed (m/s, default 24) */
  speed?: number;
  /** never lower than this above the terrain (m, default 20) */
  clearance?: number;
}

const v3 = (p: P3) => new Vector3(p.x, p.y, p.z);
const ROARS = ["roar_a", "roar_b", "roar_c"] as const;

/**
 * The dragon as a stage-owned world event: it outlives the chapter that woke it, so a chapter can
 * end mid-flight and the next one picks it up (no freeze at a seamless handover).
 *
 * One command is active at a time and every command pre-empts the last:
 * - `pass(points, speed)`: one scripted flight; resolves `{completed}` (false when pre-empted);
 * - `circuit(...)`: lap a centre at a height band, roaring now and then;
 * - `rampage(spec)`: the raid: laps with strafing runs that set houses alight;
 * - `take()` / `place(pos, yaw)`: stop all behaviour and hand the dragon to a script (`fly`, `setYaw`, `roar`);
 * - `hide()`: gone (disabled) until the next command.
 * Behaviour loops run on the stage's own script scope, never a chapter's.
 */
export class DragonDirector {
  /** the active command (a repeated behaviour with the same parameters leaves it running) */
  private slot = new CommandSlot<DragonMode>("idle");
  private rng: Rng;

  constructor(
    private o: {
      world: World;
      dragon: Dragon;
      /** the stage's script scope (pauses with the game; cancelled with the stage) */
      scope: ScriptScope;
      fx: () => FireFx | null;
      fires: () => TownFires | null;
      rng?: Rng;
    },
  ) {
    this.rng = o.rng ?? Math.random;
  }

  get dragon(): Dragon {
    return this.o.dragon;
  }

  get mode(): DragonMode {
    return this.slot.mode;
  }

  /** Start a new command: the previous one's loops end at their next check. */
  private begin(mode: DragonMode, spec: string | null = null) {
    this.o.dragon.root.setEnabled(mode !== "hidden");
    return this.slot.begin(mode, spec);
  }

  private live(g: number) {
    return this.slot.live(g) && !this.o.scope.cancelled;
  }

  private run(g: number, loop: (live: () => boolean) => Promise<void>) {
    void loop(() => this.live(g)).catch((e) => {
      if (!(e instanceof Cancelled)) console.error("dragon behaviour", e);
    });
  }

  /**
   * Fly once along a smooth path through `points` (the dragon's current position first). Resolves
   * `{completed: true}` on arrival, `{completed: false}` when another command (or a script calling
   * `stopFlight`) cut it short. `then` runs only on a completed pass, e.g. to resume a behaviour
   * (a pass that is pre-empted never resumes anything behind the new command's back).
   */
  pass(points: Vector3[], speed: number, o: { clip?: string; then?: () => void } = {}): Promise<{ completed: boolean }> {
    const g = this.begin("pass");
    const last = points[points.length - 1];
    return this.o.dragon.fly(points, speed, o.clip).then(() => {
      // not pre-empted, and not stopped short by a script either
      const completed = this.slot.live(g) && !!last && Vector3.Distance(this.o.dragon.root.position, last) < 0.5;
      if (completed) {
        this.slot.settle(g, "idle");
        try {
          o.then?.();
        } catch (e) {
          console.error("dragon pass", e);
        }
      }
      return { completed };
    });
  }

  /**
   * Lap (center.x, center.z) at radius `r` between heights `yMin` and `yMax` (absolute world y, kept
   * at least `clearance` above the terrain), roaring every `roarEvery` seconds (or a [min, max] range).
   */
  circuit(center: { x: number; z: number }, r: number, yMin: number, yMax: number, roarEvery: number | readonly [number, number], o: CircuitOptions = {}) {
    const key = JSON.stringify([center.x, center.z, r, yMin, yMax, roarEvery, o]);
    if (this.slot.running("circuit", key)) return;
    const g = this.begin("circuit", key);
    const { world, dragon, scope } = this.o;
    const speed = o.speed ?? 24;
    this.run(g, async (live) => {
      let a = angleAround(center, dragon.root.position);
      while (live()) {
        const pts = orbitPoints(center, r, a, 3, 0.7, { yMin, yMax, rng: this.rng, ground: (x, z) => world.heightAt(x, z), clearance: o.clearance ?? 20 });
        a += 2.1;
        await scope.wait(dragon.fly(pts.map(v3), speed));
      }
    });
    this.run(g, async (live) => {
      while (live()) {
        await scope.sleep(interval(roarEvery, this.rng));
        if (!live()) return;
        void dragon.roar(ROARS[Math.floor(this.rng() * ROARS.length)], 2.2, 1);
      }
    });
  }

  /** The raid: laps of the town with strafing runs that set unburnt houses alight. */
  rampage(spec: RampageSpec) {
    const key = JSON.stringify(spec);
    if (this.slot.running("rampage", key)) return;
    const g = this.begin("rampage", key);
    const { dragon: dr, scope: s } = this.o;
    const rnd = (a: number, b: number) => a + this.rng() * (b - a);
    this.run(g, async (live) => {
      let a = angleAround(spec.center, dr.root.position);
      while (live()) {
        const fires = this.o.fires(), fx = this.o.fx();
        const cand = fires?.unburnt() ?? [];
        if (fires && fx && cand.length && this.rng() < (spec.strafe ?? 0.55)) {
          // strafing run over a house
          const i = cand[Math.floor(this.rng() * cand.length)];
          const roof = fires.roof(i);
          const run = strafeRun(roof, spec.center);
          const start = v3(run.start), mid = v3(run.mid), end = v3(run.end);
          await s.wait(dr.fly([start], 26));
          if (!live()) return;
          const pass = dr.fly([mid, end], 20);
          await s.sleep(Vector3.Distance(start, mid) / 20 - 1.4);
          // a script took the dragon over meanwhile: no stray stream
          if (!live()) return;
          void fx.breath(() => {
            const src = dr.breathSource();
            return { pos: src.pos, dir: roof.subtract(src.pos).normalize() };
          }, 1.8);
          await s.sleep(1.6);
          // the stream has reached the roof (even if a script takes the dragon now)
          fires.burn(i);
          if (!live()) return;
          await s.wait(pass);
        } else {
          // a stretch of the circuit, with a roar now and then
          const pts = orbitPoints(spec.center, spec.r, a, 3, 0.7, { yMin: spec.yMin, yMax: spec.yMax, rng: this.rng });
          a += 2.1;
          const f = dr.fly(pts.map(v3), 22);
          if (this.rng() < 0.5) {
            await s.sleep(1.5);
            if (!live()) return;
            void audio.playOneShot(`audio/${ROARS[Math.floor(this.rng() * ROARS.length)]}`, 1.3, dr.mouth(), "sfx", rnd(0.9, 1.05), 40);
          }
          await s.wait(f);
        }
      }
    });
  }

  /** Stop every behaviour and flight and hand the dragon to a script (visible, where it is). */
  take(): Dragon {
    this.begin("scripted");
    this.o.dragon.stopFlight();
    return this.o.dragon;
  }

  /**
   * Put the dragon somewhere (e.g. the start of a pass that begins out of sight), facing `yaw`
   * (-Z-forward convention) when given; it is then the script's (as after `take()`).
   */
  place(pos: Vector3, yaw?: number) {
    const dr = this.take();
    dr.root.position.copyFrom(pos);
    if (yaw !== undefined) dr.setYaw(yaw);
    return dr;
  }

  /** Stop and hide the dragon (any later command shows it again). */
  hide() {
    this.begin("hidden");
    this.o.dragon.stopFlight();
  }

  dispose() {
    this.begin("hidden");
    this.o.dragon.stopFlight();
  }
}
