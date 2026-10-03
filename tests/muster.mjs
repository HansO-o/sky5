// Debug run of the muster chapter: roll call → escape/arrow → creator → walk to the square.
import { chromium } from "playwright-core";
const WEBGPU = !!process.env.WEBGPU;
const TS = process.env.TS ?? "4";
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...(WEBGPU ? ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"] : [])],
});
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:4173/?${WEBGPU ? "" : "webgl&"}debug&chapter=muster&timescale=${TS}`);
await page.waitForFunction(() => performance.getEntriesByName("menu-3d-ready").length > 0, null, { timeout: 60000 });
await page.click("text=新游戏");
await page.waitForFunction(() => performance.getEntriesByName("cart-started").length > 0, null, { timeout: 120000 });
const shot = (n) => page.screenshot({ path: `/tmp/claude-0/shots/m-${n}.png` });
const sub = () => page.evaluate(() => document.getElementById("subtitle")?.textContent ?? "");
const t0 = Date.now();
let i = 0, lastSub = "";
// snapshot every subtitle change until the creator opens
while (!(await page.$("#creator")) && Date.now() - t0 < 240000) {
  const s = await sub();
  if (s !== lastSub) {
    lastSub = s;
    console.log(((Date.now() - t0) / 1000).toFixed(1), s);
    if (/所有人|罗文|站住|弓箭手|还有谁|上前来/.test(s)) await shot(`s${i++}`);
    if (/还有谁/.test(s)) {
      console.log("rowan", JSON.stringify(await page.evaluate(() => {
        const w = window.__game.stage.world, r = w.npcs.get("rowan");
        const pv = r.bone("pelvis").getAbsolutePosition(), hd = r.bone("Head").getAbsolutePosition();
        w.rig.lookToward(hd, 3);
        return { pelvis: pv.asArray().map((v) => +v.toFixed(2)), head: hd.asArray().map((v) => +v.toFixed(2)), ground: +w.heightAt(pv.x, pv.z).toFixed(2) };
      })));
      await page.waitForTimeout(1200);
      await shot("rowan");
    }
  }
  await page.waitForTimeout(300);
}
await shot("creator0");
await page.click("#creator [data-race=woodelf]");
await page.waitForTimeout(800);
await shot("creator1");
await page.click("#creator [data-sex=f]");
await page.waitForTimeout(3000);
await shot("creator2");
await page.fill("#creator input[type=text]", "艾琳");
await page.click("#creator [data-act=done]");
const t1 = Date.now();
while (Date.now() - t1 < 90000) {
  const s = await sub();
  if (s !== lastSub) { lastSub = s; console.log("after", s); }
  if (await page.evaluate(() => !!document.querySelector(".toast"))) break;
  await page.waitForTimeout(300);
}
await page.waitForTimeout(1500);
await shot("walk0");
const st = await page.evaluate(() => {
  const g = window.__game; const s = g.stage; const p = s.player;
  return { pos: p?.position?.asArray?.(), canMove: p?.canMove, app: s.appearance, ch: s.current?.id };
}).catch((e) => "ERR " + e.message);
console.log(JSON.stringify(st));
console.log(logs.filter((l) => !l.includes("[timing]")).slice(0, 40).join("\n"));
await browser.close();
