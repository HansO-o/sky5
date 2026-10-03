import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { loadGLB } from "../../game/loaders";
import { audio } from "../../core/audio";
import { input } from "../../core/input";
import { hud } from "../../ui/hud";
import { OUTFITS, type Character } from "../../world/characters";
import { HORSE_AHEAD, Wagon } from "../wagon";
import { SCRIPT, SPEAKER_NAMES, lineDuration, type Line, type Speaker } from "./cartScript";
import type { Chapter, ChapterContext } from "./types";

/** The ride starts part-way along the road (the first stretch is scenery behind the camera). */
export const START_S = 300;
const CRUISE = 2.9; // m/s
const LEAD_GAP = 22; // metres between the wagons
/** the lead wagon parks this far short of the road's end, its horse still on the road (Route clamps beyond it) */
const LEAD_PARK = HORSE_AHEAD + 2.5;
/** the ride ends (`remaining` reaches 0) this far short of the road's end: the player's wagon parks with
 * its horse just behind the parked lead */
const RIDE_END = LEAD_PARK + 8;

/** Segment 2: the prisoner wagon ride from the forest to the gates of 雾门镇. */
export class CartChapter implements Chapter {
  id = "cart" as const;
  label = "囚车";
  wagon!: Wagon;
  lead!: Wagon;
  private walkers: Character[] = [];
  private s = START_S;
  private speed = 0;
  private time = 0;
  private lineIdx = 0;
  private lineEnd = 0;
  private nextAllowed = 0;
  private speaking: { who: Speaker; until: number } | null = null;
  private waitingForTown = false;
  private done: (() => void) | null = null;
  private stopAudio: (() => void)[] = [];
  private disposed = false;
  private skipHold = 0;
  /** run() has started: only then does the ride own the global prompt */
  private started = false;

  constructor(private ctx: ChapterContext) {}

  get world() {
    return this.ctx.world;
  }

  async prepare(resume: Record<string, unknown> | null) {
    const w = this.world;
    const [wagonC, horseC] = await Promise.all([loadGLB("cart/wagon", w.scene), loadGLB("chars/horse", w.scene)]);
    // a ride prepared earlier (behind the menu) leaves its convoy: replaced once the cast has moved over
    const old = this.ctx.stage.wagons;
    this.wagon = new Wagon(w.scene, wagonC, horseC, "playerWagon");
    this.lead = new Wagon(w.scene, wagonC, horseC, "leadWagon");
    this.world.addShadowCasters([...this.wagon.meshes, ...this.lead.meshes]);
    this.ctx.stage.wagons = [this.wagon, this.lead];
    const seat = this.wagon.seats.get("seat_0");
    if (!seat) throw new Error("wagon model has no seat_0 anchor");
    w.rig.seat(seat, new Vector3(0, 0.8, -0.08));
    w.rig.pitch = -0.05;

    const sit = (wagon: Wagon, seatName: string, ch: Character, clip = "Sitting_Idle_Loop") => {
      ch.root.parent = wagon.seats.get(seatName)!;
      // origin at floor level just in front of the bench; glTF characters face +Z
      ch.root.position.set(0, -0.48, -0.18);
      ch.root.rotationQuaternion!.copyFromFloats(0, 1, 0, 0);
      ch.play(clip);
    };
    sit(this.wagon, "seat_1", w.npc("brun", { outfit: OUTFITS.rebel, hair: ["hair_simpleparted", "hair_beard"] }));
    sit(this.wagon, "seat_3", w.npc("rowan", { outfit: OUTFITS.peasant, hair: ["hair_buzzed"] }));
    const leader = w.npc("leader", { outfit: OUTFITS.rebelLeader, hair: ["hair_beard"] });
    sit(this.wagon, "seat_2", leader);
    leader.headDown = 0.45;
    const driver = w.npc("driver", { outfit: OUTFITS.soldier });
    sit(this.wagon, "driver_seat", driver, "Driving_Loop");
    driver.root.position.set(0, -0.62, 0.05);
    const ld = w.npc("lead_driver", { outfit: OUTFITS.soldier });
    sit(this.lead, "driver_seat", ld, "Driving_Loop");
    ld.root.position.set(0, -0.62, 0.05);
    sit(this.lead, "seat_1", w.npc("p1", { outfit: OUTFITS.peasant, hair: ["hair_long"] }));
    sit(this.lead, "seat_0", w.npc("p2", { outfit: OUTFITS.rebel, hair: ["hair_buzzed", "hair_beard"] }));
    for (let i = 0; i < 2; i++) {
      const e = w.npc(`escort${i}`, { outfit: OUTFITS.soldier });
      e.play("Walk_Loop", { speed: 1.6 });
      this.walkers.push(e);
    }
    this.streamProps();
    this.applyResume(resume);
    // the camera and every passenger now sit in the new wagons (disposing a wagon disposes its seats' children)
    for (const o of old) o.dispose();
  }

  private applyResume(resume: Record<string, unknown> | null) {
    const r = (resume ?? {}) as { s?: number; line?: number; time?: number };
    this.s = Math.min(r.s ?? START_S, this.end - 1.2);
    this.lineIdx = r.line ?? 0;
    this.time = r.time ?? 0;
    this.nextAllowed = this.time;
    this.placeConvoy(0);
    this.world.updateSets(true);
  }

  /** Lantern and shield on the lead wagon stream in; attached only while it is out of view. */
  private streamProps() {
    const w = this.world;
    void Promise.all([loadGLB("ph/wooden_lantern_01", w.scene), loadGLB("ph/kite_shield", w.scene)])
      .then(([lanternC, shieldC]) => {
        const attach = () => {
          if (this.disposed) return;
          const body = this.lead.seats.get("seat_0")?.parent as TransformNode | undefined;
          const visible = this.lead.meshes.some((m) => m.isEnabled() && w.rig.camera.isInFrustum(m));
          if (!body || visible) {
            setTimeout(attach, 500);
            return;
          }
          const lantern = lanternC.instantiateModelsToScene((n) => n, false);
          for (const r of lantern.rootNodes as TransformNode[]) {
            r.parent = body;
            r.position.set(0.62, 1.68, -1.45);
          }
          const shield = shieldC.instantiateModelsToScene((n) => n, false);
          for (const r of shield.rootNodes as TransformNode[]) {
            r.parent = body;
            r.position.set(0.82, 1.15, 0.6);
            r.rotation.set(0, Math.PI / 2, 0.15);
          }
          for (const r of [...lantern.rootNodes, ...shield.rootNodes]) w.addShadowCasters(r.getChildMeshes());
        };
        attach();
      })
      .catch((e) => console.warn("props failed", e));
  }

  run() {
    this.started = true;
    const w = this.world;
    audio.musicTracks = { calm: "audio/music_cart" };
    void audio.startBed("forest", "audio/amb_forest", 0.7, 4);
    void w.loopEmitter("audio/sfx_hooves", () => this.wagon.horseRoot.position, 0.55).then((h) => h && this.stopAudio.push(h.stop));
    void w.loopEmitter("audio/sfx_cart", () => this.wagon.root.position, 0.75).then((h) => h && this.stopAudio.push(h.stop));
    void this.ctx.director.sleep(Math.max(0, 40 - this.time)).then(() => audio.playMusic("audio/music_cart", { fade: 8, volume: 0.45 })).catch(() => {});
    return new Promise<void>((resolve) => (this.done = resolve));
  }

  /** route distance where the ride ends (`remaining` counts down to it) */
  private get end() {
    return this.world.route.length - RIDE_END;
  }

  private tmp = new Vector3();
  private placeConvoy(dt: number) {
    const r = this.world.route;
    this.wagon.place(r, this.s, this.speed, dt, this.time);
    // the lead closes up as it nears the end of the road and eases to a stop there
    const park = r.length - LEAD_PARK;
    const over = this.s + LEAD_GAP - (park - 4);
    const k = over > 0 ? Math.exp(-over / 4) : 1;
    const leadS = over > 0 ? park - 4 * k : this.s + LEAD_GAP;
    const leadSpeed = this.speed * k;
    this.lead.place(r, leadS, leadSpeed, dt, this.time);
    this.walkers.forEach((w, i) => {
      const s = leadS + 1 - i * 3;
      const p = r.pos(s, this.tmp);
      const d = r.dir(s);
      const side = i === 0 ? 1.7 : -1.7;
      const x = p.x - d.z * side, z = p.z + d.x * side;
      w.root.position.set(x, this.world.heightAt(x, z), z);
      const yaw = r.yaw(s) + Math.PI;
      w.root.rotationQuaternion!.copyFromFloats(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
      w.play(leadSpeed > 0.3 ? "Walk_Loop" : "Idle_Loop", { speed: Math.max(0.6, leadSpeed / 1.8) });
    });
  }

  update(dt: number) {
    if (!this.done) return;
    this.time += dt;
    const remaining = this.end - this.s;
    const stage = this.ctx.stage;
    if (remaining < 520) void stage.ensureTown();
    let target = CRUISE;
    if (this.time < 3) target = 0;
    if (remaining < 60) target = Math.min(target, 0.6 + remaining * 0.04);
    if (remaining < 2) target = 0;
    if (!stage.townReady && remaining < 260) {
      target = 0; // halt at the checkpoint until the town is ready (natural pause, no loading screen)
      if (!this.waitingForTown) {
        this.waitingForTown = true;
        hud.loading(true, "加载中");
      }
    } else if (this.waitingForTown) {
      this.waitingForTown = false;
      hud.loading(false);
    }
    this.speed += (target - this.speed) * Math.min(1, dt * 0.6);
    this.s = Math.min(this.end - 1.2, this.s + this.speed * dt);
    this.placeConvoy(dt);
    // hold Space (A on a pad) to skip the ride
    this.skipHold = input.down("jump") ? this.skipHold + dt : 0;
    if (this.skipHold > 1.2) {
      this.skipHold = 0;
      void stage.skipChapter();
    }
    hud.prompt(
      this.skipHold > 0.15
        ? `继续按住以跳过乘车… ${Math.round((this.skipHold / 1.2) * 100)}%`
        : !input.locked && !input.usingPad && this.time > 4 && this.time < 60
          ? "点击画面以环顾四周 · 按住空格跳过"
          : null,
    );
    this.updateDialogue(remaining);
    if (remaining < 3 && this.lineIdx >= SCRIPT.length && this.time > this.lineEnd + 2) {
      hud.prompt(null);
      const d = this.done;
      this.done = null;
      d();
    }
  }

  private lookTargetFor(l: Line): Vector3 | null {
    const look = l.look ?? "player";
    if (look === "player") return this.world.rig.position;
    if (look === "ahead") return this.world.route.pos(this.s + 40).addInPlace(new Vector3(0, 1.6, 0));
    const c = this.world.npcs.get(look);
    return c ? c.root.getAbsolutePosition().add(new Vector3(0, 0.9, 0)) : null;
  }

  private updateDialogue(remaining: number) {
    const npcs = this.world.npcs;
    if (this.speaking && this.time >= this.speaking.until) {
      npcs.get(this.speaking.who)?.play("Sitting_Idle_Loop", { blend: 0.4 });
      hud.clearSubtitle();
      this.speaking = null;
    }
    if (!this.speaking) {
      const cam = this.world.rig.position;
      npcs.get("brun")?.lookAt(Math.sin(this.time * 0.13) > 0.2 ? cam : null);
      npcs.get("rowan")?.lookAt(Math.sin(this.time * 0.09 + 2) > 0.5 ? cam : null);
    }
    if (this.lineIdx >= SCRIPT.length || this.speaking || this.time < this.nextAllowed) return;
    const l = SCRIPT[this.lineIdx];
    if (l.t !== undefined && this.time < l.t) return;
    if (l.remaining !== undefined && remaining > l.remaining) return;
    this.lineIdx++;
    const dur = lineDuration(l);
    hud.subtitle(SPEAKER_NAMES[l.who], l.text, true); // no voice-over yet: always show
    this.speaking = { who: l.who, until: this.time + dur };
    this.lineEnd = this.time + dur;
    this.nextAllowed = this.time + dur + (l.gap ?? 0.6);
    const c = npcs.get(l.who);
    if (c) {
      if (l.who === "brun" || l.who === "rowan") c.play("Sitting_Talking_Loop", { blend: 0.35 });
      c.lookAt(this.lookTargetFor(l));
    }
  }

  save() {
    // a line still on screen is saved as not yet spoken: it plays again on load
    return { s: this.s, line: this.speaking ? this.lineIdx - 1 : this.lineIdx, time: this.time };
  }

  skip() {
    // wagons parked inside the gate; the town must exist for the next chapter
    void this.ctx.stage.ensureTown();
    this.s = this.end - 1.2;
    this.speed = 0;
    this.lineIdx = SCRIPT.length;
    // the ride is over: update() must not touch the cast or the HUD again
    this.done = null;
    this.speaking = null;
    this.placeConvoy(0);
    this.world.updateSets(true);
  }

  dispose() {
    this.disposed = true;
    this.done = null;
    this.speaking = null;
    this.stopAudio.forEach((f) => f());
    if (this.waitingForTown) {
      this.waitingForTown = false;
      hud.loading(false);
    }
    if (this.started) hud.prompt(null);
  }
}
