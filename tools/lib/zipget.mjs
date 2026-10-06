// Pull chosen entries out of a remote zip with HTTP Range requests (central directory, then each
// local header + its data), so a 150 MB pack costs only the files it is used for. Falls back to one
// full download when the server ignores Range. Also the itch.io free-download handshake.
//
//   import { itchSignedUrl, zipExtract } from "./lib/zipget.mjs";
//   const url = await itchSignedUrl("https://quaternius.itch.io/fantasy-props-megakit", 13887750);
//   await zipExtract(url, /^Exports\/glTF\/Barrel\.(gltf|bin)$/, "assets-src/props/fpm", { strip: "Exports/glTF/" });
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

async function retry(fn, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
}

/** itch.io free download: game page -> csrf token -> POST for a short-lived signed URL. */
export async function itchSignedUrl(gameUrl, uploadId) {
  return retry(async () => {
    const page = await fetch(gameUrl);
    const cookies = page.headers.getSetCookie?.().map((c) => c.split(";")[0]).join("; ") ?? "";
    const html = await page.text();
    const token = html.match(/name="csrf_token" value="([^"]+)"/)?.[1];
    if (!token) throw new Error(`no csrf token on ${gameUrl}`);
    const r = await fetch(`${gameUrl}/file/${uploadId}?source=game_download`, {
      method: "POST",
      headers: { cookie: cookies, "content-type": "application/x-www-form-urlencoded" },
      body: `csrf_token=${encodeURIComponent(token)}`,
    });
    const { url } = await r.json();
    if (!url) throw new Error(`itch.io gave no download url for ${gameUrl} (upload ${uploadId})`);
    return url;
  });
}

/** Bytes a..b (inclusive) of url; null when the server answers without honouring Range. */
async function range(url, a, b) {
  return retry(async () => {
    const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` } });
    if (r.status === 200) {
      await r.body?.cancel();
      return null;
    }
    if (r.status !== 206) throw new Error(`${r.status} for range ${a}-${b} of ${url}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length !== b - a + 1) throw new Error(`short range ${a}-${b}: ${buf.length} bytes`);
    return buf;
  });
}

/** Where the central directory is, from the zip's last bytes (`tail`, holding the end record). */
function centralDirectory(tail) {
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip (no end of central directory)");
  let size = tail.readUInt32LE(eocd + 12), offset = tail.readUInt32LE(eocd + 16);
  const loc64 = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]));
  if (loc64 >= 0) {
    size = Number(tail.readBigUInt64LE(loc64 + 40));
    offset = Number(tail.readBigUInt64LE(loc64 + 48));
  }
  return { size, offset };
}

function parseEntries(cd) {
  const out = [];
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const method = cd.readUInt16LE(p + 10);
    let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
    const fl = cd.readUInt16LE(p + 28), el = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
    let off = cd.readUInt32LE(p + 42);
    const name = cd.subarray(p + 46, p + 46 + fl).toString("utf8");
    if (off === 0xffffffff || csize === 0xffffffff || usize === 0xffffffff) {
      // zip64 extra field: the 64-bit values appear in this order, each only if its 32-bit one is saturated
      const ex = cd.subarray(p + 46 + fl, p + 46 + fl + el);
      for (let q = 0; q + 4 <= ex.length; ) {
        const id = ex.readUInt16LE(q), sz = ex.readUInt16LE(q + 2);
        if (id === 1) {
          let k = q + 4;
          if (usize === 0xffffffff) (usize = Number(ex.readBigUInt64LE(k))), (k += 8);
          if (csize === 0xffffffff) (csize = Number(ex.readBigUInt64LE(k))), (k += 8);
          if (off === 0xffffffff) off = Number(ex.readBigUInt64LE(k));
        }
        q += 4 + sz;
      }
    }
    out.push({ name, method, csize, usize, off });
    p += 46 + fl + el + cl;
  }
  return out;
}

/**
 * Extract the entries of the remote zip whose path matches `pattern` into `destDir`.
 * `strip`: a path prefix removed from each entry's name; `rename(name)`: final relative name.
 * Existing files are kept. Returns the relative names written or found.
 */
export async function zipExtract(url, pattern, destDir, { strip = "", rename } = {}) {
  const head = await retry(async () => {
    const r = await fetch(url, { headers: { Range: "bytes=0-0" } });
    await r.body?.cancel();
    return r;
  });
  const total = Number(head.headers.get("content-range")?.split("/")[1]);
  let whole = null;
  if (head.status !== 206 || !Number.isFinite(total)) {
    // no Range support: one full download
    whole = await retry(async () => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return Buffer.from(await r.arrayBuffer());
    });
  }
  const read = async (a, b) => (whole ? whole.subarray(a, b + 1) : (await range(url, a, b)) ?? (whole = await (await fetch(url)).arrayBuffer().then((x) => Buffer.from(x))).subarray(a, b + 1));
  const size = whole ? whole.length : total;
  const tailLen = Math.min(size, 1 << 20);
  const tail = await read(size - tailLen, size - 1);
  const cdLoc = centralDirectory(tail);
  const entries = parseEntries(await read(cdLoc.offset, cdLoc.offset + cdLoc.size - 1));
  const want = entries.filter((e) => pattern.test(e.name) && !e.name.endsWith("/"));
  const names = [];
  await Promise.all(
    want.map(async (e) => {
      let rel = e.name.startsWith(strip) ? e.name.slice(strip.length) : e.name;
      if (rename) rel = rename(rel);
      const dest = path.join(destDir, rel);
      names.push(rel);
      if (await fs.access(dest).then(() => true, () => false)) return;
      const lh = await read(e.off, e.off + 29);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error(`bad local header for ${e.name}`);
      const start = e.off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const raw = e.csize ? await read(start, start + e.csize - 1) : Buffer.alloc(0);
      const data = e.method === 8 ? zlib.inflateRawSync(raw) : e.method === 0 ? raw : null;
      if (!data) throw new Error(`${e.name}: unsupported zip method ${e.method}`);
      if (data.length !== e.usize) throw new Error(`${e.name}: inflated to ${data.length} bytes, expected ${e.usize}`);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest + ".part", data);
      await fs.rename(dest + ".part", dest);
    }),
  );
  return names.sort();
}
