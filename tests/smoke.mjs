// Quick visual smoke test: open the game, start a new game, screenshot along the way.
//   node tests/smoke.mjs [--webgpu] [--url http://localhost:4173/] [--out dir] [--secs 20]
import { chromium } from "playwright-core";
import fs from "node:fs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const URL_ = arg("url", "http://localhost:4173/");
const OUT = arg("out", "/tmp/claude-0/shots");
const SECS = +arg("secs", 20);
fs.mkdirSync(OUT, { recursive: true });
const webgpu = process.argv.includes("--webgpu");
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...(webgpu ? ["--enable-unsafe-webgpu", "--enable-features=Vulkan"] : [])],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(URL_ + (webgpu ? "" : "?webgl&debug"));
await page.waitForFunction(() => performance.getEntriesByName("menu-interactive").length > 0, null, { timeout: 30000 });
console.log("menu interactive", Date.now() - t0, "ms");
await page.waitForFunction(() => performance.getEntriesByName("menu-3d-ready").length > 0, null, { timeout: 60000 }).catch(() => console.log("menu 3d not ready"));
console.log("menu 3d ready", Date.now() - t0, "ms");
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/01-menu.png` });
const t1 = Date.now();
await page.click("text=新游戏");
await page.waitForFunction(() => performance.getEntriesByName("cart-started").length > 0, null, { timeout: 180000 }).catch(() => console.log("cart not started"));
console.log("cart started", Date.now() - t1, "ms after click");
for (let i = 0; i < SECS; i += 5) {
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/02-cart-${String(i).padStart(3, "0")}.png` });
}
console.log(logs.filter((l) => !l.includes("[timing]")).slice(0, 60).join("\n"));
console.log(logs.filter((l) => l.includes("[timing]")).join("\n"));
await browser.close();
