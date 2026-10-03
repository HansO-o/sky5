// Subsets Noto Serif SC (SIL OFL 1.1) to the characters the menus and HUD labels use, via the
// Google Fonts `text=` API, and stores the woff2 files in src/assets/fonts (bundled by Vite, so the
// service worker caches them with the app shell). Re-run after changing UI strings.
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const files = ["index.html", "src/main.ts", "src/game/Game.ts", "src/core/settings.ts", "src/world/appearance.ts", "src/prologue/PrologueStage.ts"];
for (const f of await fs.readdir(path.join(ROOT, "src/ui"))) if (f.endsWith(".ts")) files.push(`src/ui/${f}`);
let text = "";
for (const f of files) text += await fs.readFile(path.join(ROOT, f), "utf8");
// chapter labels and objective toasts
for (const f of await fs.readdir(path.join(ROOT, "src/prologue/chapters"))) {
  const s = await fs.readFile(path.join(ROOT, "src/prologue/chapters", f), "utf8");
  for (const m of s.matchAll(/(?:hud\.toast\(|label = )"([^"]+)"/g)) text += m[1];
}
const cjk = [...new Set(text.match(/[　-〿一-鿿＀-￯·—…“”‘’]/g))].sort().join("");
const chars = cjk + "0123456789%°.:/-+ ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
console.log(`${cjk.length} CJK/punctuation glyphs`);
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
for (const w of [400, 700]) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@${w}&text=${encodeURIComponent(chars)}`, { headers: { "User-Agent": UA } })).text();
  const url = css.match(/url\((https:[^)]+)\)/)?.[1];
  if (!url) throw new Error("no font url in:\n" + css);
  const buf = Buffer.from(await (await fetch(url, { headers: { "User-Agent": UA } })).arrayBuffer());
  const out = path.join(ROOT, `src/assets/fonts/ui-serif-${w}.woff2`);
  await fs.writeFile(out, buf);
  console.log(path.relative(ROOT, out), (buf.length / 1024).toFixed(0), "KB");
}
