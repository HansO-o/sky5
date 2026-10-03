import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { audio } from "../../core/audio";
import { hud } from "../../ui/hud";
import { loadGLB } from "../../game/loaders";
import { OUTFITS, type Character } from "../../world/characters";
import { LAYOUT } from "../../world/town";
import { faceTo, stand, walkPath } from "../actors";
import type { Dragon } from "../dragon";
import type { PlayerController } from "../player";
import type { Chapter, ChapterContext } from "./types";

const PL = LAYOUT.platform;
const GENERAL = { x: 55.2, z: -598.2 };
const PRIESTESS = { x: 57.6, z: -599.2 };
const CAPTAIN = { x: LAYOUT.square.x + 6, z: LAYOUT.square.z + 2 };
/** the headsman stands east of the block, so the kneeling player sees him against the tower */
const HEADSMAN = { x: PL.x + 1.7, z: PL.z - 0.2 };
/** where a prisoner kneels: just north of the block, head over it */
const KNEEL = { x: PL.x, z: PL.z + 0.35 };
const TOWER_TOP = 13.5;
/** prisoners wait here (in front of the execution platform) */
export const WAIT = (i: number) => ({ x: 54 + i * 2.2, z: -594 });
/** the muster's soldiers keep guard around the square */
export const GUARDS: [string, number, number][] = [["scribe", 65, -597.5], ["archer", 51.5, -597], ["escort0", 68.5, -593], ["escort1", 49.5, -591]];

/**
 * The execution's own cast at their posts: the general, the priestess and the headsman with his
 * axe. The muster sets them up behind its fade-in, so nobody pops up in view at the seamless
 * hand-off. `place`: also put back those who already exist. Resolves with the axe.
 */
export async function castExecution(w: World, place: boolean) {
  const look = { x: 58, z: -594 };
  const post = (k: string, spec: Parameters<World["npc"]>[1], at: (c: Character) => void) => {
    const had = w.npcs.has(k);
    const c = w.npc(k, spec);
    if (place || !had) at(c);
    return c;
  };
  post("general", { outfit: OUTFITS.soldier, hair: ["hair_simpleparted", "hair_beard"] }, (c) => stand(w, c, GENERAL.x, GENERAL.z, look, "Idle_FoldArms_Loop"));
  const headsman = post("headsman", { outfit: OUTFITS.peasant, hair: ["hair_buzzed", "hair_beard"] }, (c) => {
    stand(w, c, HEADSMAN.x, HEADSMAN.z, KNEEL);
    c.root.position.y = w.heightAt(PL.x, PL.z) + 0.8; // on the deck
  });
  const [axe] = await Promise.all([
    attachAxe(w, headsman),
    w.ensureFemale().then(() => {
      if (!w.disposed) post("priestess", { sex: "f", outfit: OUTFITS.peasant, hair: ["hair_buns"] }, (c) => stand(w, c, PRIESTESS.x, PRIESTESS.z, look));
    }),
  ]);
  return axe;
}

/** the axe in each headsman's hand (the muster and the execution both ask for it) */
const axes = new WeakMap<Character, Promise<TransformNode | null>>();

/** Put the axe in the headsman's right hand, once; null when he is gone by the time it has loaded. */
function attachAxe(w: World, headsman: Character) {
  let p = axes.get(headsman);
  if (!p) {
    p = loadGLB("ph/wooden_axe_03", w.scene).then((c) => {
      const hand = headsman.bone("hand_r");
      if (!hand || headsman.root.isDisposed()) return null;
      const inst = c.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
      const axe = inst.rootNodes[0] as TransformNode;
      axe.parent = hand;
      // handle along the hand's grip axis, blade out
      axe.position.set(0.0, 0.08, 0.02);
      axe.rotationQuaternion = null;
      axe.rotation.set(0, 0, Math.PI / 2);
      axe.scaling.setAll(1.25);
      w.addShadowCasters(axe.getChildMeshes(false));
      return axe;
    });
    axes.set(headsman, p);
    // a failed load is tried again by the next caller
    p.catch(() => axes.delete(headsman));
  }
  return p;
}

/**
 * Segment 4: the general's sentence, the priestess, the first execution, distant roars, the player at
 * the block; the dragon lands on the watchtower and its roar knocks everyone flat.
 */
export class ExecutionChapter implements Chapter {
  id = "execution" as const;
  label = "处决";
  seamless = true;
  player!: PlayerController;
  private axe: TransformNode | null = null;
  private dragon: Dragon | null = null;
  private deck = 0;
  private offs: (() => void)[] = [];
  private step = 0;

  constructor(private ctx: ChapterContext) {}

  private get w() {
    return this.ctx.world;
  }

  async prepare(resume: Record<string, unknown> | null, continued = false) {
    const { stage } = this.ctx;
    this.step = (resume?.step as number) ?? 0;
    // debug: ?debug&chapter=execution&from=block starts at the walk to the block
    const q = new URLSearchParams(location.search);
    if (q.has("debug") && q.get("from") === "block") this.step = 1;
    const w = this.w;
    this.deck = w.heightAt(PL.x, PL.z) + 0.8;
    const square = { x: PL.x, z: PL.z };
    // cast from the muster (created here when the chapter is started from a save)
    const prisoners: [string, Parameters<World["npc"]>[1]][] = [
      ["leader", { outfit: OUTFITS.rebelLeader, hair: ["hair_beard"] }],
      ["brun", { outfit: OUTFITS.rebel, hair: ["hair_simpleparted", "hair_beard"] }],
      ["p1", { outfit: OUTFITS.peasant, hair: ["hair_long"] }],
      ["p2", { outfit: OUTFITS.rebel, hair: ["hair_buzzed", "hair_beard"] }],
    ];
    prisoners.forEach(([k, spec], i) => {
      const had = w.npcs.has(k);
      const c = w.npc(k, spec);
      // after the muster they are still walking over; only place them when starting here
      if (!continued || !had) stand(w, c, WAIT(i).x, WAIT(i).z, square);
    });
    w.npc("leader").headDown = 0.25;
    const captain = w.npc("captain", { outfit: OUTFITS.soldier, hair: ["hair_buzzed"] });
    if (!continued) stand(w, captain, CAPTAIN.x, CAPTAIN.z, square);
    // guards around the square (the muster's soldiers: after it they are still on their way over)
    for (const [k, x, z] of GUARDS) {
      const had = w.npcs.get(k);
      if (!continued || !had) stand(w, had ?? w.npc(k, { outfit: OUTFITS.soldier }), x, z, square);
    }
    for (const k of ["driver", "lead_driver", "rowan"]) w.removeNpc(k);
    // the general, the priestess and the headsman have stood on the square since the muster
    this.axe = await castExecution(w, !continued);
    if (!continued) {
      const p = new Vector3(WAIT(4).x, w.heightAt(WAIT(4).x, WAIT(4).z) + 0.05, WAIT(4).z);
      this.player = await stage.ensurePlayer(p, 0);
      this.player.firstPerson = true;
    } else this.player = stage.player!;
    this.player.canMove = true;
    // the dragon streams in the background while the sentence is read (a failed load is tried
    // again where the script needs the dragon)
    void w.ensureDragon()
      .then((d) => {
        this.dragon = d;
        d.root.setEnabled(false);
      })
      .catch((e) => console.warn("dragon prefetch failed", e));
  }

  async run() {
    const { director: d, stage } = this.ctx;
    const w = this.w;
    const n = (k: string) => w.npcs.get(k)!;
    const head = (k: string) => () => n(k).root.position.add(new Vector3(0, 1.62, 0));
    const playerEye = () => this.player.eye(new Vector3());
    const name = stage.appearance?.name || "囚犯";
    const hs = n("headsman");
    void hud.fade(false, 1.2);

    if (this.step < 1) {
      // the prisoners still walking over from the roll call
      await d.until(() => Vector3.Distance(n("p2").root.position, new Vector3(WAIT(3).x, n("p2").root.position.y, WAIT(3).z)) < 0.3 || this.player.position.z < -588, 25);
      for (const k of ["leader", "brun", "p1", "p2"]) faceTo(n(k), { x: PL.x, z: PL.z });
      void audio.playMusic("audio/music_tense", { fade: 4, volume: 0.7 });
      void audio.playOneShot("audio/bell", 0.6, { x: LAYOUT.keep.x, y: 50, z: LAYOUT.keep.z }, "sfx", 1, 40);
      this.player.canMove = false;
      w.rig.lookToward(head("general"), 1.4);

      await d.say("维罗将军", "托尔瓦德·霜颌。你烧了三座税仓、砍了两个督军，寒脊管这叫起义。帝国管这叫账。", { npc: n("general"), look: head("leader"), talk: "Idle_Talking_Loop", idle: "Idle_FoldArms_Loop" });
      await d.say("维罗将军", "这笔账，今天在这块木墩上结清。", { npc: n("general"), look: head("leader"), talk: "Idle_Talking_Loop", idle: "Idle_FoldArms_Loop", gap: 1.2 });
      // something far away
      void audio.playOneShot("audio/roar_c", 0.5, { x: -260, y: 260, z: -980 }, "sfx", 0.85, 400);
      await d.sleep(2.2);
      await d.say("囚犯", "……那是什么声音？", { npc: n("p1"), look: () => new Vector3(-200, 200, -900) });
      await d.say("维罗将军", "山里的雪崩罢了。别停。", { npc: n("general"), look: head("captain") });
      await d.say("帝国队长", "是。女祭司，念吧——念短点。", { npc: n("captain"), look: head("priestess") });
      w.rig.lookToward(head("priestess"), 1.2);
      n("priestess").play("Spell_Simple_Idle_Loop", { blend: 0.4 });
      await d.say("女祭司", "愿你们在雪下安睡，愿你们的名字——", { npc: n("priestess"), look: head("p2"), duration: 2.4 });

      // the first prisoner has had enough
      const p2 = n("p2");
      const steps = (z: number) => new Vector3(PL.x, this.deck, z);
      const g = (x: number, z: number) => new Vector3(x, w.heightAt(x, z), z);
      void walkPath(w, p2, [g(60.4, -596.5), g(PL.x, PL.z + 3.6), steps(PL.z + 2.5), steps(KNEEL.z + 0.45)], { speed: 1.4 });
      w.rig.lookToward(head("p2"), 2);
      await d.say("霜誓军囚犯", "省省吧，女祭司。我的神不住在你们的庙里。动手吧。", { npc: p2, look: head("priestess"), duration: 3.4 });
      n("priestess").play("Idle_Loop", { blend: 0.5 });
      await d.say("女祭司", "……那就让雪替你祈祷。", { npc: n("priestess"), look: head("p2"), gap: 0.6 });
      await d.until(() => Vector3.DistanceSquared(p2.root.position, steps(KNEEL.z + 0.45)) < 0.02, 15);
      faceTo(p2, { x: KNEEL.x, z: KNEEL.z - 5 });
      p2.play("Crouch_Idle_Loop", { blend: 0.5 });
      p2.headDown = 0.7;
      await d.say("霜誓军囚犯", "你们记住我的脸。寒脊会来讨的。", { npc: p2, duration: 2.5, gap: 0.4 });
      // the axe rises; the player is turned toward Brun for the blow
      await this.raiseAxe(hs);
      w.rig.lookToward(head("brun"), 1.4);
      await d.sleep(0.9);
      hs.play("OverhandThrow", { speed: 1.2 }); // the blow
      await d.sleep((0.15 * hs.clipLength("OverhandThrow")) / 1.2);
      void audio.playOneShot("audio/sfx_arrow_hit", 1, { x: KNEEL.x, y: this.deck, z: KNEEL.z }, "sfx", 0.55, 6);
      w.rig.shake(0.004, 0.3);
      p2.headDown = 0;
      p2.play("Death01", { loop: false, offset: 0, blend: 0.1 });
      hs.play("Idle_Loop", { blend: 0.6 });
      await d.say("布伦", "霜誓军的兄弟，走好。", { npc: n("brun"), look: () => p2.root.position, gap: 0.4 });
      await d.say("囚犯", "（低声）……下一个就是我们。", { npc: n("p1"), look: playerEye, gap: 0.6 });

      // closer this time
      void audio.playOneShot("audio/roar_b", 0.9, { x: -120, y: 160, z: -820 }, "sfx", 0.9, 220);
      w.rig.shake(0.003, 1.2);
      await d.sleep(1.4);
      await d.say("书记官", "……又是那声音。你们都没听见吗？", { npc: n("scribe"), look: () => new Vector3(-120, 160, -820) });
      await d.say("帝国队长", "下一个——名单最后添上的那个。", { npc: n("captain"), look: playerEye });
      w.removeNpc("p2"); // the body is carried off while the camera is on the player
      this.step = 1;
    } else {
      w.removeNpc("p2");
      void audio.playMusic("audio/music_tense", { fade: 2, volume: 0.7 });
    }


    // walk to the block (the view is guided; the body is hidden in first person)
    this.player.enabled = false;
    const eye = playerEye();
    w.rig.cut(eye, eye.add(new Vector3(-Math.sin(w.rig.yaw), Math.sin(w.rig.pitch), -Math.cos(w.rig.yaw)).scale(5)));
    const at = (x: number, y: number, z: number) => new Vector3(x, y, z);
    const g0 = w.heightAt(PL.x, PL.z + 3.6);
    await d.wait(w.rig.glide(at(PL.x + 0.2, g0 + 1.62, PL.z + 3.8), at(PL.x, this.deck + 1, PL.z - 1), 3.2));
    await d.wait(w.rig.glide(at(PL.x, this.deck + 1.62, KNEEL.z + 0.6), at(PL.x, this.deck + 0.9, PL.z - 1), 1.6));
    // kneel: the head over the block, looking up at the headsman with the tower behind him
    const tower = at(LAYOUT.tower.x, w.heightAt(LAYOUT.tower.x, LAYOUT.tower.z) + TOWER_TOP, LAYOUT.tower.z);
    const kneelEye = at(PL.x + 0.05, this.deck + 0.62, PL.z - 0.25);
    const look = at(tower.x, tower.y + 3, tower.z);
    await d.wait(w.rig.glide(kneelEye, look, 1.3));
    this.player.teleport(at(KNEEL.x, this.deck + 0.05, KNEEL.z + 0.3), 0);
    await d.say("女祭司", `${name}……愿众神宽恕你。`, { npc: n("priestess"), gap: 0.3 });
    await this.raiseAxe(hs);

    // the dragon
    const dragon = this.dragon ?? (await d.wait(w.ensureDragon()));
    this.dragon = dragon;
    dragon.root.setEnabled(true);
    dragon.root.position.set(-40, tower.y + 80, -470);
    void audio.playOneShot("audio/wings", 1, { x: 40, y: tower.y + 30, z: -540 }, "sfx", 0.8, 60);
    const landYaw = Math.atan2(-(PL.x - tower.x), -(PL.z - tower.z));
    const flight = dragon.fly([at(30, tower.y + 50, -520), at(78, tower.y + 22, -560), at(tower.x + 2, tower.y + 6, tower.z - 4), at(tower.x, tower.y, tower.z)], 24);
    await d.sleep(2.2);
    void audio.playOneShot("audio/roar_a", 1.2, dragon.mouth(), "sfx", 1, 60);
    w.rig.shake(0.01, 1.5);
    await d.say("书记官", "那是什么？！", { npc: n("scribe"), duration: 1.4 });
    await d.wait(flight);
    dragon.setYaw(landYaw);
    dragon.play("Idle", { blend: 0.6 });
    void audio.playOneShot("audio/collapse_small", 1.2, tower, "sfx", 1, 30);
    w.rig.shake(0.02, 0.8);
    await d.say("维罗将军", "塔上的！看见什么了——", { npc: n("general"), look: () => tower, duration: 1.5 });
    await d.say("帝国队长", "龙！是龙！", { npc: n("captain"), look: () => tower, duration: 1.3 });
    // the roar knocks everyone down
    const roar = dragon.roar("roar_a", 2.6, 2.2);
    await d.sleep(0.4);
    w.rig.shake(0.05, 2.4);
    hs.play("Hit_Knockback", { loop: false, offset: 0, blend: 0.1 });
    for (const k of ["captain", "general", "priestess", "scribe", "brun", "p1", "leader"]) if (w.npcs.has(k)) n(k).play("Hit_Knockback", { loop: false, offset: 0, blend: 0.15 });
    hud.flash(0.9);
    await d.wait(roar);
    void audio.playOneShot("audio/wind", 0.6);
    await d.wait(hud.fade(true, 1.4));
  }

  /** Wind up the overhand swing and hold the axe above the head (the clip's first quarter). */
  private async raiseAxe(hs: Character) {
    const len = hs.clipLength("OverhandThrow");
    hs.play("OverhandThrow", { loop: false, speed: 0.5, offset: 0.04, blend: 0.3 });
    await this.ctx.director.sleep((0.25 - 0.04) * len / 0.5);
    hs.play("OverhandThrow", { speed: 0.0001 });
  }

  save() {
    return { step: this.step };
  }

  /** The dragon's end state: perched on the watchtower, facing the platform. */
  private perch(dragon: Dragon) {
    const w = this.w;
    dragon.stopFlight();
    dragon.root.setEnabled(true);
    const tx = LAYOUT.tower.x, tz = LAYOUT.tower.z;
    dragon.root.position.set(tx, w.heightAt(tx, tz) + TOWER_TOP, tz);
    dragon.setYaw(Math.atan2(-(PL.x - tx), -(PL.z - tz)));
    dragon.play("Idle", { blend: 0 });
  }

  skip() {
    const w = this.w;
    // a dragon still streaming in (a cold cache) lands on the tower once it is there: before the
    // next chapter's prepare, which waits for the same load, takes it over
    if (this.dragon) this.perch(this.dragon);
    else void w.ensureDragon().then((d) => !w.disposed && this.perch(d), () => {});
    w.removeNpc("p2");
    // the hand-off cast at their posts (behind the skip's fade): after a rushed muster the
    // prisoners, the captain and the guards can still be walking over, and a walk left running
    // would carry them on into the dragon chapter
    const square = { x: PL.x, z: PL.z };
    (["leader", "brun", "p1"] as const).forEach((k, i) => {
      const c = w.npcs.get(k);
      if (c) stand(w, c, WAIT(i).x, WAIT(i).z, square);
    });
    const cap = w.npcs.get("captain");
    if (cap) stand(w, cap, CAPTAIN.x, CAPTAIN.z, square);
    for (const [k, x, z] of GUARDS) {
      const c = w.npcs.get(k);
      if (c) stand(w, c, x, z, square);
    }
    this.player.teleport(new Vector3(KNEEL.x, this.deck + 0.05, KNEEL.z + 0.3), 0);
  }

  dispose() {
    for (const o of this.offs) o();
    void this.axe;
  }
}

type World = ChapterContext["world"];
