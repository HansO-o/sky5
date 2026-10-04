// Tileable water normal map (design §4.3 "Water", research environment.md §6): a height field made
// of sines with integer wavevectors, so it repeats seamlessly in u and v and needs no licence.
// Encoded in the OpenGL convention (+Y up, like Poly Haven nor_gl and glTF normal textures).
// Self-contained: returns PNG bytes; the caller encodes KTX2 (preset "normal").
import sharp from "sharp";

/** Deterministic PRNG (Park–Miller). */
function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * The wave set: integer wavevectors (cycles per tile) biased across the flow (u is the flow
 * direction on the ribbon), amplitudes falling off with frequency.
 */
export function waterWaves({ seed = 7, count = 26 } = {}) {
  const R = rng(seed);
  const waves = [];
  for (let i = 0; i < count; i++) {
    const f = 3 + Math.floor(R() * 14); // 3..16 cycles per tile
    // two thirds roughly across the flow (ripples), the rest in any direction
    const a = i % 3 ? (R() - 0.5) * Math.PI * 0.7 : R() * Math.PI;
    let kx = Math.round(Math.sin(a) * f), ky = Math.round(Math.cos(a) * f);
    if (!kx && !ky) ky = f;
    const k = Math.hypot(kx, ky);
    waves.push({ kx, ky, amp: 1 / k ** 1.25, phase: R() * Math.PI * 2 });
  }
  return waves;
}

/**
 * @returns {Promise<Buffer>} PNG, size × size RGB
 */
export async function buildWaterNormal({ size = 512, strength = 0.9, seed = 7 } = {}) {
  const waves = waterWaves({ seed });
  const buf = Buffer.alloc(size * size * 3);
  const TAU = Math.PI * 2;
  // normalise the slope scale so `strength` is independent of the wave set
  let norm = 0;
  for (const w of waves) norm += w.amp * TAU * Math.hypot(w.kx, w.ky);
  const s = (strength * 2.2) / norm;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let dhdu = 0, dhdv = 0;
      for (const w of waves) {
        const c = Math.cos(TAU * (w.kx * u + w.ky * v) + w.phase) * w.amp * TAU;
        dhdu += c * w.kx;
        dhdv += c * w.ky;
      }
      // image rows grow downward (+v); OpenGL convention: green = +Y = up = −v
      let nx = -dhdu * s, ny = dhdv * s, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * size + x) * 3;
      buf[i] = Math.round((nx * 0.5 + 0.5) * 255);
      buf[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      buf[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  return sharp(buf, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}
