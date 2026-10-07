// The exit chapter's world, checkpoint by checkpoint (design §11 "exit"): each
// `?debug&chapter=exit&from=N&faction=F` start must put the player on the floor at the step's mark
// (feet within 0.35 m of its floor for 3 s: no fall-through, no stuck-in-wall), in the right zone and
// lighting profile, with the web walls standing or gone as §11 says (their bodies, tags web_A /
// web_B), the outcrop's mouth plug gone (the tunnel opens onto the deck), and no console errors; the
// screenshot (/tmp/claude-0/shots/x-<step>[i].png) must show the place. Then `skip()` from step 0
// must reach the end card with the den's outcome "skipped". WebGL on SwiftShader.
//
// Needs the chapter (src/prologue/chapters/exit.ts) registered after "keep", taking `from` and
// `faction` like the keep's debug start, and a server on PORT (default 4174) serving the build:
//   node tools/serve.mjs --port 4174 &   (or: npx vite preview --port 4174)
//   node tests/exit.mjs                  (steps 0–5 on the rebel route, 0, 3 and 5 on the imperial one)
//   STEPS=0,5 FACTIONS=imperial SKIP=0 node tests/exit.mjs
import fs from "node:fs";
import { chromium } from "playwright-core";

const PORT = process.env.PORT ?? "4174";
const TS = process.env.TS ?? "1";
const SHOTS = process.env.SHOTS ?? "/tmp/claude-0/shots";
const STEPS = (process.env.STEPS ?? "0,1,2,3,4,5").split(",").map(Number);
const FACTIONS = (process.env.FACTIONS ?? "rebel,imperial").split(",").filter(Boolean);
/** the imperial route's steps (fewer: the world is the same, the guide differs) */
const IMPERIAL_STEPS = (process.env.IMPERIAL_STEPS ?? "0,3,5").split(",").map(Number);
const SKIP = process.env.SKIP !== "0";

/** §11: the step's mark (cave anchors; y the floor), the zone it stands in, the lighting profile there */
const STEP = {
  0: { at: [47.5, 27.06, -738.5], zone: "A", profile: "cave", webs: "intact" },
  1: { at: [31.5, 27.73, -749.0], zone: "B", profile: "cave", webs: null },
  2: { at: [12.0, 27.79, -749.5], zone: "B", profile: "cave", webs: "gone" },
  3: { at: [-16.5, 31.56, -729.0], zone: "C", profile: "cave", webs: "gone" },
  4: { at: [-28.0, 33.73, -709.0], zone: "D", profile: "cave", webs: "gone" },
  5: { at: [-15.0, 56.05, -670.5], zone: "E", profile: "outdoor", webs: "gone" },
};

fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
};

async function open(step, faction) {
  const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(`${e.message}\n${e.stack}`));
  await page.goto(`http://localhost:${PORT}/?webgl&debug&chapter=exit&from=${step}&faction=${faction}&timescale=${TS}`);
  await page.waitForFunction(() => performance.getEntriesByName("menu-3d-ready").length > 0, null, { timeout: 180000 });
  await page.click("text=新游戏");
  await page.waitForFunction(
    (s) => {
      const st = window.__game?.stage;
      return st?.chapter?.id === "exit" && st.chapter.step === s && !!st.player && !!st.underground;
    },
    step,
    { timeout: 600000 },
  );
  // the fade-in, and the zones' first checks
  await page.waitForTimeout(4000);
  return { page, errors };
}

const probe = (page) =>
  page.evaluate(() => {
    const st = window.__game.stage;
    const p = st.player.position;
    const ph = st.physics;
    const on = (tag) => {
      const ids = ph?.tagged(tag) ?? [];
      return ids.length ? ids.some((id) => ph.bodyEnabled(id)) : null;
    };
    return {
      t: st.world.time,
      p: [p.x, p.y, p.z],
      zone: st.underground?.zone ?? null,
      profile: st.world.env.interior,
      outdoor: st.world.outdoorVisible,
      webA: on("web_A"),
      webB: on("web_B"),
      plug: st.outcrop ? st.outcrop.plugBody : "none",
      beast: st.flags.outcomes.beast ?? null,
    };
  });

async function run(step, faction) {
  const tag = `${step}${faction === "imperial" ? "i" : ""}`;
  const t0 = Date.now();
  const { page, errors } = await open(step, faction);
  try {
    const want = STEP[step];
    const first = await probe(page);
    let worst = 0;
    const tEnd = first.t + 3;
    let last = first;
    for (let i = 0; i < 400; i++) {
      const s = (last = await probe(page));
      worst = Math.max(worst, Math.abs(s.p[1] - want.at[1]));
      if (s.t >= tEnd) break;
      await page.waitForTimeout(100);
    }
    const off = Math.hypot(last.p[0] - want.at[0], last.p[2] - want.at[2]);
    check(`step ${tag}: on the floor at its mark`, worst < 0.35 && off < 1.5, `y off ≤ ${worst.toFixed(2)} m, ${off.toFixed(2)} m from the mark, at ${last.p.map((v) => v.toFixed(2)).join(", ")}`);
    check(`step ${tag}: zone ${want.zone}, profile ${want.profile}`, last.zone === want.zone && last.profile === want.profile, `zone ${last.zone}, profile ${last.profile}`);
    check(`step ${tag}: outdoor world ${step === 5 ? "shown" : "hidden"}`, last.outdoor === (step === 5), `outdoorVisible ${last.outdoor}`);
    if (want.webs === "intact") check(`step ${tag}: both web walls stand`, last.webA === true && last.webB === true, `web_A ${last.webA}, web_B ${last.webB}`);
    if (want.webs === "gone") check(`step ${tag}: both web walls gone`, last.webA !== true && last.webB !== true, `web_A ${last.webA}, web_B ${last.webB}`);
    check(`step ${tag}: the mouth plug is out`, last.plug === null || last.plug === "none", `plugBody ${last.plug}`);
    await page.screenshot({ path: `${SHOTS}/x-${tag}.png` });
    if (SKIP && step === 0 && faction === "rebel") {
      await page.evaluate(() => void window.__game.stage.skipChapter(undefined, true));
      await page.waitForSelector("#endcard", { timeout: 120000 }).catch(() => {});
      const end = await page.evaluate(() => ({ card: !!document.getElementById("endcard"), beast: window.__game.stage.flags.outcomes.beast ?? null }));
      check(`skip from step ${tag}: the end card, the den "skipped"`, end.card && end.beast === "skipped", JSON.stringify(end));
      await page.screenshot({ path: `${SHOTS}/x-skip.png` });
    }
    const bad = errors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND/.test(e));
    check(`step ${tag}: no console errors`, bad.length === 0, bad.slice(0, 3).join(" | "));
  } catch (e) {
    check(`step ${tag}: ran`, false, String(e?.message ?? e));
  } finally {
    console.log(`  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    await page.context().close();
  }
}

for (const faction of FACTIONS) for (const step of faction === "imperial" ? STEPS.filter((s) => IMPERIAL_STEPS.includes(s)) : STEPS) await run(step, faction);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
