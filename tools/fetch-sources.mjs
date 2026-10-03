// Downloads third-party source assets into assets-src/ (idempotent: existing files are skipped)
// and writes assets-src/credits.json with author + licence for every asset.
import fs from "node:fs/promises";
import path from "node:path";
import { PH_TEXTURES, PH_MODEL_TEXTURES, PH_MODELS, PH_HDRIS } from "./sources.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "assets-src");
const API = "https://api.polyhaven.com";

async function json(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  if (await exists(dest)) return false;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      const buf = Buffer.from(await r.arrayBuffer());
      await fs.writeFile(dest + ".part", buf);
      await fs.rename(dest + ".part", dest);
      return true;
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
}

const credits = [];
async function credit(id, kind) {
  const info = await json(`${API}/info/${id}`);
  credits.push({
    id,
    kind,
    name: info.name,
    authors: Object.keys(info.authors ?? {}),
    source: `https://polyhaven.com/a/${id}`,
    license: "CC0 1.0",
    licenseUrl: "https://polyhaven.com/license",
  });
}

const jobs = [];
const limit = 6;
async function runAll() {
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      await job();
    }
  });
  await Promise.all(workers);
}

for (const [id, { res, maps }] of Object.entries(PH_TEXTURES)) {
  jobs.push(async () => {
    const files = await json(`${API}/files/${id}`);
    for (const m of maps) {
      const f = files[m][res].jpg;
      const did = await download(f.url, path.join(SRC, "textures", id, `${m}.jpg`));
      if (did) console.log("tex", id, m, (f.size / 1e6).toFixed(1), "MB");
    }
    await credit(id, "texture");
  });
}

for (const [id, { res, maps }] of Object.entries(PH_MODEL_TEXTURES)) {
  jobs.push(async () => {
    const files = await json(`${API}/files/${id}`);
    for (const m of maps) {
      const f = files[m][res].jpg ?? files[m][res].png;
      const ext = files[m][res].jpg ? "jpg" : "png";
      const did = await download(f.url, path.join(SRC, "textures", id, `${m}.${ext}`));
      if (did) console.log("tex", id, m);
    }
    await credit(id, "texture");
  });
}

for (const [id, res] of Object.entries(PH_MODELS)) {
  jobs.push(async () => {
    const files = await json(`${API}/files/${id}`);
    const g = files.gltf[res].gltf;
    const dir = path.join(SRC, "models", id);
    await download(g.url, path.join(dir, `${id}.gltf`));
    for (const [rel, inc] of Object.entries(g.include)) {
      await download(inc.url, path.join(dir, rel));
    }
    console.log("model", id);
    await credit(id, "model");
  });
}

for (const [id, { hdrRes }] of Object.entries(PH_HDRIS)) {
  jobs.push(async () => {
    const files = await json(`${API}/files/${id}`);
    await download(files.hdri[hdrRes].hdr.url, path.join(SRC, "hdri", id, `${id}.hdr`));
    await download(files.tonemapped.url, path.join(SRC, "hdri", id, `${id}_tonemapped.jpg`));
    console.log("hdri", id);
    await credit(id, "hdri");
  });
}

await runAll();
credits.sort((a, b) => a.id.localeCompare(b.id));
await fs.writeFile(path.join(SRC, "credits-polyhaven.json"), JSON.stringify(credits, null, 2));
console.log("done,", credits.length, "assets");
