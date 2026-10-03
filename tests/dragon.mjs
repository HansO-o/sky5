// Drives the player through the dragon chapter (teleporting between objectives) with screenshots.
import { chromium } from "playwright-core";
const WEBGPU = !!process.env.WEBGPU;
const TS = process.env.TS ?? "3";
const SH = "/tmp/claude-0/shots";
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...(WEBGPU ? ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"] : [])],
});
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:4173/?${WEBGPU ? "" : "webgl&"}debug&chapter=dragon&timescale=${TS}${process.env.Q ?? ""}`);
await page.waitForFunction(() => performance.getEntriesByName("menu-3d-ready").length > 0, null, { timeout: 60000 });
await page.click("text=新游戏");
await page.waitForFunction(() => performance.getEntriesByName("cart-started").length > 0, null, { timeout: 120000 });
const t0 = Date.now();
const st = () => page.evaluate(() => ({ sub: document.getElementById("subtitle")?.textContent ?? "", toast: document.getElementById("toast")?.classList.contains("on") ? document.getElementById("toast").textContent : "", ch: window.__game?.stage?.chapter?.id, end: !!document.getElementById("endcard"), step: window.__game?.stage?.chapter?.step, p: window.__game?.stage?.player?.position?.asArray?.().map((v) => +v.toFixed(1)) }));
const tp = (x, y, z, yaw) => page.evaluate(([x, y, z, yaw]) => { const s = window.__game.stage; const V = s.world.rig.camera.position.constructor; s.player.teleport(new V(x, s.world.heightAt(x, z) + y, z), yaw); }, [x, y, z, yaw]);
let n = 0, last = "";
const shot = async (tag) => page.screenshot({ path: `${SH}/d-${String(n++).padStart(2, "0")}-${tag}.png` });
const did = new Set();
while (Date.now() - t0 < 600000) {
  const s = await st();
  const key = s.sub + "|" + s.toast;
  if (key !== last) { last = key; console.log(((Date.now() - t0) / 1000).toFixed(1), "step", s.step, s.p, s.sub, s.toast ? `[${s.toast}]` : ""); await shot(`s${s.step}`); }
  if (s.end || (s.ch && s.ch !== "dragon")) { console.log("ended", s.end ? "endcard" : s.ch); break; }
  if (s.toast.includes("进入塔楼") && !did.has(1)) { did.add(1); await page.waitForTimeout(4000); await shot("square"); await tp(88.4, 0.1, -584, -Math.PI / 2); }
  if (s.toast.includes("爬上塔楼") && !did.has(2)) { did.add(2); await page.waitForTimeout(1500); await tp(91.5, 6.5, -582.5, -Math.PI / 2); }
  if (s.toast.includes("跳进旅店") && !did.has(3)) { did.add(3); await page.waitForTimeout(2500); for (const [i, yaw] of [0, Math.PI / 2, Math.PI, -Math.PI / 2].entries()) { await page.evaluate((y) => { const w = window.__game.stage.world; w.rig.yaw = y; w.rig.pitch = 0; }, yaw); await page.waitForTimeout(1500); await shot("breach" + i); } await tp(97.8, 3.5, -584, -Math.PI / 2); await page.waitForTimeout(3000); await shot("inn"); await tp(103, 0.1, -571, 0); }
  if (s.step === 3 && (s.sub.includes("跟紧我") || did.has(4))) {
    did.add(4);
    // keep up with the scribe
    await page.evaluate(() => { const s = window.__game.stage; const c = s.world.npcs.get("scribe"); const V = s.world.rig.camera.position.constructor; const p = c.root.position; s.player.teleport(new V(p.x + 2, s.world.heightAt(p.x + 2, p.z + 2) + 0.1, p.z + 2)); s.world.rig.yaw = Math.atan2(-(p.x - (p.x + 2)), -(p.z - (p.z + 2))); });
    if (Math.random() < 0.15) await shot("follow");
  }
  await page.waitForTimeout(400);
}
await shot("end");
console.log(logs.filter((l) => !/\[timing\]|BJS -/.test(l)).slice(0, 30).join("\n"));
await browser.close();
