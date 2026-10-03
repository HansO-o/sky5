// Can the player physically make the jump from the tower breach into the inn and get out to the street?
import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 480, height: 270 } })).newPage();
const logs = [];
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:4173/?webgl&debug&chapter=dragon&from=breach&timescale=1`);
await page.waitForFunction(() => performance.getEntriesByName("menu-3d-ready").length > 0, null, { timeout: 60000 });
await page.click("text=新游戏");
await page.waitForFunction(() => performance.getEntriesByName("cart-started").length > 0, null, { timeout: 120000 });
await page.waitForFunction(() => document.getElementById("toast")?.textContent.includes("跳进旅店"), null, { timeout: 300000 });
const pos = () => page.evaluate(() => window.__game.stage.player.position.asArray().map((v) => +v.toFixed(2)));
await page.evaluate(() => { const s = window.__game.stage; const V = s.world.rig.camera.position.constructor; s.player.teleport(new V(90.6, s.world.heightAt(90, -584) + 6.45, -584), -Math.PI / 2); s.world.rig.pitch = 0; });
await page.waitForTimeout(3000);
console.log("start", await pos());
await page.keyboard.down("KeyW");
await page.keyboard.down("ShiftLeft");
let jumped = false;
const t0 = Date.now();
while (Date.now() - t0 < 120000) {
  const p = await pos();
  console.log(((Date.now() - t0) / 1000).toFixed(0), p);
  if (!jumped && p[0] > 92.3) { await page.keyboard.press("Space"); jumped = true; }
  if (jumped && p[0] > 97.5) { await page.keyboard.up("KeyW"); await page.keyboard.up("ShiftLeft"); }
  if (jumped && p[0] > 97.5 && Date.now() - t0 > 20000) break;
  await page.waitForTimeout(700);
}
await page.waitForTimeout(4000);
console.log("landed", await pos(), "base", await page.evaluate(() => window.__game.stage.world.heightAt(101, -584)));
await page.screenshot({ path: "/tmp/claude-0/shots/jump.png" });
// walk east over the floor hole, then north out of the door, then to the street
const walkTo = async (x, z, limit = 60000) => {
  const t = Date.now();
  await page.keyboard.down("KeyW");
  while (Date.now() - t < limit) {
    const p = await pos();
    if (Math.hypot(p[0] - x, p[2] - z) < 0.6) break;
    await page.evaluate(([x, z]) => { const s = window.__game.stage; const p = s.player.position; s.world.rig.yaw = Math.atan2(-(x - p.x), -(z - p.z)); }, [x, z]);
    await page.waitForTimeout(300);
  }
  await page.keyboard.up("KeyW");
  const p = await pos();
  console.log("walk", x, z, "->", p);
  return p;
};
await walkTo(103.6, -584);
await page.waitForTimeout(3000);
console.log("after hole", await pos());
await walkTo(102.9, -581.5);
await walkTo(102.9, -578);
await walkTo(103, -571);
await page.waitForTimeout(3000);
console.log("step", await page.evaluate(() => window.__game.stage.chapter?.step), await page.evaluate(() => document.getElementById("subtitle")?.textContent));
await page.screenshot({ path: "/tmp/claude-0/shots/jump2.png" });
console.log(logs.join("\n"));
await browser.close();
