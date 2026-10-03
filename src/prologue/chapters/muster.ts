import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { audio } from "../../core/audio";
import { input } from "../../core/input";
import { hud } from "../../ui/hud";
import { openCreator } from "../../ui/creator";
import { OUTFITS, type Character } from "../../world/characters";
import { defaultAppearance, type Appearance } from "../../world/appearance";
import { LAYOUT } from "../../world/town";
import { Ragdoll } from "../../physics/ragdoll";
import { faceTo, stand, walkPath } from "../actors";
import { shootArrow } from "../fx/arrow";
import type { PlayerController } from "../player";
import { createPlayerBody, homeland, raceName } from "../playerBody";
import type { Chapter, ChapterContext } from "./types";

/** Where the prisoners line up after leaving the wagons, and who stands where. */
const LINE_Z = -540;
const LINE_X = { leader: 57, brun: 59.5, p1: 62, p2: 64.5, rowan: 67, player: 69.5 };
const OFFICER = { x: 50, z: -538.5 };
const SCRIBE = { x: 50.6, z: -541.6 };
const ARCHER = { x: 53, z: -531 };
/** prisoners wait here (in front of the execution platform) */
export const WAIT = (i: number) => ({ x: 54 + i * 2.2, z: -594 });

/**
 * Segment 3: unloading, roll call, the thief's escape attempt, "who are you?" (character creation),
 * then the player follows the captain to the square.
 */
export class MusterChapter implements Chapter {
  id = "muster" as const;
  label = "点名";
  player!: PlayerController;
  private ragdolls: Ragdoll[] = [];
  private step = 0;

  constructor(private ctx: ChapterContext) {}

  private get w() {
    return this.ctx.world;
  }

  async prepare(resume: Record<string, unknown> | null) {
    const { stage } = this.ctx;
    const w = this.w;
    this.step = (resume?.step as number) ?? 0;
    // cast (some already exist from the ride)
    const brun = w.npc("brun", { outfit: OUTFITS.rebel, hair: ["hair_simpleparted", "hair_beard"] });
    const rowan = w.npc("rowan", { outfit: OUTFITS.peasant, hair: ["hair_buzzed"] });
    const leader = w.npc("leader", { outfit: OUTFITS.rebelLeader, hair: ["hair_beard"] });
    const p1 = w.npc("p1", { outfit: OUTFITS.peasant, hair: ["hair_long"] });
    const p2 = w.npc("p2", { outfit: OUTFITS.rebel, hair: ["hair_buzzed", "hair_beard"] });
    const officer = w.npc("captain", { outfit: OUTFITS.soldier, hair: ["hair_buzzed"] });
    const scribe = w.npc("scribe", { outfit: OUTFITS.soldier, hair: ["hair_simpleparted"] });
    const archer = w.npc("archer", { outfit: OUTFITS.soldier });
    const line: [Character, number][] = [[leader, LINE_X.leader], [brun, LINE_X.brun], [p1, LINE_X.p1], [p2, LINE_X.p2], [rowan, LINE_X.rowan]];
    for (const [c, x] of line) stand(w, c, x, LINE_Z, OFFICER);
    leader.headDown = 0.35;
    stand(w, officer, OFFICER.x, OFFICER.z, { x: 63, z: LINE_Z }, "Idle_FoldArms_Loop");
    stand(w, scribe, SCRIBE.x, SCRIBE.z, { x: 63, z: LINE_Z });
    stand(w, archer, ARCHER.x, ARCHER.z, { x: 63, z: -520 });
    for (const n of ["driver", "lead_driver", "escort0", "escort1"]) {
      const c = w.npcs.get(n);
      if (c) stand(w, c, 56 + Math.random() * 10, -526 - Math.random() * 3, { x: 63, z: LINE_Z }, "Idle_Loop");
    }
    // the player stands at the end of the line facing the officer (west); body is a placeholder
    // until the creator runs (or the saved appearance)
    const start = new Vector3(LINE_X.player, w.heightAt(LINE_X.player, LINE_Z) + 0.05, LINE_Z);
    this.player = await stage.ensurePlayer(start, Math.PI / 2);
    this.player.canMove = this.step >= 2;
    w.rig.pitch = -0.05;
  }

  async run() {
    const { director: d, stage, game } = this.ctx;
    const w = this.w;
    const n = (k: string) => w.npcs.get(k)!;
    const scribeLook = () => n("scribe").root.position.add(new Vector3(0, 1.6, 0));
    const playerEye = () => this.player.eye(new Vector3());
    audio.musicTracks = {};
    void audio.startBed("wind", "audio/wind", 0.35, 4);
    void audio.startBed("forest", "audio/amb_forest", 0.25, 4);
    await hud.fade(false, 1.5);

    if (this.step < 1) {
      await d.say("帝国队长", "所有人下车！快点！", { npc: n("captain"), look: playerEye, gap: 0.6 });
      await d.say("布伦", "看来路走到头了。", { npc: n("brun"), look: playerEye, talk: "Idle_Talking_Loop", idle: "Idle_Loop" });
      await d.say("帝国队长", "名单上的人，听到名字就上前一步。", { npc: n("captain"), look: () => new Vector3(63, 39.5, LINE_Z) });
      await d.say("书记官", "托尔瓦德·霜颌，寒脊领主。", { npc: n("scribe"), look: () => n("leader").root.position.add(new Vector3(0, 1.6, 0)) });
      await d.say("布伦", "能和您一起走到最后，是我的荣幸，领主大人。", { npc: n("brun"), look: () => n("leader").root.position.add(new Vector3(0, 1.6, 0)), gap: 0.4 });
      void walkPath(w, n("leader"), [new Vector3(55, 0, -548), new Vector3(57, 0, -575), new Vector3(WAIT(0).x, 0, WAIT(0).z)], { ground: true, speed: 1.3 });
      await d.sleep(1.5);
      await d.say("书记官", "布伦·灰鬃，溪谷人。", { npc: n("scribe"), look: () => n("brun").root.position.add(new Vector3(0, 1.6, 0)) });
      await d.say("布伦", "（低声）别怕，朋友。霜誓军的人，死也要站着死。", { npc: n("brun"), look: playerEye, talk: "Idle_Talking_Loop", idle: "Idle_Loop" });
      void walkPath(w, n("brun"), [new Vector3(56, 0, -549), new Vector3(58, 0, -576), new Vector3(WAIT(1).x, 0, WAIT(1).z)], { ground: true, speed: 1.3 });
      await d.sleep(1.2);
      await d.say("书记官", "罗文，山南来的偷马贼。", { npc: n("scribe"), look: () => n("rowan").root.position.add(new Vector3(0, 1.6, 0)) });
      // the escape attempt
      const rowan = n("rowan");
      await d.say("罗文", "不！我不是霜誓军！你们搞错了！我不能死在这儿！", { npc: rowan, look: scribeLook, duration: 2.6 });
      const run = walkPath(w, rowan, [new Vector3(68, 0, -532), new Vector3(63, 0, -514), new Vector3(61, 0, -503)], { ground: true, speed: 5.2, clip: "Sprint_Loop" });
      void run;
      await d.say("帝国队长", "站住！", { npc: n("captain"), look: () => rowan.root.position.add(new Vector3(0, 1.5, 0)), duration: 1.0 });
      const archer = n("archer");
      faceTo(archer, rowan.root.position);
      archer.play("Bow_Notch", { loop: false, blend: 0.15, offset: 0 });
      await d.say("帝国队长", "弓箭手！", { npc: n("captain"), duration: 1.2 });
      archer.play("Bow_Aim_Neutral", { blend: 0.2 });
      await d.sleep(0.8);
      faceTo(archer, rowan.root.position);
      archer.play("Bow_Shoot", { loop: false, blend: 0.05, offset: 0 });
      void audio.playOneShot("audio/sfx_bow", 0.8);
      void audio.playOneShot("audio/sfx_arrow", 0.6);
      const from = archer.root.position.add(new Vector3(0, 1.45, 0));
      const target = () => (rowan.bone("spine_03") ?? rowan.root).getAbsolutePosition();
      const { mesh } = await shootArrow(w, from, target);
      void audio.playOneShot("audio/sfx_arrow_hit", 0.9);
      // the arrow sticks in his back; he falls (ragdoll)
      const spine = rowan.bone("spine_03");
      if (spine) mesh.setParent(spine);
      const dir = target().subtract(from).normalize();
      if (w.physics) this.ragdolls.push(new Ragdoll(w.physics, rowan, dir.scale(4).add(new Vector3(0, 0.5, 0)), "spine_02"));
      archer.play("Idle_Loop", { blend: 0.4 });
      await d.sleep(1.4);
      await d.say("帝国队长", "还有谁想跑？", { npc: n("captain"), look: playerEye, gap: 0.8 });
      // the other two go without a word
      void walkPath(w, n("p1"), [new Vector3(60, 0, -550), new Vector3(59, 0, -578), new Vector3(WAIT(2).x, 0, WAIT(2).z)], { ground: true, speed: 1.3 });
      await d.sleep(0.8);
      void walkPath(w, n("p2"), [new Vector3(62, 0, -551), new Vector3(61, 0, -579), new Vector3(WAIT(3).x, 0, WAIT(3).z)], { ground: true, speed: 1.3 });
      await d.sleep(0.6);
      // "who are you?"
      await d.say("书记官", "等等。你。上前来。", { npc: n("scribe"), look: playerEye });
      await d.say("书记官", "……你是谁？", { npc: n("scribe"), look: playerEye, gap: 0.3 });
      this.step = 1;
    }

    if (this.step < 2) {
      const a = await this.createCharacter(stage.appearance ?? defaultAppearance());
      stage.appearance = a;
      await game.save("auto");
      await d.say("书记官", `${raceName(a)}，${a.name}……`, { npc: n("scribe"), look: playerEye });
      await d.say("书记官", "队长，名单上没有这个人。怎么处理？", { npc: n("scribe"), look: () => n("captain").root.position.add(new Vector3(0, 1.6, 0)) });
      await d.say("帝国队长", "别管什么名单。押去断头台。", { npc: n("captain"), look: scribeLook });
      await d.say("书记官", `遵命，队长。……抱歉了，${a.name}。我们会把你的遗物送回${homeland(a)}。`, { npc: n("scribe"), look: playerEye });
      await d.say("书记官", "跟着队长走，囚犯。", { npc: n("scribe"), look: playerEye });
      this.step = 2;
    }

    // walk to the square behind the captain
    this.player.canMove = true;
    hud.toast("跟随帝国队长前往广场", 5000);
    hud.prompt(input.usingPad ? "左摇杆移动" : "WASD 移动");
    void walkPath(w, n("captain"), [new Vector3(56, 0, -552), new Vector3(58, 0, -580), new Vector3(LAYOUT.square.x + 6, 0, LAYOUT.square.z + 2)], { ground: true, speed: 1.6 });
    const goal = new Vector3(WAIT(4).x, 0, WAIT(4).z);
    await d.until(() => {
      const p = this.player.position;
      if (Math.hypot(p.x - goal.x, p.z - goal.z) < 6) return true;
      return false;
    });
    hud.prompt(null);
  }

  /** Close-up of the player's body while the creator panel is open. */
  private async createCharacter(start: Appearance): Promise<Appearance> {
    const w = this.w;
    const game = this.ctx.game;
    game.modal = true;
    const body = () => w.npcs.get("player")!;
    this.player.enabled = false;
    this.player.firstPerson = false;
    for (const m of body().meshes) m.isVisible = true;
    let spin = 0;
    const shoot = () => {
      const b = body();
      const p = b.root.position;
      const h = b.root.scaling.y;
      // camera west of the player (who faces west), slightly to the side; frame the upper body
      w.rig.cut(new Vector3(p.x - 2.4, p.y + 1.45 * h, p.z + 0.5), new Vector3(p.x, p.y + 1.25 * h, p.z));
    };
    shoot();
    const baseYaw = Math.PI / 2;
    const applyYaw = () => {
      const b = body();
      const y = baseYaw + spin + Math.PI;
      b.root.rotationQuaternion!.copyFromFloats(0, Math.sin(y / 2), 0, Math.cos(y / 2));
    };
    const off = w.onUpdate(() => applyYaw());
    const a = await openCreator(start, {
      onChange: async (next, sexChanged) => {
        if (sexChanged) {
          const { body: nb, heightScale } = await createPlayerBody(w, next);
          this.player.body = nb;
          this.player.setEyeHeight(1.62 * heightScale);
          nb.play("Idle_Loop");
          for (const m of nb.meshes) m.isVisible = true;
        } else {
          const { applyAppearance } = await import("../../world/appearance");
          const { heightScale } = applyAppearance(body(), next);
          this.player.setEyeHeight(1.62 * heightScale);
        }
        shoot();
      },
      onRotate: (d) => (spin += d),
    });
    off();
    spin = 0;
    applyYaw();
    game.modal = false;
    this.player.enabled = true;
    this.player.firstPerson = true;
    w.rig.follow(this.player);
    w.rig.yaw = Math.PI / 2;
    w.rig.pitch = -0.05;
    return a;
  }

  save() {
    return { step: this.step };
  }

  skip() {
    const { stage } = this.ctx;
    stage.appearance ??= { ...defaultAppearance(), name: "无名氏" };
    this.ctx.game.modal = false;
    document.getElementById("creator")?.remove();
  }

  dispose() {
    for (const r of this.ragdolls) r.dispose();
    hud.prompt(null);
  }
}
