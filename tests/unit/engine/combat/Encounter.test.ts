import { test } from "node:test";
import assert from "node:assert/strict";
import { CombatSystem, type Combatant } from "../../../../src/engine/combat/CombatSystem";
import { DEATH, Encounter, difficultyFor, type EncounterHost, type Mark } from "../../../../src/engine/combat/Encounter";
import { Vitals } from "../../../../src/engine/combat/vitals";
import { TimeScale } from "../../../../src/engine/core/timeScale";
import { deepClone } from "../../../../src/engine/core/json";

test("adaptive difficulty: ×0.75 damage and 0.5× wind-ups from 2 deaths; ×0.85 HP and companion ×1.5 from 3", () => {
  assert.deepEqual(difficultyFor(0), { tier: 0, enemyDamage: 1, windupRate: null, enemyHp: 1, companionDamage: 1 });
  assert.deepEqual(difficultyFor(1), difficultyFor(0));
  assert.deepEqual(difficultyFor(2), { tier: 1, enemyDamage: 0.75, windupRate: 0.5, enemyHp: 1, companionDamage: 1 });
  assert.deepEqual(difficultyFor(3), { tier: 2, enemyDamage: 0.75, windupRate: 0.5, enemyHp: 0.85, companionDamage: 1.5 });
  assert.deepEqual(difficultyFor(9), difficultyFor(3));
});

/** A fight with two enemies, a player and a companion, over fake story flags. */
function arena(o: { minHp?: number } = {}) {
  const sys = new CombatSystem({ hostile: { player: ["enemy"] } });
  const flags = { deaths: {} as Record<string, number>, potions: 2 };
  let checkpoint = deepClone(flags);
  const log: string[] = [];
  const at = { player: null as Mark | null, companion: null as Mark | null };
  const body = (id: string, faction: string, hp: number, extra: Partial<Parameters<CombatSystem["add"]>[0]> = {}) =>
    sys.add({ id, faction, vitals: new Vitals({ health: hp }), position: () => ({ x: 0, y: 0, z: 0 }), yaw: () => 0, ...extra });
  const player = body("player", "player", 100);
  const companion = body("brun", "player", 200, { essential: true });
  let made = 0;
  const live = new Set<Combatant>();
  const host: EncounterHost = {
    combat: sys,
    player: { combatant: player, teleport: (m) => (at.player = m), reset: () => log.push("player.reset") },
    companion: { combatant: companion, teleport: (m) => (at.companion = m) },
    time: new TimeScale(),
    fade: async (on) => void log.push(on ? "fade out" : "fade in"),
    sleep: async () => {},
    deaths: { get: (id) => flags.deaths[id] ?? 0, set: (id, n) => (flags.deaths[id] = n) },
    snapshot: () => {
      checkpoint = deepClone(flags);
      log.push("snapshot");
    },
    restore: () => {
      Object.assign(flags, deepClone(checkpoint));
      log.push("restore");
    },
    music: (id) => log.push(`music ${id}`),
  };
  const enemy = (id: string) => ({
    id,
    make: () => {
      made++;
      const c = body(`${id}#${made}`, "enemy", 70);
      live.add(c);
      return { combatant: c, dispose: () => live.delete(c) };
    },
  });
  let cleared = 0;
  const e = new Encounter(
    {
      id: "E1",
      arena: [{ min: [48, 30, -664], max: [66, 45, -654] }],
      spawns: [enemy("shield"), enemy("captain")],
      music: "audio/music_fight",
      retry: { player: { x: 54.6, y: 38.13, z: -657, yaw: -1.57 }, companion: { x: 53.6, y: 38.13, z: -656 }, minHp: o.minHp },
      onClear: () => cleared++,
    },
    host,
  );
  return { sys, e, flags, log, at, player, companion, live, host, made: () => made, cleared: () => cleared };
}

test("start spawns the enemies and the music; the fight is won once all are dead or surrendered", async () => {
  const a = arena();
  assert.ok(a.e.contains({ x: 60, y: 38, z: -660 }) && !a.e.contains({ x: 70, y: 38, z: -660 }));
  await a.e.start();
  assert.equal(a.e.state, "active");
  assert.equal(a.e.actors.length, 2);
  assert.ok(a.log.includes("snapshot") && a.log.includes("music audio/music_fight"));
  a.e.update();
  assert.equal(a.e.state, "active");
  a.sys.surrender(a.e.actor("shield")!.combatant);
  a.e.actor("captain")!.combatant.vitals.kill();
  a.e.update();
  a.e.update();
  assert.equal(a.e.state, "cleared");
  assert.equal(a.cleared(), 1, "onClear once");
  assert.ok(a.log.includes("music null"));
});

test("player death: slow motion, fade, state rolled back, death counted, enemies remade, actors on their marks", async () => {
  const a = arena();
  await a.e.start();
  const first = a.e.actors.map((x) => x.combatant);
  // the fight so far: a potion drunk, the player hurt then killed, one enemy hurt
  a.flags.potions = 1;
  first[0].vitals.apply({ damage: 30 });
  a.player.vitals.kill();
  const slow = a.host.time!;
  const p = a.e.playerDied();
  assert.equal(a.e.state, "resetting");
  assert.equal(slow.value, 0.35, "0.35× slow motion");
  await p;
  assert.equal(a.e.state, "active");
  assert.equal(a.flags.potions, 2, "potions back to the encounter's start");
  assert.equal(a.flags.deaths.E1, 1, "the death is counted");
  assert.equal(a.e.deaths, 1);
  assert.equal(a.player.vitals.hp, 100, "HP restored");
  assert.ok(!a.player.vitals.dead);
  const now = a.e.actors.map((x) => x.combatant);
  assert.ok(now.every((c) => !first.includes(c)), "fresh enemies");
  assert.ok(first.every((c) => !a.sys.has(c)) && first.every((c) => !a.live.has(c)), "the old ones are gone");
  assert.equal(a.made(), 4);
  assert.deepEqual(a.at.player, { x: 54.6, y: 38.13, z: -657, yaw: -1.57 });
  assert.deepEqual(a.at.companion, { x: 53.6, y: 38.13, z: -656 });
  assert.ok(a.log.includes("player.reset"));
  const order = a.log.filter((l) => l !== "music audio/music_fight");
  assert.deepEqual(order.slice(order.indexOf("fade out")), ["fade out", "restore", "snapshot", "player.reset", "fade in"], "the count survives in the checkpoint");
  // a second call while it is running is ignored
  await Promise.all([a.e.playerDied(), a.e.playerDied()]);
  assert.equal(a.flags.deaths.E1, 2);
});

test("difficulty adapts on the retries after the 2nd and 3rd deaths, on its own multipliers", async () => {
  const a = arena();
  // the E1 tutorial halves the companion's damage (the chapter's multiplier)
  a.companion.damageMul = 0.5;
  await a.e.start();
  for (let i = 0; i < 2; i++) await a.e.playerDied();
  let enemies = a.e.actors.map((x) => x.combatant);
  assert.ok(enemies.every((c) => c.difficultyMul === 0.75 && c.difficultyWindup === 0.5));
  assert.ok(enemies.every((c) => c.damageMul === 1 && c.windupRate === undefined), "the content's own fields are untouched");
  assert.ok(enemies.every((c) => c.vitals.maxHp === 70));
  assert.equal(a.companion.difficultyMul, 1);
  await a.e.playerDied();
  enemies = a.e.actors.map((x) => x.combatant);
  assert.ok(enemies.every((c) => Math.abs(c.vitals.maxHp - 59.5) < 1e-9 && c.vitals.hp === c.vitals.maxHp));
  assert.equal(a.companion.difficultyMul, 1.5);
  assert.equal(a.companion.damageMul, 0.5, "the tutorial's multiplier is the chapter's");
  // the tutorial ends; a retry doesn't bring it back
  a.companion.damageMul = 1;
  await a.e.playerDied();
  assert.equal(a.companion.damageMul, 1);
  assert.equal(a.companion.difficultyMul, 1.5);
  a.e.dispose();
  assert.equal(a.companion.difficultyMul, 1, "the companion's difficulty boost ends with the fight");
  assert.equal(a.companion.damageMul, 1);
  assert.equal(a.live.size, 0);
});

test("disposing mid-retry stops it with the player alive and controllable; a fight with past deaths starts adapted", async () => {
  const a = arena();
  await a.e.start();
  a.player.vitals.kill();
  a.sys.step(1 / 60);
  const p = a.e.playerDied();
  a.e.dispose();
  await p;
  assert.equal(a.e.state, "disposed");
  assert.equal(a.live.size, 0);
  assert.equal(a.flags.deaths.E1 ?? 0, 0, "never got to count");
  assert.ok(!a.player.vitals.dead && a.player.active, "the player is up");
  assert.equal(a.player.vitals.hp, 100);
  assert.ok(a.log.includes("player.reset"), "the controls are ready again");
  assert.equal(a.host.time!.value, 1, "no slow motion left");
  assert.ok(!a.log.includes("fade in"), "never faded out: nothing to fade back");
  assert.ok(a.sys.attack(a.player, { id: "x", clip: "x", length: 0.5, active: [0.1, 0.2], damage: 1, poiseDamage: 0, stamina: 0, reach: 1, arc: 45 }), "can attack");
  // the next death is noticed again (onDeath fires once per life)
  let deaths = 0;
  a.player.vitals.onDeath.on(() => deaths++);
  a.player.vitals.kill();
  assert.equal(deaths, 1);

  // disposed while the screen is black: it comes back
  const c = arena();
  let black!: () => void;
  c.host.fade = async (on) => {
    c.log.push(on ? "fade out" : "fade in");
    if (on) await new Promise<void>((r) => (black = r));
  };
  await c.e.start();
  c.player.vitals.kill();
  const q = c.e.playerDied();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(c.log.slice(-1), ["fade out"]);
  c.e.dispose();
  black();
  await q;
  assert.ok(!c.player.vitals.dead);
  assert.deepEqual(c.log.slice(-2), ["player.reset", "fade in"]);

  const b = arena();
  b.flags.deaths.E1 = 3;
  await b.e.start();
  assert.ok(b.e.actors.every((x) => x.combatant.difficultyMul === 0.75 && x.combatant.vitals.maxHp < 70));
  assert.equal(b.companion.difficultyMul, 1.5);
});

test("an enemy that fails to spawn is left out and the fight can still be won", async () => {
  const a = arena();
  const err = console.error;
  console.error = () => {};
  try {
    const e = new Encounter(
      {
        id: "E2",
        arena: [],
        spawns: [
          { id: "missing", make: () => Promise.reject(new Error("no model")) },
          { id: "ok", make: () => ({ combatant: a.sys.add({ id: "ok", faction: "enemy", vitals: new Vitals({ health: 40 }), position: () => ({ x: 0, y: 0, z: 0 }), yaw: () => 0 }), dispose() {} }) },
        ],
        retry: { player: { x: 0, y: 0, z: 0 } },
      },
      a.host,
    );
    await e.start();
    assert.equal(e.actors.length, 1);
    e.actor("ok")!.combatant.vitals.kill();
    e.update();
    assert.equal(e.state, "cleared");
  } finally {
    console.error = err;
  }
});

test("a companion that was down when the player died is up after the retry, with its start HP", async () => {
  const a = arena();
  await a.e.start();
  a.companion.vitals.kill();
  a.sys.step(1 / 60);
  assert.ok(a.companion.down);
  a.companion.riposteLeft = 1;
  a.player.vitals.kill();
  a.sys.step(1 / 60);
  await a.e.playerDied();
  assert.ok(!a.companion.down, "up for the retry");
  assert.equal(a.companion.vitals.hp, 200);
  assert.equal(a.companion.riposte, 0);
  assert.ok(a.sys.requestToken(a.e.actors[0].combatant, a.companion), "the enemies can engage it");
  for (let i = 0; i < 7 * 60; i++) a.sys.step(1 / 60);
  assert.equal(a.companion.vitals.hp, 200, "no late get-up at 50 %");
  assert.ok(!a.companion.down);
});

test("a retry restores exactly the player's start HP (§3.5); retry.minHp opts into a floor", async () => {
  const a = arena();
  a.player.vitals.apply({ damage: 90 });
  await a.e.start();
  a.player.vitals.kill();
  await a.e.playerDied();
  assert.equal(a.player.vitals.hp, 10, "by default exactly the snapshot");
  const b = arena({ minHp: DEATH.retryMinHp });
  b.player.vitals.apply({ damage: 90 });
  await b.e.start();
  b.player.vitals.kill();
  await b.e.playerDied();
  assert.equal(b.player.vitals.hp, 60, "opted in: at least 60 %");
  const c = arena({ minHp: DEATH.retryMinHp });
  c.player.vitals.apply({ damage: 20 });
  await c.e.start();
  c.player.vitals.kill();
  await c.e.playerDied();
  assert.equal(c.player.vitals.hp, 80, "or the start HP when higher");
});

test("a death while the enemies are still loading retries the fight; the late first batch is dropped", async () => {
  const a = arena();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const live = new Set<Combatant>();
  const seen: string[] = [];
  const attempts: number[] = [];
  const failed: unknown[] = [];
  const e = new Encounter(
    {
      id: "E3",
      arena: [],
      spawns: [
        {
          id: "x",
          make: async ({ attempt }) => {
            attempts.push(attempt);
            // the first batch registers at once, then its model takes a while
            const c = a.sys.add({ id: "x", faction: "enemy", vitals: new Vitals({ health: 50 }), position: () => ({ x: 0, y: 0, z: 0 }), yaw: () => 0 });
            live.add(c);
            if (attempt === 0) await gate;
            return { combatant: c, dispose: () => live.delete(c) };
          },
        },
      ],
      retry: { player: { x: 0, y: 0, z: 0 } },
    },
    a.host,
  );
  e.events.on((ev) => seen.push(ev.type));
  const err = console.error;
  console.error = (...args: unknown[]) => void failed.push(args);
  try {
    const started = e.start();
    assert.deepEqual(seen, ["begin"], "a death retries this fight from here on");
    a.player.vitals.kill();
    const retried = e.playerDied();
    // the retry's spawn waits for the batch still loading instead of making a second "x" beside it
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(attempts, [0], "nothing made while the first batch loads");
    assert.equal(e.state, "resetting");
    e.update();
    assert.equal(e.state, "resetting", "not won while enemies are on their way");
    release();
    await Promise.all([started, retried]);
    assert.equal(e.state, "active");
    assert.deepEqual(attempts, [0, 1]);
    assert.equal(e.actors.length, 1, "the retry's enemy is in (the same id, registered again)");
    const x = e.actors[0].combatant;
    assert.equal(a.sys.get("x"), x);
    assert.ok(live.has(x) && live.size === 1, "the late first batch is dropped");
    e.update();
    assert.equal(e.state, "active", "the fight is on, not trivially won");
    assert.deepEqual(failed, [], "no failed spawn");
  } finally {
    console.error = err;
  }
  e.dispose();
});

test("spawns never overlap: a third spawn queued behind a loading one skips the stale one", async () => {
  const a = arena();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const made: number[] = [];
  const e = new Encounter(
    {
      id: "E4",
      arena: [],
      spawns: [
        {
          id: "y",
          make: async ({ attempt }) => {
            made.push(attempt);
            if (made.length === 1) await gate;
            const c = a.sys.add({ id: "y", faction: "enemy", vitals: new Vitals({ health: 50 }), position: () => ({ x: 0, y: 0, z: 0 }), yaw: () => 0 });
            return { combatant: c, dispose: () => {} };
          },
        },
      ],
      retry: { player: { x: 0, y: 0, z: 0 } },
    },
    a.host,
  );
  const first = e.spawn();
  // the first is loading by now
  await new Promise((r) => setTimeout(r, 1));
  assert.equal(made.length, 1);
  const second = e.spawn();
  const third = e.spawn();
  release();
  await Promise.all([first, second, third]);
  assert.equal(made.length, 2, "the first (dropped) and the last; the middle one never made anything");
  assert.equal(e.actors.length, 1);
  assert.equal(a.sys.get("y"), e.actors[0].combatant);
  e.dispose();
  assert.ok(!a.sys.get("y"));
});

test("a retry that fails part-way still gets the player up", async () => {
  const a = arena();
  await a.e.start();
  a.host.restore = () => {
    throw new Error("storage");
  };
  a.player.vitals.kill();
  const err = console.error;
  console.error = () => {};
  try {
    await a.e.playerDied();
  } finally {
    console.error = err;
  }
  assert.equal(a.e.state, "active");
  assert.ok(!a.player.vitals.dead);
  assert.equal(a.log.at(-1), "fade in");
});
