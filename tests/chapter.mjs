// Debug run of one chapter: `CH=execution TS=4 node tests/chapter.mjs` — logs each subtitle with a
// screenshot (/tmp/claude-0/shots/c-NN.png), fills in the creator if it opens, stops at the end card
// or when the next chapter starts.
import { chromium } from "playwright-core";
const WEBGPU = !!process.env.WEBGPU;
const CH = process.env.CH ?? "muster", TS = process.env.TS ?? "4", LIMIT = +(process.env.LIMIT ?? 400);
const SHOTS = process.env.SHOTS ?? "/tmp/claude-0/shots";
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...(WEBGPU ? ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"] : [])],
});
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:4173/?${WEBGPU ? "" : "webgl&"}debug&chapter=${CH}&timescale=${TS}${process.env.Q ?? ""}`);
await page.waitForFunction(() => performance.getEntriesByName("menu-3d-ready").length > 0, null, { timeout: 60000 });
await page.click("text=新游戏");
await page.waitForFunction(() => performance.getEntriesByName("cart-started").length > 0, null, { timeout: 120000 });
const t0 = Date.now();
let i = 0, last = "";
const state = () => page.evaluate(() => ({ sub: document.getElementById("subtitle")?.textContent ?? "", ch: window.__game?.stage?.chapter?.id, end: !!document.getElementById("endcard"), creator: !!document.getElementById("creator") }));
while (Date.now() - t0 < LIMIT * 1000) {
  const s = await state();
  if (s.end || (s.ch && s.ch !== CH)) { console.log("chapter ended →", s.end ? "endcard" : s.ch); break; }
  if (s.creator) {
    await page.fill("#creator input[type=text]", "测试者");
    await page.click("#creator [data-act=done]");
  }
  if (s.sub !== last) {
    last = s.sub;
    const n = String(i++).padStart(2, "0");
    console.log(n, ((Date.now() - t0) / 1000).toFixed(1), s.sub);
    if (process.env.DUMP) console.log("   ", await page.evaluate(process.env.DUMP).then((v) => JSON.stringify(v), (e) => "ERR " + e.message));
    await page.screenshot({ path: `${SHOTS}/c-${n}.png` });
  }
  await page.waitForTimeout(250);
}
await page.screenshot({ path: `${SHOTS}/c-end.png` });
console.log(logs.filter((l) => !/\[timing\]|BJS -/.test(l)).slice(0, 30).join("\n"));
await browser.close();
