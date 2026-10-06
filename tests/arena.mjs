// Headless run of the combat/AI sandbox (?debug&arena): the enemies are set on the player, the AI
// fights for SECS seconds of game time (TS× speed), with a log line and a screenshot every few
// seconds (/tmp/claude-0/shots/arena-NN.png). Fails on page errors, on an actor stuck for more than
// 4 s, or on an actor that falls through the floor.
//   TS=4 SECS=60 node tests/arena.mjs
import { chromium } from "playwright-core";
const TS = +(process.env.TS ?? 4), SECS = +(process.env.SECS ?? 60);
const SHOTS = process.env.SHOTS ?? "/tmp/claude-0/shots";
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const logs = [];
const errors = [];
page.on("console", (m) => {
  logs.push(`[${m.type()}] ${m.text()}`);
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(`${e.message}\n${e.stack}`));
await page.goto(`http://localhost:4173/?webgl&debug&arena&timescale=${TS}`);
await page.waitForFunction(() => performance.getEntriesByName("arena-started").length > 0, null, { timeout: 180000 });
console.log("arena started");
const snap = () =>
  page.evaluate(() => {
    const st = window.__game.stage;
    const w = st.world;
    const r = (v) => Math.round(v * 100) / 100;
    const actors = (st.ai?.all ?? []).map((a) => ({
      id: a.id,
      state: a.brain.state,
      hp: r(a.combatant.vitals.hp),
      pos: [r(a.agent.position.x), r(a.agent.position.y), r(a.agent.position.z)],
      stuck: r(a.agent.stuckFor),
      released: a.agent.released,
    }));
    return { t: r(w.time), round: st.round, player: { hp: r(st.combat.player.vitals.hp), pos: [r(st.player.position.x), r(st.player.position.y), r(st.player.position.z)] }, actors };
  });
await page.evaluate(() => window.__game.stage.engage());
let worstStuck = 0, lowest = Infinity, n = 0;
const startT = (await snap()).t;
let nextShot = 0;
const t0 = Date.now();
while (Date.now() - t0 < 20 * 60 * 1000) {
  const s = await snap();
  const gt = s.t - startT;
  for (const a of s.actors) {
    if (!a.released && a.state !== "dead") worstStuck = Math.max(worstStuck, a.stuck);
    if (!a.released) lowest = Math.min(lowest, a.pos[1]);
  }
  if (gt >= nextShot) {
    nextShot += 6;
    const id = String(n++).padStart(2, "0");
    console.log(id, `t ${gt.toFixed(1)} round ${s.round} player ${s.player.hp} @${s.player.pos.join(",")}`);
    for (const a of s.actors) console.log(`    ${a.id.padEnd(14)} ${a.state.padEnd(10)} hp ${String(a.hp).padEnd(6)} @${a.pos.join(",")} stuck ${a.stuck}`);
    await page.screenshot({ path: `${SHOTS}/arena-${id}.png` });
  }
  if (gt >= SECS) break;
  // a cleared round starts the next by itself; keep the new enemies on the player
  if (s.actors.every((a) => a.id === "brun" || a.state === "post")) await page.evaluate(() => window.__game.stage.engage());
  await page.waitForTimeout(500);
}
console.log(`worst stuck ${worstStuck.toFixed(2)} s; lowest actor y ${lowest.toFixed(2)}`);
const bad = [];
if (errors.length) bad.push(`page errors:\n${errors.slice(0, 10).join("\n")}`);
if (worstStuck > 4) bad.push(`an actor was stuck ${worstStuck.toFixed(1)} s`);
if (lowest < -1) bad.push(`an actor fell through the floor (y ${lowest.toFixed(2)})`);
console.log(logs.filter((l) => !/\[timing\]|BJS -/.test(l)).slice(0, 25).join("\n"));
await browser.close();
if (bad.length) {
  console.error("FAIL\n" + bad.join("\n"));
  process.exit(1);
}
console.log("PASS");
