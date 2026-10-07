// The keep chapter's first half (design §5.1 K0–K5, §11 checkpoints 0–4), played headless on both
// routes. WebGL on SwiftShader; the player is driven by teleports, camera turns and real key presses
// (E at every prompt, R to draw, the left button for a swing); the E1 enemies are finished through the
// combat API once a real swing has landed and a death has been retried.
//
//   node tests/keep.mjs                                 (both routes, every part)
//   FACTION=imperial PARTS=full node tests/keep.mjs     (one route, some parts)
//
// Parts:
//   full     — from the gate (step 0): the choice by E, the way in, the bonds shot, the gear, E1 (a real
//              swing lands, the player dies and the fight is retried, then the enemies fall), the
//              leader's key ring, the storeroom and its potions, the stairs with the tremor, step 4,
//              the end card. Steps must go 0→1→2→3→4 and the objective must change with every beat.
//   fallback — from step 1: the bonds shot, then nothing is touched in K2: after 45 s the guide hands
//              over a sword and the armour goes on (step 2).
//   resume   — from each of steps 2, 3, 4 (RESUME=2,3,4): the checkpoint's state, then on to the end card.
// Screenshots: /tmp/claude-0/shots/kp-<faction>-<part>-NN-<tag>.png
import { chromium } from "playwright-core";

const TS = process.env.TS ?? "3";
const SHOTS = process.env.SHOTS ?? "/tmp/claude-0/shots";
const FACTIONS = (process.env.FACTION ?? "rebel,imperial").split(",").filter(Boolean);
const PARTS = (process.env.PARTS ?? "full,fallback,resume").split(",").filter(Boolean);
const RESUME = (process.env.RESUME ?? "2,3,4").split(",").map(Number);
/** real seconds a part may take */
const LIMIT = +(process.env.LIMIT ?? 900);

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** In-page helpers (window.__kt). */
const HELPERS = () => {
  const st = () => window.__game.stage;
  const V = () => st().player.position.constructor;
  const gfY = () => (st().underground ? st().underground.origin.y + 0.4 : 38.14);
  window.__kt = {
    hits: [],
    state() {
      const s = st();
      const ch = s?.chapter;
      const p = s?.player?.position;
      const sub = document.getElementById("subtitle");
      const use = document.getElementById("use");
      return {
        ch: ch?.id ?? null,
        step: ch?.step ?? null,
        beat: ch?.beat ?? null,
        faction: s?.flags?.faction ?? null,
        obj: s ? (document.querySelector("#objective span")?.textContent ?? null) : null,
        objOn: !!document.getElementById("objective")?.classList.contains("on"),
        use: use?.classList.contains("on") ? (use.dataset.text ?? null) : null,
        sub: sub && sub.style.opacity !== "0" ? sub.textContent : "",
        end: !!document.getElementById("endcard"),
        p: p ? [p.x, p.y, p.z].map((v) => +v.toFixed(2)) : null,
        t: s?.world?.time ?? 0,
        inv: s?.flags?.inv ?? null,
        deaths: s?.flags?.deaths ?? null,
        looted: s?.flags?.looted ?? [],
        canSkip: !!s?.canSkip,
        bound: s?.player?.bound ?? null,
        enabled: s?.player?.enabled ?? null,
        e1: ch?.e1 ? { state: ch.e1.encounter.state, engaged: ch.e1.engaged, alive: ch.e1.encounter.actors.filter((a) => !a.combatant.defeated).length, n: ch.e1.encounter.actors.length } : null,
        hp: s?.combat ? +s.combat.player.vitals.hp.toFixed(1) : null,
        dead: s?.combat ? s.combat.player.vitals.dead : null,
        armed: s?.player?.armed ?? null,
        profile: s?.world?.env?.interior ?? null,
        gate: s?.gate ? +s.gate.t.toFixed(2) : null,
        postern: s?.postern ? +s.postern.t.toFixed(2) : null,
        doors: s?.underground ? Object.fromEntries(Object.entries(s.underground.doors).map(([k, d]) => [k, +d.t.toFixed(2)])) : null,
        hits: window.__kt.hits.length,
        rig: s?.world?.rig?.mode ?? null,
      };
    },
    /** stand at (x, y?, z) facing (lx, lz); y defaults to the ground floor (or the terrain outside) */
    tp(x, z, lx, lz, y) {
      const s = st();
      const Vec = V();
      const yy = y ?? (s.underground?.roomAt({ x, y: gfY(), z }) ? gfY() : s.world.heightAt(x, z));
      const yaw = Math.atan2(-(lx - x), -(lz - z));
      s.player.teleport(new Vec(x, yy + 0.05, z), yaw);
      s.world.rig.yaw = yaw;
      s.world.rig.pitch = -0.3;
      return [x, yy, z];
    },
    /** stand ~`d` m from an interactable (away from `from`), looking at it; returns its label */
    approach(id, fromX, fromZ, d = 1.1) {
      const s = st();
      const it = s.chapter?.inter?.get(id);
      if (!it) return null;
      const pos = typeof it.def.pos === "function" ? it.def.pos() : it.def.pos;
      let vx = pos.x - fromX, vz = pos.z - fromZ;
      const l = Math.hypot(vx, vz) || 1;
      vx /= l;
      vz /= l;
      const x = pos.x + vx * d, z = pos.z + vz * d;
      const fy = s.underground?.floor(x, z, pos.y + 1) ?? pos.y;
      const Vec = V();
      const yaw = Math.atan2(-(pos.x - x), -(pos.z - z));
      s.player.teleport(new Vec(x, fy + 0.05, z), yaw);
      s.world.rig.yaw = yaw;
      s.world.rig.pitch = -0.45;
      return typeof it.label === "function" ? it.label() : it.label;
    },
    has(id) {
      return !!st().chapter?.inter?.get(id);
    },
    /** a prop's root (chest, rack, shelf) as [x, z] */
    root(kind, name) {
      const p = st().underground?.props;
      const r = kind === "chest" ? p?.chest(name)?.root : kind === "rack" ? p?.rack(name)?.root : kind === "shelf" ? p?.shelf?.root : null;
      return r ? [r.position.x, r.position.z] : null;
    },
    /** listen for the player's blows */
    listen() {
      const s = st();
      if (window.__kt.listening === s.combat) return;
      window.__kt.listening = s.combat;
      s.combat.system.events.on((e) => {
        if (e.type === "hit" && e.hit.attacker === s.combat.player) window.__kt.hits.push({ outcome: e.hit.outcome, damage: e.hit.damage, target: e.hit.target.id });
      });
    },
    /** stand in front of the tutorial opponent, facing it (`d` m off) */
    faceTutor(d = 1.25) {
      const s = st();
      const a = s.chapter?.e1?.tutor;
      if (!a || a.combatant.defeated) return false;
      const q = a.agent.position;
      const pp = s.player.position;
      let vx = pp.x - q.x, vz = pp.z - q.z;
      const l = Math.hypot(vx, vz) || 1;
      vx /= l;
      vz /= l;
      const x = q.x + vx * d, z = q.z + vz * d;
      const Vec = V();
      const yaw = Math.atan2(-(q.x - x), -(q.z - z));
      s.player.teleport(new Vec(x, q.y + 0.05, z), yaw);
      s.world.rig.yaw = yaw;
      s.world.rig.pitch = -0.1;
      return true;
    },
    /** the left button counts while the pointer is locked: say it is (headless has no lock) */
    lock() {
      const inp = st().combat?.controls?.o?.input;
      if (inp) inp.locked = true;
      return !!inp;
    },
    leaderAt() {
      const a = st().chapter?.e1?.leader;
      const p = a?.body?.bone("pelvis")?.getAbsolutePosition() ?? a?.agent?.position;
      return p ? [p.x, p.y, p.z] : null;
    },
  };
};

async function open(params) {
  const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(`${e.message}\n${e.stack}`));
  await page.goto(`http://localhost:4173/?webgl&debug&chapter=keep&timescale=${TS}${params}`);
  await page.waitForFunction(() => performance.getEntriesByName("menu-3d-ready").length > 0, null, { timeout: 180000 });
  await page.click("text=新游戏");
  await page.waitForFunction(() => window.__game?.stage?.chapter?.id === "keep" && !!window.__game.stage.player, null, { timeout: 600000 });
  await page.evaluate(HELPERS);
  return { page, errors };
}

/**
 * Play on from wherever the chapter is until the end card (or `until(state)` holds). Records every
 * step and objective seen. Returns the log.
 */
async function drive(page, faction, tag, o = {}) {
  const rebel = faction === "rebel";
  const log = { steps: [], objs: [], beats: [], chooseByE: false, swing: null, death: null, fallback: null, shotBonds: false, tremor: false, end: false, timeout: false };
  const t0 = Date.now();
  let n = 0;
  const shot = (what) => page.screenshot({ path: `${SHOTS}/kp-${faction}-${tag}-${String(n++).padStart(2, "0")}-${what}.png` }).catch(() => {});
  const S = () => page.evaluate(() => window.__kt.state());
  const did = new Set();
  const once = (k) => (did.has(k) ? false : (did.add(k), true));
  const press = async (key) => {
    await page.keyboard.down(key);
    await sleep(120);
    await page.keyboard.up(key);
  };
  /** E at a prompt: approach, check its label, press until it is used */
  const useIt = async (id, from, label) => {
    for (let i = 0; i < 6; i++) {
      if (!(await page.evaluate((id) => window.__kt.has(id), id))) return true;
      const l = await page.evaluate(([id, f]) => window.__kt.approach(id, f[0], f[1]), [id, from]);
      await sleep(900);
      const s = await S();
      if (label && s.use && !s.use.includes(label)) console.log(`    (prompt reads "${s.use}", expected ${label})`);
      if (s.use) await press("KeyE");
      else console.log(`    (no prompt at ${id} "${l}" yet; sub "${s.sub}")`);
      await sleep(900);
    }
    return !(await page.evaluate((id) => window.__kt.has(id), id));
  };
  let last = "";
  while (true) {
    if ((Date.now() - t0) / 1000 > LIMIT) {
      log.timeout = true;
      break;
    }
    const s = await S();
    if (s.step !== null && log.steps[log.steps.length - 1] !== s.step) log.steps.push(s.step);
    if (s.obj && s.objOn && log.objs[log.objs.length - 1] !== s.obj) log.objs.push(s.obj);
    if (s.beat && log.beats[log.beats.length - 1] !== s.beat) log.beats.push(s.beat);
    const key = `${s.step}|${s.beat}|${s.obj}|${s.sub}|${s.use}`;
    if (key !== last) {
      last = key;
      console.log(`  ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s t${s.t.toFixed(0)} step ${s.step} ${s.beat} [${s.obj ?? ""}] ${s.use ? `<${s.use}> ` : ""}${s.sub}`);
    }
    if (s.end) {
      log.end = true;
      await shot("endcard");
      break;
    }
    if (o.until?.(s)) break;
    if (s.ch !== "keep") {
      await sleep(500);
      continue;
    }
    // ---------------------------------------------------------------- K0: the choice by E
    if (s.beat === "K0" && s.use === null && s.obj && /做出选择/.test(s.obj)) {
      if (once("k0shot")) await shot("k0-doors");
      if (!did.has("k0choose") || (did.has("k0choose") && Date.now() - (log.k0at ?? 0) > 6000)) {
        did.add("k0choose");
        log.k0at = Date.now();
        // stand by the chosen guide, looking at him
        await page.evaluate((rebel) => {
          const s = window.__game.stage;
          const c = s.world.npcs.get(rebel ? "brun" : "scribe");
          const p = c.root.position;
          window.__kt.tp(p.x + (rebel ? 1.6 : 0.4), p.z + (rebel ? 0.6 : 1.8), p.x, p.z);
        }, rebel);
        await sleep(900);
      }
    }
    if (s.beat === "K0" && s.use && /跟随/.test(s.use)) {
      const want = rebel ? "跟随布伦" : "跟随书记官";
      if (s.use.includes(want)) {
        await press("KeyE");
        log.chooseByE = true;
        await sleep(600);
      }
    }
    // ---------------------------------------------------------------- K1: to the door, in
    if (s.beat === "K1" && s.step === 0) {
      if (once("k1door")) {
        if (rebel) await page.evaluate(() => window.__kt.tp(45.2, -659.2, 47.5, -659.0));
        else await page.evaluate(() => window.__kt.tp(60.2, -650.8, 60.0, -654.0));
        await sleep(1500);
        await shot("k1-door");
      }
      const open = rebel ? (s.postern ?? 0) > 0.9 : (s.gate ?? 0) > 0.9;
      if (open && once("k1in")) {
        await shot("k1-open");
        if (rebel) await page.evaluate(() => window.__kt.tp(50.4, -659.6, 52, -659));
        else await page.evaluate(() => window.__kt.tp(60.2, -656.8, 60, -660));
      }
    }
    if (s.beat === "K1b" && s.rig === "cine" && once("bonds")) {
      log.shotBonds = true;
      await sleep(700);
      await shot("k1-bonds");
    }
    // ---------------------------------------------------------------- K2: the gear
    if (s.beat === "K2" && s.step === 1 && !o.noGear && once("k2")) {
      await sleep(1500);
      await shot("k2-start");
      if (rebel) {
        const chest = await page.evaluate(() => window.__kt.root("chest", "use_chest_reb"));
        const rack = await page.evaluate(() => window.__kt.root("rack", "use_weaponstand_reb"));
        log.chest = await useIt("chest", chest, "打开箱子");
        await sleep(2500);
        log.armour = await useIt("armour", chest, "穿上 皮甲");
        await sleep(2500);
        await shot("k2-armour");
        log.weapon = await useIt("rack_sword", rack, "拿起 铁剑");
      } else {
        const rack = await page.evaluate(() => window.__kt.root("rack", "use_weaponstand_imp"));
        const chest = await page.evaluate(() => window.__kt.root("chest", "use_locker_imp"));
        log.weapon = await useIt("rack_sword", rack, "拿起 铁剑");
        await sleep(800);
        log.shield = await useIt("rack_shield", rack, "拿起 鸢盾");
        await sleep(800);
        log.chest = await useIt("chest", chest, "打开箱子");
        await sleep(2500);
        log.armour = await useIt("armour", chest, "穿上 皮甲");
      }
      await sleep(2000);
      await shot("k2-geared");
    }
    if (s.beat === "K2fallback") log.fallback = true;
    // ---------------------------------------------------------------- K3: E1
    if (s.beat === "K3" && s.e1?.engaged && s.e1.state === "active") {
      if (once("e1shot")) {
        await page.evaluate(() => window.__kt.listen());
        await shot("e1-in");
      }
      if (!o.noFight && !did.has("swung")) {
        // a real swing: draw (R), face the tutorial opponent, the left button
        if (!s.armed) {
          await press("KeyR");
          await sleep(2500);
        }
        await page.evaluate(() => window.__kt.lock());
        for (let i = 0; i < 8; i++) {
          await page.evaluate(() => window.__kt.faceTutor(1.3));
          await sleep(250);
          await page.mouse.move(480, 270);
          await page.mouse.down({ button: "left" });
          await sleep(90);
          await page.mouse.up({ button: "left" });
          await sleep(900);
          const k = await page.evaluate(() => window.__kt.hits.slice());
          if (k.length) {
            log.swing = k[0];
            break;
          }
        }
        did.add("swung");
        await shot("e1-swing");
      }
      if (!o.noFight && did.has("swung") && !did.has("died")) {
        // the player falls: the fight goes back to its start
        did.add("died");
        const before = await S();
        await page.evaluate(() => window.__game.stage.combat.player.vitals.kill());
        await sleep(800);
        await shot("e1-dead");
        const ok = await page
          .waitForFunction((n) => {
            const k = window.__kt.state();
            return (k.deaths?.E1 ?? 0) > n && !k.dead && k.e1?.state === "active" && k.e1.alive === 2;
          }, before.deaths?.E1 ?? 0, { timeout: 120000 })
          .then(() => true, () => false);
        const after = await S();
        log.death = { ok, deaths: after.deaths?.E1 ?? 0, hp: after.hp, p: after.p, e1: after.e1 };
        await sleep(1500);
        await shot("e1-retry");
      }
      if (did.has("died") && log.death && once("killall")) {
        await sleep(1500);
        await page.evaluate(() => window.__game.stage.combat.debugKillAll());
      }
      if (o.noFight && once("killall2")) {
        await sleep(1500);
        await page.evaluate(() => window.__game.stage.combat.debugKillAll());
      }
    }
    // ---------------------------------------------------------------- K4: the leader's body, the storeroom
    if (s.beat === "K4" && (await page.evaluate(() => window.__kt.has("search_leader"))) && once("search")) {
      await sleep(1200);
      log.search = await useIt("search_leader", [60, -659.5], "搜查");
      await shot("k4-searched");
    }
    if (s.beat === "K4s" && once("store")) {
      await sleep(600);
      await page.evaluate(() => window.__kt.tp(64.9, -658.3, 67, -658.3));
      await page.waitForFunction(() => (window.__kt.state().doors?.store_door ?? 0) > 0.9, null, { timeout: 60000 }).catch(() => {});
      await shot("k4-store-open");
      const shelf = await page.evaluate(() => window.__kt.root("shelf"));
      if (shelf && (await page.evaluate(() => window.__kt.has("shelf")))) log.shelf = await useIt("shelf", shelf, "搜查");
      await sleep(1500);
      await shot("k4-shelf");
      await page.evaluate(() => window.__kt.tp(69.7, -659.9, 69.7, -662));
    }
    // ---------------------------------------------------------------- K5: the stairs
    if (s.beat === "K5" && once("stairs")) {
      await page.waitForFunction(() => (window.__kt.state().doors?.stair_door ?? 0) > 0.9, null, { timeout: 60000 }).catch(() => {});
      await shot("k5-stairdoor");
      // the mid landing (y 35.13): the tremor
      await page.evaluate(() => {
        const s = window.__game.stage;
        const m = s.underground.anchor("mark_tremor").pos;
        window.__kt.tp(m.x, m.z + 0.4, m.x - 2, m.z + 0.4, m.y);
      });
      const shook = await page
        .waitForFunction((rebel) => (document.getElementById("subtitle")?.textContent ?? "").includes(rebel ? "它落在要塞顶上了" : "它停在楼顶上"), rebel, { timeout: 60000 })
        .then(() => true, () => false);
      log.tremor = shook;
      await shot("k5-tremor");
      await page.evaluate(() => {
        const s = window.__game.stage;
        const f = s.underground.anchor("cp_k4").pos;
        window.__kt.tp(f.x, f.z, f.x, f.z + 2, f.y);
      });
    }
    await sleep(350);
  }
  return log;
}

/** The whole first half from the gate. */
async function full(faction) {
  const tag = "full";
  const { page, errors } = await open(`&faction=${faction}`);
  try {
    const s0 = await page.evaluate(() => window.__kt.state());
    check(`${faction} full: starts at step 0 outdoors`, s0.step === 0 && s0.profile === "outdoor", JSON.stringify({ step: s0.step, profile: s0.profile }));
    check(`${faction} full: cannot be skipped before the choice`, s0.canSkip === false);
    check(`${faction} full: bound at the gate`, s0.bound === true);
    const log = await drive(page, faction, tag);
    console.log("  log:", JSON.stringify({ ...log, objs: undefined }));
    console.log("  objectives:", log.objs.join(" → "));
    check(`${faction} full: reached the end card`, log.end && !log.timeout);
    check(`${faction} full: steps 0→1→2→3→4`, JSON.stringify(log.steps) === "[0,1,2,3,4]" || JSON.stringify(log.steps) === "[0,1,2,3,4,8]", JSON.stringify(log.steps));
    check(`${faction} full: chose by the E prompt`, log.chooseByE);
    check(`${faction} full: the bonds shot (locked camera)`, log.shotBonds);
    const want = faction === "rebel"
      ? ["做出选择", "跟随布伦进入要塞", "你的双手重获自由", "从箱子拿取护甲和武器", "击败帝国守卫", "搜索守卫长的尸体", "打开储藏室", "下到地牢"]
      : ["做出选择", "跟随书记官进入要塞", "你的双手重获自由", "从军械架拿取护甲和武器", "击败霜誓军", "搜索头目的尸体", "打开储藏室", "下到地牢"];
    let i = 0;
    for (const o of log.objs) if (i < want.length && o.includes(want[i])) i++;
    check(`${faction} full: the objective changes with every beat, in order`, i === want.length, `matched ${i}/${want.length}: ${log.objs.join(" | ")}`);
    check(`${faction} full: the gear by E (chest, armour, weapon${faction === "imperial" ? ", shield" : ""})`, !!log.chest && !!log.armour && !!log.weapon && (faction === "rebel" || !!log.shield));
    check(`${faction} full: a real swing landed through PlayerCombat`, !!log.swing && ["hit", "absorbed", "blocked", "guardBreak", "backstab"].includes(log.swing.outcome), JSON.stringify(log.swing));
    check(`${faction} full: a death in E1 retries the fight (death counted, player up, both enemies back)`, !!log.death?.ok && log.death.deaths === 1, JSON.stringify(log.death));
    check(`${faction} full: the leader searched by E`, !!log.search);
    check(`${faction} full: the tremor on the stairs`, log.tremor);
    const f = await page.evaluate(() => ({ inv: window.__game.stage.flags.inv, faction: window.__game.stage.flags.faction, looted: window.__game.stage.flags.looted }));
    console.log("  flags:", JSON.stringify(f));
    check(`${faction} full: faction recorded`, f.faction === faction);
    check(`${faction} full: key ring and potions (1 + 2)`, f.inv.keyring && f.inv.potions >= 3, JSON.stringify(f.inv));
    check(`${faction} full: armour of the route`, f.inv.armour === (faction === "rebel" ? 15 : 20));
    if (faction === "rebel") check(`rebel full: Brun's father's axe recorded`, f.looted.includes("use_weaponstand_reb#father_axe"), JSON.stringify(f.looted));
  } catch (e) {
    check(`${faction} full: runs`, false, String(e).slice(0, 400));
    await page.screenshot({ path: `${SHOTS}/kp-${faction}-full-fail.png` }).catch(() => {});
  }
  check(`${faction} full: no page errors`, errors.length === 0, errors.slice(0, 5).join(" | "));
  await page.context().close();
}

/** The 45 s gear fallback (§12): from step 1, nothing touched in K2. */
async function fallback(faction) {
  const { page, errors } = await open(`&from=1&faction=${faction}`);
  try {
    const s0 = await page.evaluate(() => window.__kt.state());
    check(`${faction} fallback: resumes at step 1, bound, inside`, s0.step === 1 && s0.bound === true && s0.profile !== "outdoor", JSON.stringify({ step: s0.step, bound: s0.bound, profile: s0.profile }));
    const log = await drive(page, faction, "fallback", { noGear: true, until: (s) => s.step === 2 });
    const s1 = await page.evaluate(() => window.__kt.state());
    console.log("  fallback:", JSON.stringify({ beats: log.beats, steps: log.steps, inv: s1.inv }));
    check(`${faction} fallback: the bonds shot played and the cuffs are off`, log.shotBonds && s1.bound === false);
    check(`${faction} fallback: after 45 s the guide hands over the gear (step 2)`, s1.step === 2 && log.fallback === true && s1.inv.weapon === "sword" && s1.inv.armour === (faction === "rebel" ? 15 : 20), JSON.stringify(s1.inv));
    await page.screenshot({ path: `${SHOTS}/kp-${faction}-fallback-end.png` });
  } catch (e) {
    check(`${faction} fallback: runs`, false, String(e).slice(0, 400));
  }
  check(`${faction} fallback: no page errors`, errors.length === 0, errors.slice(0, 5).join(" | "));
  await page.context().close();
}

/** Resume from a checkpoint (§11) and play on to the end card. */
async function resume(faction, step) {
  const { page, errors } = await open(`&from=${step}&faction=${faction}`);
  try {
    const s0 = await page.evaluate(() => window.__kt.state());
    const cp = { 2: faction === "rebel" ? [54.6, -657.0] : [60.5, -657.5], 3: [62.0, -657.5], 4: [67.65, -662.8] }[step];
    const near = s0.p && Math.hypot(s0.p[0] - cp[0], s0.p[2] - cp[1]) < 0.8;
    console.log(`  resume ${step}:`, JSON.stringify({ step: s0.step, p: s0.p, inv: s0.inv, profile: s0.profile }));
    check(`${faction} resume ${step}: at the checkpoint`, s0.step === step && near, JSON.stringify(s0.p));
    check(`${faction} resume ${step}: geared (§11 loadout)`, s0.inv.weapon !== "none" && s0.inv.armour > 0 && (step < 3 || (s0.inv.keyring && s0.inv.potions >= 1)) && (step < 4 || s0.inv.potions >= 3), JSON.stringify(s0.inv));
    check(`${faction} resume ${step}: lighting ${step >= 4 ? "basement" : "hall"}`, s0.profile === (step >= 4 ? "basement" : "hall"), String(s0.profile));
    const log = await drive(page, faction, `resume${step}`, { noFight: true });
    console.log("  log:", JSON.stringify({ steps: log.steps, beats: log.beats, objs: log.objs }));
    check(`${faction} resume ${step}: plays on to the end card`, log.end && !log.timeout);
    const want = [step, ...[2, 3, 4].filter((n) => n > step)];
    check(`${faction} resume ${step}: steps ${want.join("→")}`, JSON.stringify(log.steps.filter((n) => n <= 4)) === JSON.stringify(want), JSON.stringify(log.steps));
  } catch (e) {
    check(`${faction} resume ${step}: runs`, false, String(e).slice(0, 400));
  }
  check(`${faction} resume ${step}: no page errors`, errors.length === 0, errors.slice(0, 5).join(" | "));
  await page.context().close();
}

for (const faction of FACTIONS) {
  if (PARTS.includes("full")) await full(faction);
  if (PARTS.includes("fallback")) await fallback(faction);
  if (PARTS.includes("resume")) for (const n of RESUME) await resume(faction, n);
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`  FAILED: ${f.name}`);
process.exit(failed.length ? 1 : 0);
