import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { OUTFITS } from "../../world/characters";
import { LAYOUT } from "../../world/town";
import { PlayerController } from "../player";
import type { Chapter, ChapterContext } from "./types";

/** Debug-only free roam inside the town (?debug&roam): tests physics, movement and cameras. */
export class RoamChapter implements Chapter {
  id = "muster" as const;
  label = "自由行走（调试）";
  player!: PlayerController;
  constructor(private ctx: ChapterContext) {}

  async prepare() {
    const { world, stage } = this.ctx;
    const ph = await stage.ensurePhysics();
    const body = world.npc("player", { outfit: OUTFITS.peasant, hair: ["hair_buzzed"] });
    const u = LAYOUT.unload;
    this.player = new PlayerController(ph, world.rig, body, new Vector3(u.x, world.heightAt(u.x, u.z) + 0.2, u.z), 0);
    world.rig.follow(this.player);
  }

  run() {
    return new Promise<void>(() => {});
  }

  update(dt: number) {
    this.player.update(dt);
  }

  save() {
    return {};
  }

  dispose() {
    this.player?.dispose();
  }
}
