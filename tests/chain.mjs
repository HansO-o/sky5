// New game → skip each chapter in turn (hold Space in the cart, then the pause-menu skip) → end card.
// Checks that every chapter starts, hands over and ends cleanly.
import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 480, height: 270 } })).newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:4173/?webgl&debug&timescale=3`);
await page.waitForFunction(() => performance.getEntriesByName("menu-3d-ready").length > 0, null, { timeout: 60000 });
await page.click("text=新游戏");
await page.waitForFunction(() => performance.getEntriesByName("cart-started").length > 0, null, { timeout: 120000 });
const st = () => page.evaluate(() => ({ ch: window.__game?.stage?.chapter?.id ?? null, sub: document.getElementById("subtitle")?.textContent ?? "", end: !!document.getElementById("endcard") }));
const waitFor = async (pred, ms) => { const t = Date.now(); while (Date.now() - t < ms) { const s = await st(); if (pred(s)) return s; await page.waitForTimeout(500); } return st(); };
console.log("start", await st());
await page.waitForTimeout(5000);
await page.keyboard.down("Space");
await page.waitForTimeout(6000);
await page.keyboard.up("Space");
let s = await waitFor((s) => s.ch === "muster" && s.sub.length > 0, 240000);
console.log("muster:", s);
await page.screenshot({ path: "/tmp/claude-0/shots/chain-muster.png" });
for (const next of ["execution", "dragon"]) {
  await page.evaluate(() => window.__game.stage.skipChapter());
  s = await waitFor((s) => s.ch === next && s.sub.length > 0, 300000);
  console.log(next + ":", s);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `/tmp/claude-0/shots/chain-${next}.png` });
}
await page.evaluate(() => window.__game.stage.skipChapter());
s = await waitFor((s) => s.end, 120000);
console.log("end:", s);
console.log(logs.filter((l) => /error|pageerror|warn/i.test(l)).slice(0, 20).join("\n"));
await browser.close();
