// Minimal Radiance .hdr (RGBE) reader/writer, enough to downsample an HDRI for runtime IBL.

export function readHDR(buf) {
  let p = 0;
  const line = () => {
    let s = "";
    while (buf[p] !== 0x0a) s += String.fromCharCode(buf[p++]);
    p++;
    return s;
  };
  if (!line().startsWith("#?")) throw new Error("not an HDR file");
  for (;;) {
    const l = line();
    if (l === "") break;
  }
  const dims = line().split(/\s+/); // -Y h +X w
  const h = +dims[1], w = +dims[3];
  const rgbe = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const isRLE = buf[p] === 2 && buf[p + 1] === 2 && !(buf[p + 2] & 0x80);
    if (!isRLE) {
      rgbe.set(buf.subarray(p, p + w * 4), y * w * 4);
      p += w * 4;
      continue;
    }
    p += 4;
    for (let c = 0; c < 4; c++) {
      let x = 0;
      while (x < w) {
        let count = buf[p++];
        if (count > 128) {
          count -= 128;
          const v = buf[p++];
          for (let k = 0; k < count; k++) rgbe[(y * w + x++) * 4 + c] = v;
        } else {
          for (let k = 0; k < count; k++) rgbe[(y * w + x++) * 4 + c] = buf[p++];
        }
      }
    }
  }
  const f = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const e = rgbe[i * 4 + 3];
    const s = e ? Math.pow(2, e - 136) : 0;
    f[i * 3] = rgbe[i * 4] * s;
    f[i * 3 + 1] = rgbe[i * 4 + 1] * s;
    f[i * 3 + 2] = rgbe[i * 4 + 2] * s;
  }
  return { w, h, data: f };
}

export function downsample({ w, h, data }, W, H) {
  const out = new Float32Array(W * H * 3);
  const fx = w / W, fy = h / H;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = Math.floor(y * fy); yy < Math.floor((y + 1) * fy); yy++)
        for (let xx = Math.floor(x * fx); xx < Math.floor((x + 1) * fx); xx++) {
          const i = (yy * w + xx) * 3;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
        }
      const o = (y * W + x) * 3;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
    }
  return { w: W, h: H, data: out };
}

export function writeHDR({ w, h, data }) {
  const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, "ascii");
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const m = Math.max(r, g, b);
    if (m < 1e-32) continue;
    const e = Math.ceil(Math.log2(m));
    const s = 256 / Math.pow(2, e);
    px[i * 4] = Math.min(255, r * s);
    px[i * 4 + 1] = Math.min(255, g * s);
    px[i * 4 + 2] = Math.min(255, b * s);
    px[i * 4 + 3] = e + 128;
  }
  // New-style RLE scanlines made of literal runs only (always unambiguous for readers).
  const parts = [header];
  for (let y = 0; y < h; y++) {
    parts.push(Buffer.from([2, 2, w >> 8, w & 255]));
    for (let c = 0; c < 4; c++) {
      for (let x = 0; x < w; x += 128) {
        const n = Math.min(128, w - x);
        const chunk = Buffer.alloc(n + 1);
        chunk[0] = n;
        for (let k = 0; k < n; k++) chunk[k + 1] = px[(y * w + x + k) * 4 + c];
        parts.push(chunk);
      }
    }
  }
  return Buffer.concat(parts);
}
