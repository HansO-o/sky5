// Acceptance test for M1 loading/caching targets. Starts a throttled server (20 Mbps, 20 ms) over
// dist/ and drives headless Chromium:
//   1. first visit: menu interactive time, then "新游戏" immediately, time until the ride starts
//   2. second visit: menu interactive time (IndexedDB + service worker)
//   3. offline after everything is cached: start a new game and ride to the end (accelerated)
//
//   node tests/e2e.mjs [--mbps 20] [--webgpu]
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import path from "node:path";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const MBPS = arg("mbps", "20");
const PORT = 4190;
const ROOT = path.resolve(import.meta.dirname, "..");
const server = spawn("node", [path.join(ROOT, "tools/serve.mjs"), "--port", String(PORT), "--mbps", MBPS, "--latency", "20"], { stdio: "inherit" });
await new Promise((r) => setTimeout(r, 800));
const BASE = `http://localhost:${PORT}/`;
const webgpu = process.argv.includes("--webgpu");
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...(webgpu ? ["--enable-unsafe-webgpu", "--enable-features=Vulkan"] : [])],
});
// one persistent profile so the second visit sees IndexedDB + the service worker
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const errors = [];
// page errors and console errors from every visit fail the run
const watch = (page) => {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
    if (m.text().includes("[timing]")) console.log("    " + m.text());
  });
};
const mark = (page, name, timeout) => page.waitForFunction((n) => performance.getEntriesByName(n).length > 0, name, { timeout });
const markTime = (page, name) => page.evaluate((n) => performance.getEntriesByName(n)[0]?.startTime ?? -1, name);
const q = webgpu ? "?debug" : "?webgl&debug";

try {
  // ---------------------------------------------------------------- 1. first visit
  let page = await ctx.newPage();
  watch(page);
  await page.goto(BASE + q);
  await mark(page, "menu-interactive", 30000);
  const mi = await markTime(page, "menu-interactive");
  check("first visit: menu interactive <= 3 s", mi <= 3000, `${mi.toFixed(0)} ms`);
  await mark(page, "menu-3d-ready", 60000);
  // first-screen bytes: everything the page itself fetched until the 3D menu was up (the asset
  // worker's background downloads are not part of the page's resource timeline)
  const fs1 = await page.evaluate(() => {
    const t = performance.getEntriesByName("menu-3d-ready")[0].startTime;
    const r = performance.getEntriesByType("resource").filter((e) => e.startTime <= t);
    const nav = performance.getEntriesByType("navigation")[0];
    return r.reduce((s, e) => s + (e.transferSize || e.encodedBodySize || 0), nav.transferSize || 0);
  });
  // the menu's own scene data (smoke sprite) comes through the asset worker
  check("first screen <= 2.5 MB (brotli)", fs1 < 2.5e6, `${(fs1 / 1e6).toFixed(2)} MB page resources + menu/smoke`);
  const t0 = Date.now();
  await page.click("text=新游戏");
  await mark(page, "cart-started", 120000);
  const cs = Date.now() - t0;
  check("first visit: ride starts <= 10 s after 新游戏", cs <= 10000, `${cs} ms (software GL; includes shader compile)`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "/tmp/claude-0/shots/e2e-ride.png" });
  // let the background download finish (the whole prologue manifest)
  const t1 = Date.now();
  await page.waitForFunction(
    () => {
      const p = window.__game && (window.__assetsProgress?.() ?? null);
      return p && p.done >= p.total;
    },
    null,
    { timeout: 600000, polling: 1000 },
  );
  check("background download completes", true, `${((Date.now() - t1) / 1000).toFixed(0)} s after ride start`);
  await page.close();

  // ---------------------------------------------------------------- 2. second visit
  page = await ctx.newPage();
  watch(page);
  await page.goto(BASE + q);
  await mark(page, "menu-interactive", 30000);
  const mi2 = await markTime(page, "menu-interactive");
  check("second visit: menu interactive <= 1 s", mi2 <= 1000, `${mi2.toFixed(0)} ms`);
  const sw = await page.evaluate(() => !!navigator.serviceWorker.controller);
  check("second visit: served by service worker", sw, String(sw));
  await page.close();

  // ---------------------------------------------------------------- 3. offline play-through
  await ctx.setOffline(true);
  page = await ctx.newPage();
  watch(page);
  await page.goto(BASE + q + "&timescale=25");
  await mark(page, "menu-3d-ready", 60000);
  const t2 = Date.now();
  await page.click("text=新游戏");
  await mark(page, "cart-started", 120000);
  check("offline: ride starts", true, `${Date.now() - t2} ms`);
  // the ride plays in full; later chapters start (their assets come from the cache) and are skipped
  const chapter = () => page.evaluate(() => window.__game?.stage?.chapter?.id ?? null);
  await page.waitForFunction(() => window.__game?.stage?.chapter?.id === "muster", null, { timeout: 900000 });
  check("offline: ride plays through to the town", true, "");
  for (const next of ["execution", "dragon"]) {
    await page.waitForTimeout(3000);
    await page.evaluate(() => { void window.__game.stage.skipChapter(); });
    await page.waitForFunction((n) => window.__game?.stage?.chapter?.id === n, next, { timeout: 300000 });
    check(`offline: ${next} starts`, true, String(await chapter()));
  }
  await page.waitForTimeout(3000);
  await page.evaluate(() => { void window.__game.stage.skipChapter(); });
  await page.waitForSelector("#endcard", { timeout: 120000 });
  check("offline: plays through to the end card", true, "");
  await page.screenshot({ path: "/tmp/claude-0/shots/e2e-end.png" });
  await page.close();
  await ctx.setOffline(false);
} catch (e) {
  check("run", false, String(e));
} finally {
  if (errors.length) console.log("page errors:\n  " + [...new Set(errors)].slice(0, 20).join("\n  "));
  check("no page or console errors", errors.length === 0, `${errors.length}`);
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
