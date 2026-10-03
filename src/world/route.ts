import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** Road centre line sampled every metre (built by tools/gen/world.mjs). */
export class Route {
  readonly length: number;
  constructor(private readonly r: { x: number[]; y: number[]; z: number[] }) {
    this.length = r.x.length - 1;
  }

  /** Position at distance s (metres from the start), linearly interpolated. */
  pos(s: number, out = new Vector3()) {
    const c = Math.min(Math.max(s, 0), this.length - 1e-4);
    const i = Math.floor(c), f = c - i;
    const { x, y, z } = this.r;
    return out.set(x[i] + (x[i + 1] - x[i]) * f, y[i] + (y[i + 1] - y[i]) * f, z[i] + (z[i + 1] - z[i]) * f);
  }

  /** Unit tangent (direction of travel) at s, smoothed over +-2 m. */
  dir(s: number, out = new Vector3()) {
    const a = this.pos(s - 2), b = this.pos(s + 2);
    return out.copyFrom(b).subtractInPlace(a).normalize();
  }

  /** Yaw (about +Y, right-handed) that turns local -Z to face along the route at s. */
  yaw(s: number) {
    const d = this.dir(s);
    return Math.atan2(-d.x, -d.z);
  }
}
