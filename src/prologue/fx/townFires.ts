import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { FireFx, FireHandle } from "./fire";

/**
 * Houses burning once the raid is over (the dragon chapter's first two, then the ones nearest the
 * keep): what a chapter resumed after the raid lights with {@link TownFires.ensure}.
 */
export const RAIDED_HOUSES: readonly number[] = [4, 7, 5, 9, 6];

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * The town's persistent fires: burning houses and any scripted fire handed over with `track`.
 * Owned by the stage, so they outlive the chapter that lit them; `pause`/`resume` hide and relight
 * them all at once (while the outdoor world is hidden underground).
 */
export class TownFires {
  private houses = new Map<number, FireHandle[]>();
  private extra = new Set<FireHandle>();
  private isPaused = false;

  constructor(
    private fx: FireFx,
    private houseNodes: readonly { node: TransformNode }[],
    private heightAt: (x: number, z: number) => number,
  ) {}

  /** Indices of the burning houses, in the order they caught fire. */
  get burning(): number[] {
    return [...this.houses.keys()];
  }

  get count() {
    return this.houses.size;
  }

  get paused() {
    return this.isPaused;
  }

  has(i: number) {
    return this.houses.has(i);
  }

  /** Indices of the houses not burning yet. */
  unburnt(): number[] {
    return this.houseNodes.map((_, i) => i).filter((i) => !this.houses.has(i));
  }

  /** Where a house's roof fire sits. */
  roof(i: number) {
    const p = this.houseNodes[i].node.getAbsolutePosition();
    return new Vector3(p.x, this.heightAt(p.x, p.z) + 5.0, p.z);
  }

  /** Set a house alight (each house burns once); false if it was burning already or does not exist. */
  burn(i: number) {
    if (this.houses.has(i) || !this.houseNodes[i] || this.fx.isDisposed) return false;
    const r = this.roof(i);
    // the first two burning houses light their surroundings
    const hs = [
      this.fx.fire(r, 2.4, { light: this.houses.size < 2 }),
      this.fx.fire(r.add(new Vector3(rand(-2.5, -1), -1.4, rand(-2, 2))), 1.4, { sound: false, smoke: false }),
      this.fx.fire(r.add(new Vector3(rand(1, 2.5), -1.6, rand(-2, 2))), 1.2, { sound: false, smoke: false }),
    ];
    if (this.isPaused) for (const h of hs) h.pause();
    this.houses.set(i, hs);
    return true;
  }

  /** Make sure these houses burn (a chapter resumed after the raid). */
  ensure(indices: Iterable<number>) {
    for (const i of indices) this.burn(i);
  }

  /** Keep a scripted fire burning with the town (it pauses and resumes with it). */
  track(h: FireHandle) {
    this.extra.add(h);
    if (this.isPaused) h.pause();
    return h;
  }

  private all() {
    return [...[...this.houses.values()].flat(), ...this.extra];
  }

  pause() {
    if (this.isPaused) return;
    this.isPaused = true;
    for (const h of this.all()) h.pause();
  }

  resume() {
    if (!this.isPaused) return;
    this.isPaused = false;
    for (const h of this.all()) h.resume();
  }

  /** Put every fire out (they die down). */
  dispose() {
    for (const h of this.all()) h.stop();
    this.houses.clear();
    this.extra.clear();
  }
}
