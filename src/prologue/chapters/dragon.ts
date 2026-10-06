import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { audio } from "../../core/audio";
import { input } from "../../core/input";
import { hud } from "../../ui/hud";
import { objective } from "../../ui/compass";
import { nag } from "../nag";
import { OUTFITS, type Character } from "../../world/characters";
import { LAYOUT } from "../../world/town";
import { Ragdoll } from "../../physics/ragdoll";
import { Cancelled } from "../Director";
import { faceTo, stand, stopWalk, walkPath } from "../actors";
import type { Dragon } from "../dragon";
import type { DragonDirector, RampageSpec } from "../dragonDirector";
import { shootArrow } from "../fx/arrow";
import type { FireFx } from "../fx/fire";
import { RAIDED_HOUSES } from "../fx/townFires";
import type { PlayerController } from "../player";
import type { Chapter, ChapterContext } from "./types";

const PL = LAYOUT.platform;
const T = LAYOUT.tower;
const INN = LAYOUT.inn;
const TOWER_TOP = 13.5;
const TOWER_HALF = 3.5;
/** first floor of the watchtower (tools/gen/townbuildings.mjs TOWER.floor1) */
const TOWER_FLOOR1 = 3.2;
/** inside the tower, by the foot of the stairs */
const TOWER_IN = { x: T.x - 1.6, z: T.z + 1.2 };
const TOWER_DOOR = { x: T.x - TOWER_HALF - 1.2, z: T.z };
/** where the scribe waits outside the inn */
const STREET = LAYOUT.escape[0];
const KEEP_GATE = { x: LAYOUT.keep.x, z: LAYOUT.keep.z + LAYOUT.keep.d / 2 + 3 };
/** where the keep chapter starts: the player, Brun and the scribe before the keep gate (keep step 0) */
const K0 = { player: { x: 60, z: -648 }, brun: { x: 56, z: -649 }, scribe: { x: 60.5, z: -650.8 } };

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Segment 5: the dragon burns the town. Brun drags the player into the watchtower, the dragon blows
 * the top floor open, the player jumps into the burning inn and follows the scribe through the
 * streets to the keep.
 */
export class DragonChapter implements Chapter {
  id = "dragon" as const;
  label = "巨龙袭城";
  seamless = true;
  player!: PlayerController;
  /** the stage's dragon, fire effects and burning houses: they carry on into the next chapter */
  private dragons!: DragonDirector;
  private dragon!: Dragon;
  private fx!: FireFx;
  private step = 0;
  private base = 0;
  private meteors = false;
  private offs: (() => void)[] = [];
  private ragdolls: Ragdoll[] = [];
  private alive = true;
  /** run() has started: only then does the chapter own the global prompt/audio state */
  private started = false;

  constructor(private ctx: ChapterContext) {}

  private get w() {
    return this.ctx.world;
  }

  async prepare(resume: Record<string, unknown> | null, continued = false) {
    const { stage } = this.ctx;
    const w = this.w;
    this.step = (resume?.step as number) ?? 0;
    const q = new URLSearchParams(location.search);
    if (q.has("debug") && q.get("from")) this.step = { tower: 1, breach: 2, street: 3 }[q.get("from")!] ?? this.step;
    this.base = w.heightAt(T.x, T.z);
    const [dragons, fx] = await Promise.all([stage.ensureDragons(), stage.ensureTownFx()]);
    this.dragons = dragons;
    const dragon = (this.dragon = dragons.dragon);
    this.fx = fx;
    dragon.root.setEnabled(true);
    if (!continued || this.step > 0) {
      dragons.take();
      dragon.root.position.set(T.x, this.base + TOWER_TOP, T.z);
      dragon.setYaw(Math.atan2(-(PL.x - T.x), -(PL.z - T.z)));
      dragon.play("Idle", { blend: 0 });
    }
    // the cast
    const brun = w.npc("brun", { outfit: OUTFITS.rebel, hair: ["hair_simpleparted", "hair_beard"] });
    const leader = w.npc("leader", { outfit: OUTFITS.rebelLeader, hair: ["hair_beard"] });
    const scribe = w.npc("scribe", { outfit: OUTFITS.soldier, hair: ["hair_simpleparted"] });
    for (const k of ["captain", "general", "priestess", "headsman", "archer", "escort0", "escort1", "p1"]) {
      if (!w.npcs.has(k) && this.step === 0) {
        const female = k === "priestess";
        if (female) await w.ensureFemale();
        const c = w.npc(k, { sex: female ? "f" : "m", outfit: k === "p1" ? OUTFITS.peasant : OUTFITS.soldier, hair: female ? ["hair_buns"] : ["hair_buzzed"] });
        stand(w, c, rand(50, 68), rand(-598, -590), PL);
      }
    }
    const deck = w.heightAt(PL.x, PL.z) + 0.8;
    if (this.step === 0) {
      if (!continued) {
        stand(w, brun, 56.2, -594, PL);
        stand(w, leader, 54, -594, PL);
        stand(w, scribe, 65, -597.5, PL);
      }
      const p = new Vector3(PL.x, deck + 0.05, PL.z + 0.65);
      this.player = await stage.ensurePlayer(p, 0);
    } else {
      // resumed later in the chapter: the tower is open, the town already burns
      stand(w, brun, TOWER_IN.x, TOWER_IN.z + 0.6, { x: T.x, z: T.z });
      stand(w, leader, T.x + 1.6, T.z + 1.6, { x: T.x, z: T.z });
      for (const k of ["captain", "general", "priestess", "headsman", "archer", "escort0", "escort1", "p1", "p2"]) w.removeNpc(k);
      const at =
        this.step === 1 ? new Vector3(TOWER_DOOR.x, this.base + 0.1, TOWER_DOOR.z)
        : this.step === 2 ? new Vector3(T.x + 1.2, this.base + T.floor2 + 0.1, T.z + 1.2)
        : new Vector3(STREET.x, w.heightAt(STREET.x, STREET.z) + 0.1, STREET.z);
      this.player = await stage.ensurePlayer(at, this.step === 3 ? Math.PI / 2 : -Math.PI / 2);
      if (this.step >= 2) stage.breakBreach();
      stand(w, scribe, STREET.x - 1.5, STREET.z + 1, { x: STREET.x + 5, z: STREET.z - 5 });
    }
    this.player.enabled = true;
    this.player.canMove = true;
    this.player.firstPerson = true;
  }

  // ------------------------------------------------------------------ ambient destruction

  /** Fireballs falling around (never right on top of) the player. */
  private async meteorLoop() {
    const d = this.ctx.director;
    while (this.alive) {
      await d.sleep(rand(2.6, 5.5));
      if (!this.meteors) continue;
      const p = this.player.position;
      const a = Math.random() * Math.PI * 2, r = rand(9, 34);
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      const from = new Vector3(x + rand(-40, 40), this.w.heightAt(x, z) + 110, z + rand(-40, 40));
      void this.fx.fireball(from, x, z, 45, { linger: rand(6, 12) });
    }
  }

  /** The raid the dragon flies whenever no scripted moment needs it: laps of the town, strafing houses. */
  private get raid(): RampageSpec {
    return { center: { x: 72, z: -592 }, r: 58, yMin: this.base + 30, yMax: this.base + 42 };
  }

  /** Back to the raid (the stage's dragon goes on with it after this chapter, too). */
  private rampage() {
    // (undefined only when prepare() failed and the chapter is being passed over)
    this.dragons?.rampage(this.raid);
  }

  /** Set a house alight (each house burns once; it keeps burning after this chapter). */
  private burnHouse(i: number) {
    this.ctx.stage.townFires?.burn(i);
  }

  /** Archers loose arrows at the dragon while it is near. */
  private async archerLoop(ch: Character) {
    const d = this.ctx.director;
    while (this.alive && this.w.npcs.get(ch.name) === ch) {
      const target = this.dragon.root.position;
      if (Vector3.Distance(target, ch.root.position) < 90) {
        faceTo(ch, target);
        ch.play("Bow_Aim_Neutral", { blend: 0.2 });
        await d.sleep(rand(0.8, 1.6));
        faceTo(ch, this.dragon.root.position);
        ch.play("Bow_Shoot", { loop: false, blend: 0.05, offset: 0 });
        void audio.playOneShot("audio/sfx_bow", 0.6, ch.root.position, "sfx", rand(0.95, 1.05), 4);
        const from = ch.root.position.add(new Vector3(0, 1.45, 0));
        void shootArrow(this.w, from, () => this.dragon.root.position.add(new Vector3(0, 2, 0)), 55).then(({ mesh }) => mesh.dispose());
        await d.sleep(0.6);
        ch.play("Bow_Notch", { loop: false, blend: 0.1, offset: 0 });
      }
      await d.sleep(rand(1.2, 2.5));
    }
  }

  // ------------------------------------------------------------------ story

  async run() {
    this.started = true;
    const { director: d, stage } = this.ctx;
    const w = this.w;
    const n = (k: string) => w.npcs.get(k)!;
    const head = (k: string) => () => n(k).root.position.add(new Vector3(0, 1.62, 0));
    const name = stage.appearance?.name || "朋友";
    const pl = this.player;
    const g = (x: number, z: number) => new Vector3(x, w.heightAt(x, z), z);
    w.env.setMood(this.step === 0 ? 0.2 : 1);
    audio.musicTracks = { combat: "audio/music_battle" };
    audio.setMusicState("combat");
    // (both beds outlast the chapter: the next one decides when they stop)
    void audio.startBed("panic", "audio/panic", 0.45, 3);
    void audio.startBed("wind", "audio/wind", 0.25, 3);
    void this.meteorLoop().catch((e) => !(e instanceof Cancelled) && console.error(e));
    let mood = this.step === 0 ? 0.2 : 1;
    this.offs.push(
      w.onUpdate((dt) => {
        if (mood < 1) w.env.setMood((mood = Math.min(1, mood + dt / 25)));
      }),
    );
    for (const i of [4, 7]) this.burnHouse(i);
    // resumed later in the chapter: the town is already under attack
    if (this.step > 0) this.meteors = true;
    if (this.step === 1 || this.step === 3) this.rampage();

    if (this.step < 1) {
      // dazed on the platform; the world comes back
      w.rig.pitch = 0.5;
      hud.flash(0.7, 2.5);
      await d.wait(hud.fade(false, 2.5));
      pl.canMove = false;
      // everybody scrambles
      const up = (k: string, clip = "KipUp") => w.npcs.has(k) && n(k).play(clip, { loop: false, offset: 0, blend: 0.2 });
      for (const k of ["captain", "general", "priestess", "scribe", "brun", "p1", "leader", "headsman", "archer", "escort0", "escort1"]) up(k, Math.random() < 0.5 ? "KipUp" : "LayToIdle");
      await d.sleep(1.2);
      // the dragon takes off from the tower
      this.dragon.play("Fly", { blend: 0.8 });
      void audio.playOneShot("audio/wings", 1.2, this.dragon.root.position, "sfx", 1, 40);
      void this.dragons.pass([new Vector3(T.x + 10, this.base + 30, T.z - 20), new Vector3(60, this.base + 40, -640), new Vector3(20, this.base + 36, -600)], 18, { then: () => this.rampage() });
      w.rig.lookToward(() => this.dragon.root.position, 2.5);
      await d.sleep(1.6);
      const brun = n("brun");
      void walkPath(w, brun, [g(57, -598), g(PL.x - 1.2, PL.z + 3.8)], { speed: 4.4, clip: "Sprint_Loop" }).then(() => faceTo(brun, pl.position));
      void walkPath(w, n("leader"), [g(70, -590), g(TOWER_DOOR.x, TOWER_DOOR.z), g(T.x + 1.6, T.z + 1.6)], { speed: 4 });
      if (w.npcs.has("general")) void walkPath(w, n("general"), [g(56, -620), g(KEEP_GATE.x, KEEP_GATE.z)], { speed: 3.6 }).then(() => w.removeNpc("general"));
      if (w.npcs.has("priestess")) void walkPath(w, n("priestess"), [g(52, -615), g(KEEP_GATE.x - 2, KEEP_GATE.z)], { speed: 3.8 }).then(() => w.removeNpc("priestess"));
      if (w.npcs.has("headsman")) void walkPath(w, n("headsman"), [g(66, -612), g(70, -640)], { speed: 3.6 }).then(() => w.removeNpc("headsman"));
      if (w.npcs.has("captain")) void walkPath(w, n("captain"), [g(66, -596), g(70, -588)], { speed: 3.6 }).then(() => n("captain").play("Idle_Loop"));
      void walkPath(w, n("scribe"), [g(72, -590), g(84, -572), g(STREET.x - 1.5, STREET.z + 1)], { speed: 3.8 });
      for (const k of ["archer", "escort0"]) if (w.npcs.has(k)) void this.archerLoop(n(k)).catch(() => {});
      // one of the prisoners runs for it and does not make it
      if (w.npcs.has("p1")) {
        const p1 = n("p1");
        void walkPath(w, p1, [g(50, -600), g(42, -612)], { speed: 4.6, clip: "Sprint_Loop" });
        void d.sleep(2.4).then(async () => {
          if (!w.npcs.has("p1")) return;
          const at = p1.root.position.clone();
          const hit = await this.fx.fireball(at.add(new Vector3(30, 90, -20)), at.x - 1.5, at.z - 2.5, 50, { linger: 10 });
          if (!this.alive || !w.npcs.has("p1") || !w.physics) return;
          const push = p1.root.position.subtract(hit).normalize().scale(7).add(new Vector3(0, 5, 0));
          this.ragdolls.push(new Ragdoll(w.physics, p1, push, "pelvis"));
        }).catch(() => {});
      }
      this.meteors = true;
      await d.sleep(1.2);
      w.rig.lookToward(head("brun"), 1.2);
      await d.say("布伦", `${name}！别躺着——再躺下去，就真起不来了！`, { npc: brun, look: () => pl.eye(new Vector3()), duration: 2.9 });
      await d.say("布伦", "塔楼！石头墙烧不透——走！", { npc: brun, look: () => pl.eye(new Vector3()), duration: 2.5 });
      pl.canMove = true;
      const door = () => g(TOWER_DOOR.x, TOWER_DOOR.z).add(new Vector3(0, 1.5, 0));
      objective.set("跟随布伦进入塔楼", door);
      void walkPath(w, brun, [g(70, -592), g(TOWER_DOOR.x, TOWER_DOOR.z), g(TOWER_IN.x, TOWER_IN.z + 0.6)], { speed: 4.2, clip: "Sprint_Loop" }).then(() => faceTo(brun, { x: TOWER_DOOR.x, z: TOWER_DOOR.z }));
      // show where he is going before he disappears behind the houses
      w.rig.lookToward(door, 1.6);
      const toDoor = () => Math.hypot(pl.position.x - TOWER_DOOR.x, pl.position.z - TOWER_DOOR.z);
      const stopNag = nag(w, "布伦", ["这边！塔楼在这边！", `${name}，快！到塔里来！`], () => this.inTower(pl.position), 12, toDoor);
      try {
        await d.until(() => this.inTower(pl.position));
      } finally {
        stopNag();
      }
      objective.retarget(null);
      this.step = 1;
      void this.ctx.game.save("auto");
    }

    if (this.step < 2) {
      faceTo(n("leader"), pl.position);
      await d.say("托尔瓦德", "我在寒脊听了一辈子的歌……没有一首说它会这么大。", { npc: n("leader"), look: () => pl.eye(new Vector3()) });
      await d.say("布伦", "管它是什么，活下来再说！楼上有窗——往上爬！", { npc: n("brun"), look: () => pl.eye(new Vector3()) });
      // the stairs run along the walls: flight 1 rises +X along the -Z wall, flight 2 rises -X along the
      // +Z wall (tools/gen/townbuildings.mjs): point at the top of the flight being climbed
      objective.set("爬上塔楼", () => {
        const y = pl.position.y - this.base;
        if (y < 0.4) return new Vector3(T.x - 2.7, this.base + 0.8, T.z - 2.35); // foot of flight 1
        if (y < TOWER_FLOOR1 - 0.15) return new Vector3(T.x + 2.1, this.base + TOWER_FLOOR1 + 0.8, T.z - 2.35); // its top
        if (y < TOWER_FLOOR1 + 0.15) return new Vector3(T.x + 2.1, this.base + TOWER_FLOOR1 + 0.8, T.z + 2.35); // foot of flight 2
        if (y < T.floor2 - 0.6) return new Vector3(T.x - 2.7, this.base + T.floor2 + 0.8, T.z + 2.35); // its top
        return new Vector3(T.x + TOWER_HALF, this.base + T.floor2 + 1.2, T.z);
      });
      const up = () => this.inTower(pl.position) && pl.position.y > this.base + T.floor2 - 0.6;
      const stopNag = nag(w, "布伦", ["往上爬！别停！", "楼梯就在墙边——上去！"], up, 14, () => this.base + T.floor2 - pl.position.y);
      try {
        await d.until(up);
      } finally {
        stopNag();
      }
      // the dragon smashes the wall in front of the player
      const dr = this.dragon;
      const breach = new Vector3(T.x + TOWER_HALF, this.base + T.floor2 + 1.2, T.z);
      const hover = new Vector3(T.x + 26, this.base + T.floor2 + 9, T.z - 8);
      await d.wait(this.dragons.pass([hover.add(new Vector3(20, 10, -30)), hover], 30));
      dr.setYaw(Math.atan2(-(breach.x - hover.x), -(breach.z - hover.z)));
      void audio.playOneShot("audio/roar_a", 1.4, dr.mouth(), "sfx", 1, 40);
      await d.sleep(0.6);
      await d.wait(this.fx.fireballTo(dr.mouth(), breach, 30, { linger: 0, scorch: false }));
      stage.breakBreach(new Vector3(-1, 0.15, 0));
      void audio.playOneShot("audio/collapse", 1.5, breach, "sfx", 1, 20);
      w.rig.shake(0.03, 1.2);
      hud.flash(0.5, 1);
      this.fx.burst(breach.add(new Vector3(-1.2, 0, 0)), 1.2);
      // the tower room keeps burning (with the town) after this chapter
      stage.townFires?.track(this.fx.fire(new Vector3(T.x + 2.2, this.base + T.floor2 + 0.1, T.z - 2.2), 0.5, { smoke: true, light: true }));
      void this.dragons.pass([hover.add(new Vector3(30, 12, 40)), new Vector3(110, this.base + 38, -640)], 24, { then: () => this.rampage() });
      this.step = 2;
      void this.ctx.game.save("auto");
      await d.sleep(1.4);
    }

    if (this.step < 3) {
      w.env.setMood(1);
      this.rampage();
      await d.say("布伦", "对面旅店的房顶烧穿了——跳！我带领主大人从楼梯绕下去，咱们在楼下碰头！", { npc: n("brun"), duration: 4.3 });
      const breachMark = new Vector3(T.x + TOWER_HALF, this.base + T.floor2 + 1.2, T.z);
      const roofHole = new Vector3(INN.x - INN.w / 2 + 2.2, this.base + INN.floor + 1, INN.z);
      objective.set("从缺口跳进旅店的屋顶", () => (pl.position.x < T.x + TOWER_HALF ? breachMark : roofHole));
      hud.prompt(input.usingPad ? "A 跳跃" : "空格 跳跃");
      // in the inn (or anywhere on the far side of the wall)
      const across = () => pl.position.x > T.x + TOWER_HALF + 0.4 && pl.position.y < this.base + T.floor2 - 0.4;
      const stopNag = nag(w, "布伦", ["跳啊！它马上就回来了！", "往缺口外跳——旅店的屋顶接得住你！"], across, 12);
      try {
        await d.until(across);
      } finally {
        stopNag();
      }
      hud.prompt(null);
      const floorHole = new Vector3(INN.x + 2.6, this.base + INN.floor, INN.z - 0.1);
      const innDoor = new Vector3(INN.x + 1.9, this.base + 1, INN.z + INN.d / 2 + 0.6);
      if (this.inInn(pl.position)) {
        objective.set("从地板的破洞下去，找到出口", () => (pl.position.y > this.base + INN.floor - 0.6 ? floorHole : innDoor));
        stage.townFires?.track(this.fx.fire(new Vector3(INN.x - 3, this.base + INN.floor + 0.3, INN.z + 2.6), 0.6, { light: true }));
        await d.until(() => !this.inInn(pl.position) || Vector3.Distance(pl.position, g(STREET.x, STREET.z)) < 4);
      } else {
        // missed the roof: down in the street already — go round to where the scribe waits
        objective.set("到旅店门前的街上去", () => g(STREET.x, STREET.z).add(new Vector3(0, 1, 0)));
        await d.until(() => Math.hypot(pl.position.x - STREET.x, pl.position.z - STREET.z) < 8);
      }
      objective.retarget(null);
      this.step = 3;
      void this.ctx.game.save("auto");
    }

    // follow the scribe to the keep
    const scribe = n("scribe");
    stopWalk(scribe);
    if (Vector3.Distance(scribe.root.position, g(STREET.x, STREET.z)) > 12) stand(w, scribe, STREET.x - 1.5, STREET.z + 1, pl.position);
    faceTo(scribe, pl.position);
    w.rig.lookToward(head("scribe"), 1.2);
    await d.say("书记官", `${name}？……你命真硬。`, { npc: scribe, look: () => pl.eye(new Vector3()) });
    await d.say("书记官", "贴着我走，别离开三步以内。", { npc: scribe, look: () => pl.eye(new Vector3()) });
    objective.set("跟随书记官前往要塞", () => scribe.root.position.add(new Vector3(0, 1.6, 0)));
    const route = LAYOUT.escape.slice(1);
    for (let i = 0; i < route.length; i++) {
      const p = route[i];
      await d.wait(walkPath(w, scribe, [g(p.x, p.z)], { speed: 3.8 }));
      if (i === 1) {
        // the dragon sweeps the street ahead
        faceTo(scribe, pl.position);
        scribe.play("Crouch_Idle_Loop", { blend: 0.3 });
        await d.say("书记官", "别动——等它把火喷完！", { npc: scribe, look: () => pl.eye(new Vector3()), duration: 2.0 });
        const dr = this.dragon;
        const a = new Vector3(70, this.base + 40, -530), b = new Vector3(66, this.base + 11, -584), c = new Vector3(60, this.base + 16, -630);
        await d.wait(this.dragons.pass([a], 32));
        const pass = this.dragons.pass([b, c], 18);
        await d.sleep(Vector3.Distance(a, b) / 18 - 1.6);
        void this.fx.breath(() => {
          const s = dr.breathSource();
          const t = g(64, -592);
          return { pos: s.pos, dir: t.subtract(s.pos).normalize() };
        }, 2.4);
        await d.sleep(1.8);
        for (const [x, z] of [[65, -588], [63.5, -594], [62.5, -600]]) {
          // (burns out on the effects' own clock: the chapter may end meanwhile)
          this.fx.fire(g(x, z), 0.9, { sound: x === 63.5, seconds: 9 });
          this.fx.scorch(x, z, 3);
        }
        await d.wait(pass);
        this.rampage();
        await d.sleep(2.5);
        await d.say("书记官", "走！趁现在！", { npc: scribe, look: () => pl.eye(new Vector3()), duration: 1.4 });
      }
      // wait for the player to keep up
      if (Vector3.Distance(pl.position, scribe.root.position) > 9) {
        scribe.play("Idle_Loop", { blend: 0.3 });
        faceTo(scribe, pl.position);
        const close = () => Vector3.Distance(pl.position, scribe.root.position) < 7;
        const stopNag = nag(w, "书记官", ["这边！跟上！", `${name}！别掉队！`], close, 10);
        try {
          await d.until(close);
        } finally {
          stopNag();
        }
      }
    }
    // at the keep
    faceTo(scribe, pl.position);
    const brun = n("brun");
    stopWalk(brun);
    stand(w, brun, LAYOUT.keep.x - 16, KEEP_GATE.z + 6, pl.position);
    void walkPath(w, brun, [g(KEEP_GATE.x - 4, KEEP_GATE.z + 1)], { speed: 4.4, clip: "Sprint_Loop" });
    await d.until(() => Vector3.Distance(pl.position, scribe.root.position) < 6);
    await d.say("布伦", `${name}！到这边来，跟我进要塞！`, { npc: brun, look: () => pl.eye(new Vector3()), duration: 2.6 });
    await d.say("书记官", "别听那个叛军的！跟我走！", { npc: scribe, look: () => pl.eye(new Vector3()), duration: 2.4 });
    await d.sleep(0.8);
  }

  private inTower(p: Vector3) {
    return Math.abs(p.x - T.x) < TOWER_HALF - 0.3 && Math.abs(p.z - T.z) < TOWER_HALF - 0.3;
  }

  private inInn(p: Vector3) {
    return Math.abs(p.x - INN.x) < INN.w / 2 && Math.abs(p.z - INN.z) < INN.d / 2;
  }

  save() {
    return { step: this.step };
  }

  /**
   * The chapter's end state: the town burns, the dragon goes on raiding, and the player, Brun and the
   * scribe stand before the keep gate where the keep chapter starts (its step-0 marks).
   */
  skip() {
    const { stage } = this.ctx;
    const w = this.w;
    this.alive = false;
    this.meteors = false;
    stage.breakBreach();
    stage.townFires?.ensure(RAIDED_HOUSES);
    // the dragon flies on (never frozen mid-air)
    this.rampage();
    const pl = K0.player;
    this.player?.teleport(new Vector3(pl.x, w.heightAt(pl.x, pl.z) + 0.1, pl.z), 0);
    for (const k of ["brun", "scribe"] as const) {
      const c = w.npcs.get(k);
      if (c) stand(w, c, K0[k].x, K0[k].z, pl);
    }
  }

  /**
   * Ends only what is this chapter's own. The dragon, the town's fires and the wind and panic beds
   * belong to the stage and carry on into the next chapter (a seamless handover: nothing pops,
   * freezes or starts over); the keep quiets the beds once the player is inside (K1), and the stage
   * stops every bed when it goes.
   */
  dispose() {
    this.alive = false;
    this.meteors = false;
    for (const o of this.offs) o();
    for (const r of this.ragdolls) r.dispose();
    if (this.started) {
      hud.prompt(null);
      audio.resetMusicState();
    }
  }
}
