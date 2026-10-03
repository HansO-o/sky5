import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { audio } from "../../core/audio";
import { input } from "../../core/input";
import { hud } from "../../ui/hud";
import { openCreator } from "../../ui/creator";
import { OUTFITS, type Character } from "../../world/characters";
import { applyAppearance, defaultAppearance, type Appearance } from "../../world/appearance";
import { LAYOUT } from "../../world/town";
import { Ragdoll } from "../../physics/ragdoll";
import { faceTo, stand, walkPath } from "../actors";
import { Cancelled } from "../Director";
import { shootArrow } from "../fx/arrow";
import type { PlayerController } from "../player";
import { createPlayerBody, homeland, raceName } from "../playerBody";
import type { World } from "../World";
import { castExecution, GUARDS, WAIT } from "./execution";
import type { Chapter, ChapterContext } from "./types";

/** Where the prisoners line up after leaving the wagons, and who stands where. */
const LINE_Z = -540;
/** the prisoners stand side by side facing south; the captain and the scribe face them */
const LINE_X = { leader: 52, brun: 54.5, p1: 57, p2: 59.5, rowan: 62, player: 64.5 };
const OFFICER = { x: 57, z: -547.5 };
const SCRIBE = { x: 59.6, z: -547.2 };
const ARCHER = { x: 51, z: -531 };
/** prisoners leave the line west of the captain, then go south to the square */
const exitPath = (i: number) => [new Vector3(49.5, 0, -544 - i * 0.6), new Vector3(52 + i * 0.5, 0, -575), new Vector3(WAIT(i).x, 0, WAIT(i).z)];
const PLAYER_YAW = Math.atan2(LINE_X.player - OFFICER.x, LINE_Z - OFFICER.z) * 0.6;
const PLATFORM = { x: LAYOUT.platform.x, z: LAYOUT.platform.z };
/** the escorts wait north of the line: they go round its ends to their posts, not through the player's spot */
const ROUND_THE_LINE: Record<string, [number, number][]> = { escort0: [[69, -532], [69, -560]], escort1: [[50, -532], [50, -560]] };

/** After the roll call: the prisoners wait before the platform, facing it. */
function waitBeforePlatform(w: World) {
  (["leader", "brun", "p1", "p2"] as const).forEach((k, i) => {
    const c = w.npcs.get(k);
    if (c) stand(w, c, WAIT(i).x, WAIT(i).z, PLATFORM);
  });
}

/**
 * Segment 3: unloading, roll call, the thief's escape attempt, the scribe asks the player's name
 * (character creation) and adds it to the list, then the player follows the captain to the square.
 */
export class MusterChapter implements Chapter {
  id = "muster" as const;
  label = "点名";
  player!: PlayerController;
  private ragdolls: Ragdoll[] = [];
  private step = 0;
  /** the player has made their character (a resume does not open the creator again) */
  private named = false;
  /** takes the open character creator down (skip, dispose) */
  private closeCreator: (() => void) | null = null;
  /** run() has started: only then does the chapter own the global prompt */
  private started = false;

  constructor(private ctx: ChapterContext) {}

  private get w() {
    return this.ctx.world;
  }

  async prepare(resume: Record<string, unknown> | null) {
    const { stage } = this.ctx;
    const w = this.w;
    this.step = (resume?.step as number) ?? 0;
    // saves from before `named` was kept: their step 1 was only ever saved after the creator
    // (stage.appearance is already restored from the save)
    const legacy = this.step >= 1 && resume?.named === undefined && stage.appearance != null;
    this.named = this.step >= 2 || resume?.named === true || legacy;
    // the execution's own cast waits on the square from the start, so nobody pops up there in view
    const cast = castExecution(w, true).catch((e) => console.warn("execution cast", e));
    // cast (some already exist from the ride)
    const brun = w.npc("brun", { outfit: OUTFITS.rebel, hair: ["hair_simpleparted", "hair_beard"] });
    const leader = w.npc("leader", { outfit: OUTFITS.rebelLeader, hair: ["hair_beard"] });
    const p1 = w.npc("p1", { outfit: OUTFITS.peasant, hair: ["hair_long"] });
    const p2 = w.npc("p2", { outfit: OUTFITS.rebel, hair: ["hair_buzzed", "hair_beard"] });
    const officer = w.npc("captain", { outfit: OUTFITS.soldier, hair: ["hair_buzzed"] });
    const scribe = w.npc("scribe", { outfit: OUTFITS.soldier, hair: ["hair_simpleparted"] });
    const archer = w.npc("archer", { outfit: OUTFITS.soldier });
    if (this.step < 1) {
      const rowan = w.npc("rowan", { outfit: OUTFITS.peasant, hair: ["hair_buzzed"] });
      const line: [Character, number][] = [[leader, LINE_X.leader], [brun, LINE_X.brun], [p1, LINE_X.p1], [p2, LINE_X.p2], [rowan, LINE_X.rowan]];
      for (const [c, x] of line) stand(w, c, x, LINE_Z, { x, z: LINE_Z - 10 });
    } else {
      // resumed after the roll call: the thief was shot, the others have walked to the square
      w.removeNpc("rowan");
      waitBeforePlatform(w);
    }
    leader.headDown = 0.35;
    stand(w, officer, OFFICER.x, OFFICER.z, { x: 58, z: LINE_Z }, "Idle_FoldArms_Loop");
    stand(w, scribe, SCRIBE.x, SCRIBE.z, { x: 58, z: LINE_Z });
    stand(w, archer, ARCHER.x, ARCHER.z, { x: 58, z: -520 });
    for (const n of ["driver", "lead_driver", "escort0", "escort1"]) {
      const c = w.npcs.get(n);
      if (c) stand(w, c, 56 + Math.random() * 10, -526 - Math.random() * 3, { x: 58, z: LINE_Z }, "Idle_Loop");
    }
    // the player stands at the end of the line facing south toward the captain; the body is a
    // placeholder until the creator runs (or the saved appearance)
    const start = new Vector3(LINE_X.player, w.heightAt(LINE_X.player, LINE_Z) + 0.05, LINE_Z);
    this.player = await stage.ensurePlayer(start, PLAYER_YAW);
    await cast;
    this.player.firstPerson = true;
    this.player.canMove = this.step >= 2;
    w.rig.pitch = -0.05;
  }

  async run() {
    this.started = true;
    const { director: d, stage, game } = this.ctx;
    const w = this.w;
    const n = (k: string) => w.npcs.get(k)!;
    const scribeLook = () => n("scribe").root.position.add(new Vector3(0, 1.6, 0));
    const playerEye = () => this.player.eye(new Vector3());
    audio.musicTracks = {};
    void audio.startBed("wind", "audio/wind", 0.35, 4);
    void audio.startBed("forest", "audio/amb_forest", 0.25, 4);
    await d.wait(hud.fade(false, 1.5));

    if (this.step < 1) {
      await d.say("帝国队长", "所有人下车！快点！", { npc: n("captain"), look: playerEye, gap: 0.6 });
      await d.say("布伦", "……车停了。剩下的路，得自己走。", { npc: n("brun"), look: playerEye, talk: "Idle_Talking_Loop", idle: "Idle_Loop" });
      await d.say("帝国队长", "念到谁，谁就到前面来。别让我念第二遍。", { npc: n("captain"), look: () => new Vector3(63, 39.5, LINE_Z) });
      await d.say("书记官", "托尔瓦德·霜颌，寒脊领主。", { npc: n("scribe"), look: () => n("leader").root.position.add(new Vector3(0, 1.6, 0)) });
      await d.say("布伦", "领主大人。不管今天怎么收场，我都不后悔跟了您。", { npc: n("brun"), look: () => n("leader").root.position.add(new Vector3(0, 1.6, 0)), gap: 0.4 });
      void walkPath(w, n("leader"), exitPath(0), { ground: true, speed: 1.3 });
      await d.sleep(1.5);
      await d.say("书记官", "布伦·铁桦，溪谷人。", { npc: n("scribe"), look: () => n("brun").root.position.add(new Vector3(0, 1.6, 0)) });
      await d.say("布伦", "（低声）别怕，朋友。霜誓军的人，死也要站着死。", { npc: n("brun"), look: playerEye, talk: "Idle_Talking_Loop", idle: "Idle_Loop" });
      void walkPath(w, n("brun"), exitPath(1), { ground: true, speed: 1.3 });
      await d.sleep(1.2);
      await d.say("书记官", "罗文，山南来的偷马贼。", { npc: n("scribe"), look: () => n("rowan").root.position.add(new Vector3(0, 1.6, 0)) });
      // the escape attempt
      const rowan = n("rowan");
      await d.say("罗文", "我只是偷了一匹马！一匹马！你们不能为一匹马要我的命！", { npc: rowan, look: scribeLook, duration: 2.9 });
      w.rig.lookToward(() => rowan.root.position.add(new Vector3(0, 1.4, 0)), 3.5);
      const run = walkPath(w, rowan, [new Vector3(62.5, 0, -534), new Vector3(61, 0, -514), new Vector3(60, 0, -503)], { ground: true, speed: 5.2, clip: "Sprint_Loop" });
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
      const shot = shootArrow(w, from, target);
      // skipped while it flies: the arrow is not left where it lands
      void shot.then(({ mesh }) => d.cancelled && mesh.dispose());
      const { mesh } = await d.wait(shot);
      void audio.playOneShot("audio/sfx_arrow_hit", 0.9);
      // the arrow sticks in his back; he falls (ragdoll)
      const spine = rowan.bone("spine_03");
      if (spine) mesh.setParent(spine);
      const dir = target().subtract(from).normalize();
      if (w.physics) this.ragdolls.push(new Ragdoll(w.physics, rowan, dir.scale(4).add(new Vector3(0, 0.5, 0)), "spine_02"));
      archer.play("Idle_Loop", { blend: 0.4 });
      await d.sleep(1.4);
      w.rig.lookToward(() => n("captain").root.position.add(new Vector3(0, 1.6, 0)), 1.5);
      await d.say("帝国队长", "下一个想试试弓手准头的，站出来。", { npc: n("captain"), look: playerEye, gap: 0.8 });
      // the other two go without a word
      void walkPath(w, n("p1"), exitPath(2), { ground: true, speed: 1.3 });
      await d.sleep(0.8);
      void walkPath(w, n("p2"), exitPath(3), { ground: true, speed: 1.3 });
      await d.sleep(0.6);
      // the one the list does not know
      w.rig.lookToward(scribeLook, 1.2);
      await d.say("书记官", "你。……这张脸，我没登记过。", { npc: n("scribe"), look: playerEye });
      await d.say("书记官", "报上名字。", { npc: n("scribe"), look: playerEye, gap: 0.3 });
      this.step = 1;
    }

    if (this.step < 2) {
      if (!this.named) {
        stage.appearance = await this.createCharacter(stage.appearance ?? defaultAppearance());
        this.named = true;
        await d.wait(game.save("auto"));
      }
      const a = stage.appearance ?? defaultAppearance();
      await d.say("书记官", `${raceName(a)}，${a.name}……`, { npc: n("scribe"), look: playerEye });
      await d.say("书记官", "队长，这个人……名单上找不到。", { npc: n("scribe"), look: () => n("captain").root.position.add(new Vector3(0, 1.6, 0)) });
      await d.say("帝国队长", "那就添上。到了刑台底下，谁还查名单。", { npc: n("captain"), look: scribeLook });
      // he writes the player into the list (the keep and the exit come back to it)
      n("scribe").play("Interact", { loop: false, blend: 0.3 });
      await d.say("书记官", `……${a.name}，来自${homeland(a)}。添上了。`, { npc: n("scribe"), look: null });
      n("scribe").play("Idle_Loop", { blend: 0.4 });
      await d.say("书记官", "……对不住。我只管抄写，不管对错。", { npc: n("scribe"), look: playerEye });
      await d.say("书记官", "去吧。队长在等。", { npc: n("scribe"), look: playerEye });
      this.step = 2;
    }

    // walk to the square behind the captain
    this.player.canMove = true;
    hud.toast("跟随帝国队长前往广场", 5000);
    hud.prompt(input.usingPad ? "左摇杆移动" : "WASD 移动");
    void walkPath(w, n("captain"), [new Vector3(56, 0, -552), new Vector3(58, 0, -580), new Vector3(LAYOUT.square.x + 6, 0, LAYOUT.square.z + 2)], { ground: true, speed: 1.6 });
    // the soldiers come along to stand guard around the square
    for (const [k, x, z] of GUARDS) {
      const c = w.npcs.get(k);
      if (c)
        void walkPath(w, c, [...(ROUND_THE_LINE[k] ?? []).map(([wx, wz]) => new Vector3(wx, 0, wz)), new Vector3(x, 0, z)], { ground: true, speed: 1.8 }).then((arrived) => {
          if (arrived) faceTo(c, PLATFORM);
        });
    }
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
    const d = this.ctx.director;
    // not under a pause menu that opened during the fade-in: director time only runs unpaused
    await d.sleep(0);
    const w = this.w;
    const game = this.ctx.game;
    const body = () => w.npcs.get("player")!;
    this.player.enabled = false;
    this.player.firstPerson = false;
    for (const m of body().meshes) m.isVisible = true;
    let spin = 0;
    const shoot = () => {
      const b = body();
      const p = b.root.position;
      const h = b.root.scaling.y;
      // camera in front of the player, slightly to the side; frame the upper body
      const fx = -Math.sin(baseYaw), fz = -Math.cos(baseYaw);
      w.rig.cut(new Vector3(p.x + fx * 2.4 - fz * 0.5, p.y + 1.45 * h, p.z + fz * 2.4 + fx * 0.5), new Vector3(p.x, p.y + 1.25 * h, p.z));
    };
    const baseYaw = PLAYER_YAW;
    shoot();
    const applyYaw = () => {
      const b = body();
      const y = baseYaw + spin + Math.PI;
      b.root.rotationQuaternion!.copyFromFloats(0, Math.sin(y / 2), 0, Math.cos(y / 2));
    };
    const off = w.onUpdate(() => applyYaw());
    // the panel's changes reach the body one at a time and in order, the newest of those waiting
    // only: a first 女 that is still loading is never overtaken by a later change
    let shown = start.sex;
    let latest = start;
    let applied = Promise.resolve();
    const apply = async (next: Appearance) => {
      if (d.cancelled || next !== latest) return;
      if (next.sex === "f") await d.wait(w.ensureFemale());
      if (next !== latest) return;
      if (next.sex !== shown) {
        const { body: nb, heightScale } = await createPlayerBody(w, next);
        shown = next.sex;
        this.player.body = nb;
        this.player.setEyeHeight(1.62 * heightScale);
        nb.play("Idle_Loop");
        for (const m of nb.meshes) m.isVisible = true;
      } else {
        const { heightScale } = applyAppearance(body(), next);
        this.player.setEyeHeight(1.62 * heightScale);
      }
      shoot();
    };
    const change = (next: Appearance) => {
      latest = next;
      applied = applied
        .then(() => apply(next))
        .catch((e) => {
          if (!(e instanceof Cancelled)) console.warn("creator: body not updated", e);
        });
    };
    const creator = openCreator(start, { onChange: change, onRotate: (r) => (spin += r) });
    const end = game.openModal(() => {
      creator.close();
      off();
    });
    const close = (this.closeCreator = () => {
      creator.close();
      off();
      end();
    });
    let a: Appearance;
    try {
      a = await d.wait(creator);
      // the body ends up as confirmed, whatever was still on its way
      change(a);
      await d.wait(applied);
    } finally {
      close();
      this.closeCreator = null;
    }
    spin = 0;
    applyYaw();
    this.player.enabled = true;
    this.player.firstPerson = true;
    w.rig.follow(this.player);
    w.rig.yaw = PLAYER_YAW;
    w.rig.pitch = -0.05;
    return a;
  }

  save() {
    return { step: this.step, named: this.named };
  }

  skip() {
    const { stage } = this.ctx;
    const w = this.w;
    stage.appearance ??= { ...defaultAppearance(), name: "无名氏" };
    this.closeCreator?.();
    this.closeCreator = null;
    this.step = 2;
    this.named = true;
    // end state: prisoners wait before the platform, the captain beside them, the soldiers at their
    // posts around the square, the thief is gone
    waitBeforePlatform(w);
    if (!this.ragdolls.length) w.removeNpc("rowan");
    const cap = w.npcs.get("captain");
    if (cap) stand(w, cap, LAYOUT.square.x + 6, LAYOUT.square.z + 2, PLATFORM);
    for (const [k, x, z] of GUARDS) {
      const c = w.npcs.get(k);
      if (c) stand(w, c, x, z, PLATFORM);
    }
    const p = new Vector3(WAIT(4).x, w.heightAt(WAIT(4).x, WAIT(4).z) + 0.05, WAIT(4).z);
    this.player.teleport(p, 0);
    this.player.canMove = true;
    this.player.enabled = true;
    this.player.firstPerson = true;
    w.rig.follow(this.player);
  }

  dispose() {
    this.closeCreator?.();
    this.closeCreator = null;
    for (const r of this.ragdolls) r.dispose();
    if (this.started) hud.prompt(null);
  }
}
