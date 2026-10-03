import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Character } from "../world/characters";
import { floorAt } from "../engine/physics/ground";
import type { World } from "./World";

export interface PathOptions {
  speed?: number;
  clip?: string;
  /** height of each point: given (x, y, z) points keep their y; otherwise terrain height */
  ground?: boolean;
  /** clip to play on arrival */
  arrive?: string;
}

/** Turn a character (glTF, facing +Z) toward a world point. */
export function faceTo(ch: Character, p: { x: number; z: number }) {
  const r = ch.root.getAbsolutePosition();
  const yaw = Math.atan2(p.x - r.x, p.z - r.z);
  ch.root.rotationQuaternion ??= Quaternion.Identity();
  ch.root.rotationQuaternion.copyFromFloats(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
}

export function setYaw(ch: Character, forwardYaw: number) {
  // forwardYaw uses the -Z-forward convention; characters face +Z
  const y = forwardYaw + Math.PI;
  ch.root.rotationQuaternion ??= Quaternion.Identity();
  ch.root.rotationQuaternion.copyFromFloats(0, Math.sin(y / 2), 0, Math.cos(y / 2));
}

/**
 * Walk a character along a polyline on world time (pauses with the game). Points are world
 * positions; with `ground` the y comes from the terrain. Resolves with true on arrival, false when
 * the walk was stopped first (stopWalk, stand, a new walk, the character removed from the world).
 */
const walking = new WeakMap<Character, () => void>();

/** Stop a walk in progress (e.g. the character was shot); its promise resolves (with false). */
export function stopWalk(ch: Character) {
  walking.get(ch)?.();
}

export function walkPath(world: World, ch: Character, points: Vector3[], o: PathOptions = {}): Promise<boolean> {
  stopWalk(ch);
  const speed = o.speed ?? 1.5;
  ch.root.parent = null;
  ch.play(o.clip ?? (speed > 2.6 ? "Jog_Fwd_Loop" : "Walk_Loop"), { speed: speed > 2.6 ? speed / 3.4 : speed / 1.4, blend: 0.25 });
  const pts = points.map((p) => p.clone());
  if (o.ground) for (const p of pts) p.y = world.heightAt(p.x, p.z);
  let i = 0;
  let yaw: number | null = null;
  return new Promise<boolean>((resolve) => {
    const finish = (arrived: boolean) => {
      off();
      walking.delete(ch);
      resolve(arrived);
    };
    walking.set(ch, () => finish(false));
    const off = world.onUpdate((dt) => {
      // removed meanwhile (World.removeNpc disposes the character): nothing left to move
      if (ch.root.isDisposed()) return finish(false);
      const pos = ch.root.position;
      let step = speed * dt;
      while (step > 0 && i < pts.length) {
        const t = pts[i];
        const d = t.subtract(pos);
        const len = d.length();
        if (len <= step) {
          pos.copyFrom(t);
          step -= len;
          i++;
        } else {
          pos.addInPlace(d.scale(step / len));
          step = 0;
        }
      }
      if (o.ground) pos.y = world.heightAt(pos.x, pos.z);
      const target = pts[Math.min(i, pts.length - 1)];
      const want = Math.atan2(target.x - pos.x, target.z - pos.z);
      if (Number.isFinite(want) && Vector3.DistanceSquared(target, pos) > 0.01) {
        yaw = yaw === null ? want : yaw + Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw)) * Math.min(1, dt * 8);
        ch.root.rotationQuaternion ??= Quaternion.Identity();
        ch.root.rotationQuaternion.copyFromFloats(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
      }
      if (i >= pts.length) {
        ch.play(o.arrive ?? "Idle_Loop", { blend: 0.3 });
        finish(true);
      }
    });
  });
}

/** Place a character on the ground at (x, z) facing a world point (ends any walk in progress). */
export function stand(world: World, ch: Character, x: number, z: number, look?: { x: number; z: number }, clip = "Idle_Loop") {
  // a walk left running would carry the character off again, sliding in the idle pose
  stopWalk(ch);
  ch.root.parent = null;
  ch.root.position.set(x, world.heightAt(x, z), z);
  if (look) faceTo(ch, look);
  ch.play(clip, { blend: 0.2 });
}

/**
 * The floor under (x, z) near `yHint` from the static colliders (a ray down from yHint + 1.5): for
 * places where terrain height means nothing (inside the keep, underground). Falls back to `yHint`
 * without physics or a floor within 4 m below it.
 */
export function floor3(world: World, x: number, z: number, yHint: number) {
  const y = world.physics ? floorAt(world.physics, x, z, yHint) : null;
  return new Vector3(x, y ?? yHint, z);
}

/**
 * `stand()` for interiors and underground: places a character on the static floor under (x, z)
 * near `yHint` (see {@link floor3}), never on the terrain above. Returns the position used. Walks
 * there take explicit y values (`walkPath` without `ground`).
 */
export function place3(world: World, ch: Character, x: number, z: number, yHint: number, look?: { x: number; z: number }, clip = "Idle_Loop") {
  stopWalk(ch);
  ch.root.parent = null;
  const p = floor3(world, x, z, yHint);
  ch.root.position.copyFrom(p);
  if (look) faceTo(ch, look);
  ch.play(clip, { blend: 0.2 });
  return p;
}
