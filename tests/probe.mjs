// Debug probe: start the cart ride, then run snippets against window.__game and screenshot.
import { chromium } from "playwright-core";
const WEBGPU = !!process.env.WEBGPU;
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...(WEBGPU ? ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"] : [])],
});
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("request", (r) => { if (!r.url().startsWith("http://localhost")) logs.push(`[external] ${r.url()}`); });
await page.goto("http://localhost:4173/?" + (WEBGPU ? "" : "webgl&") + "debug" + (process.env.Q ?? ""));
await page.waitForFunction(() => performance.getEntriesByName("menu-3d-ready").length > 0, null, { timeout: 60000 });
await page.click("text=新游戏");
try {
  await page.waitForFunction(() => performance.getEntriesByName("cart-started").length > 0, null, { timeout: 120000 });
} catch (e) {
  console.log(logs.join("\n"));
  await page.screenshot({ path: `/tmp/claude-0/shots/probe-fail.png` });
  throw e;
}
const steps = process.argv[2] ? (await import(process.argv[2])).default : [];
let i = 0;
for (const js of steps) {
  const r = await page.evaluate(js).catch((e) => "ERR " + e.message);
  if (r !== undefined) console.log("eval:", typeof r === "string" ? r : JSON.stringify(r));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `/tmp/claude-0/shots/probe-${i++}.png` });
}
console.log(logs.slice(0, 40).join("\n"));
await browser.close();
