// Spider-web texture atlas (design §10.1 "fx/webs", research environment.md §7): procedural SVG
// rasterised by sharp (librsvg). 1024² RGBA, 2×2 quadrants of 512² with an 8 px gutter:
//
//   orb (top-left)      radial orb web, alpha = threads          corner (top-right)  fan from the
//   sheet (bottom-left) dense irregular sheet for web walls       quadrant's top-left corner
//   cocoon (bottom-right) opaque silk wrap (alpha 1), tiles in u
//
// Web quadrants are white in RGB everywhere (alpha carries the threads) so mipmaps don't darken
// the edges. UV rectangles for each quadrant are exported as WEB_UV in glTF convention (v down).
import sharp from "sharp";

export const ATLAS = 1024;
const Q = 512, GUT = 8;
/** [u0, v0, u1, v1] of each quadrant's usable area, glTF UV space (origin top-left). */
export const WEB_UV = Object.fromEntries(
  Object.entries({ orb: [0, 0], corner: [1, 0], sheet: [0, 1], cocoon: [1, 1] }).map(([k, [qx, qy]]) => [
    k,
    [(qx * Q + GUT) / ATLAS, (qy * Q + GUT) / ATLAS, ((qx + 1) * Q - GUT) / ATLAS, ((qy + 1) * Q - GUT) / ATLAS],
  ]),
);

function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const f = (v) => v.toFixed(1);

/** Orb web centred in a size² square. */
function orb(R, size) {
  const C = size / 2, rad = size * 0.47;
  const spokes = 17;
  const ang = [...Array(spokes)].map((_, i) => (i / spokes) * Math.PI * 2 + (R() - 0.5) * 0.25);
  const len = ang.map(() => rad * (0.82 + R() * 0.18));
  let out = "";
  for (let i = 0; i < spokes; i++) out += `<path d="M${f(C)} ${f(C)} L${f(C + Math.cos(ang[i]) * len[i])} ${f(C + Math.sin(ang[i]) * len[i])}" stroke-width="2.6"/>`;
  // frame threads between spoke tips
  let fr = "";
  for (let i = 0; i <= spokes; i++) {
    const a = ang[i % spokes], l = len[i % spokes];
    fr += `${i ? "L" : "M"}${f(C + Math.cos(a) * l)} ${f(C + Math.sin(a) * l)}`;
  }
  out += `<path d="${fr}" stroke-width="2.4"/>`;
  // capture spiral: sagging segments between neighbouring spokes
  for (let r = 16; r < rad * 0.93; r += 7 + r * 0.04) {
    let d = "";
    for (let i = 0; i <= spokes; i++) {
      const a = ang[i % spokes], rr = Math.min(r + i * 0.4, len[i % spokes] * 0.97);
      const x = C + Math.cos(a) * rr, y = C + Math.sin(a) * rr;
      if (!i) {
        d += `M${f(x)} ${f(y)}`;
        continue;
      }
      if (R() < 0.07) {
        d += ` M${f(x)} ${f(y)}`; // broken thread
        continue;
      }
      const a0 = ang[(i - 1) % spokes], a1 = a < a0 ? a + Math.PI * 2 : a, am = (a0 + a1) / 2, sag = rr * 0.92;
      d += ` Q${f(C + Math.cos(am) * sag)} ${f(C + Math.sin(am) * sag)} ${f(x)} ${f(y)}`;
    }
    out += `<path d="${d}" stroke-width="1.9"/>`;
  }
  return out;
}

/** Fan web anchored at the square's top-left corner (0, 0). */
function corner(R, size) {
  const n = 11, rad = size * 0.95;
  const ang = [...Array(n)].map((_, i) => (i / (n - 1)) * (Math.PI / 2) * 0.96 + 0.02 + (R() - 0.5) * 0.06);
  const len = ang.map(() => rad * (0.78 + R() * 0.2));
  let out = "";
  for (let i = 0; i < n; i++) out += `<path d="M2 2 L${f(Math.cos(ang[i]) * len[i])} ${f(Math.sin(ang[i]) * len[i])}" stroke-width="2.6"/>`;
  for (let r = 22; r < rad * 0.9; r += 9 + r * 0.05) {
    let d = "";
    for (let i = 0; i < n; i++) {
      const rr = Math.min(r * (0.95 + R() * 0.1), len[i] * 0.97);
      const x = Math.cos(ang[i]) * rr, y = Math.sin(ang[i]) * rr;
      if (!i || R() < 0.08) {
        d += ` M${f(x)} ${f(y)}`;
        continue;
      }
      const am = (ang[i] + ang[i - 1]) / 2, sag = rr * 0.9;
      d += ` Q${f(Math.cos(am) * sag)} ${f(Math.sin(am) * sag)} ${f(x)} ${f(y)}`;
    }
    out += `<path d="${d}" stroke-width="1.9"/>`;
  }
  return out;
}

/** Dense irregular sheet web (web walls): strands between random edge points, a few hubs, a haze. */
function sheet(R, size) {
  let out = `<rect x="0" y="0" width="${size}" height="${size}" fill="url(#haze)" stroke="none"/>`;
  const edge = () => {
    const t = R() * size, s = Math.floor(R() * 4);
    return s === 0 ? [t, 1] : s === 1 ? [size - 1, t] : s === 2 ? [t, size - 1] : [1, t];
  };
  for (let i = 0; i < 150; i++) {
    const [x0, y0] = edge(), [x1, y1] = edge();
    const mx = (x0 + x1) / 2 + (R() - 0.5) * 60, my = (y0 + y1) / 2 + R() * 40;
    out += `<path d="M${f(x0)} ${f(y0)} Q${f(mx)} ${f(my)} ${f(x1)} ${f(y1)}" stroke-width="${f(1.5 + R() * 1.4)}" opacity="${(0.55 + R() * 0.45).toFixed(2)}"/>`;
  }
  // a few hubs with short radiating threads
  for (let h = 0; h < 5; h++) {
    const cx = size * (0.2 + R() * 0.6), cy = size * (0.2 + R() * 0.6);
    for (let k = 0; k < 9; k++) {
      const a = R() * Math.PI * 2, l = 40 + R() * 110;
      out += `<path d="M${f(cx)} ${f(cy)} L${f(cx + Math.cos(a) * l)} ${f(cy + Math.sin(a) * l)}" stroke-width="1.8"/>`;
    }
  }
  // heavier anchor lines along the borders, where the sheet is glued to the rock
  for (let i = 0; i < 4; i++) out += `<rect x="${3 + i * 4}" y="${3 + i * 4}" width="${size - 6 - i * 8}" height="${size - 6 - i * 8}" fill="none" stroke-width="${2.6 - i * 0.4}" opacity="${0.8 - i * 0.15}"/>`;
  return out;
}

/** Silk wrap: opaque, strands at shallow angles; wraps around u. */
function cocoon(R, size) {
  let out = `<rect x="0" y="0" width="${size}" height="${size}" fill="#c4c0b4"/>`;
  for (let i = 0; i < 260; i++) {
    const y = R() * size, slope = (R() - 0.5) * 0.9, g = Math.floor(150 + R() * 100);
    const w = 1.2 + R() * 3.2;
    for (const dx of [-size, 0, size]) {
      const x0 = dx - 20, x1 = dx + size + 20;
      out += `<path d="M${f(x0)} ${f(y)} Q${f(dx + size / 2)} ${f(y + slope * size * 0.5 + (R() - 0.5) * 30)} ${f(x1)} ${f(y + slope * size)}" stroke="rgb(${g},${g},${g - 8})" stroke-width="${f(w)}" opacity="0.55" fill="none"/>`;
    }
  }
  return out;
}

/** @returns {Promise<Buffer>} PNG 1024² RGBA */
export async function buildWebAtlas({ seed = 11 } = {}) {
  const R = rng(seed);
  const inner = Q - 2 * GUT;
  const g = (qx, qy, body, attrs = "") => `<g transform="translate(${qx * Q + GUT} ${qy * Q + GUT})" ${attrs}>${body}</g>`;
  const webAttrs = `fill="none" stroke="#fff" stroke-linecap="round"`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ATLAS}" height="${ATLAS}">
<defs><radialGradient id="haze" cx="0.5" cy="0.5" r="0.7"><stop offset="0" stop-color="#fff" stop-opacity="0.16"/><stop offset="1" stop-color="#fff" stop-opacity="0.05"/></radialGradient>
<clipPath id="q"><rect x="0" y="0" width="${inner}" height="${inner}"/></clipPath></defs>
${g(0, 0, orb(R, inner), `${webAttrs} clip-path="url(#q)" opacity="0.95"`)}
${g(1, 0, corner(R, inner), `${webAttrs} clip-path="url(#q)" opacity="0.95"`)}
${g(0, 1, sheet(R, inner), `${webAttrs} clip-path="url(#q)"`)}
</svg>`;
  const webs = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
  // white RGB under every web pixel (alpha keeps the threads)
  for (let i = 0; i < webs.length; i += 4) {
    webs[i] = 255;
    webs[i + 1] = 255;
    webs[i + 2] = 255;
  }
  // cocoon quadrant: opaque, rendered on its own then pasted in (and its gutter filled by edge pixels)
  const csvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Q}" height="${Q}"><g transform="translate(0 0)">${cocoon(R, Q)}</g></svg>`;
  const coc = await sharp(Buffer.from(csvg)).blur(0.6).ensureAlpha().raw().toBuffer();
  for (let y = 0; y < Q; y++)
    for (let x = 0; x < Q; x++) {
      const s = (y * Q + x) * 4, d = ((Q + y) * ATLAS + (Q + x)) * 4;
      webs[d] = coc[s];
      webs[d + 1] = coc[s + 1];
      webs[d + 2] = coc[s + 2];
      webs[d + 3] = 255;
    }
  return sharp(webs, { raw: { width: ATLAS, height: ATLAS, channels: 4 } }).png().toBuffer();
}
