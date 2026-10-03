import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { LAYOUT } from "../../world/town";
import type { PlayerController } from "../player";
import type { Chapter, ChapterContext } from "./types";

/** Debug-only free roam inside the town (?debug&roam): tests physics, movement and cameras. */
export class RoamChapter implements Chapter {
  id = "muster" as const;
  label = "自由行走（调试）";
  player!: PlayerController;
  constructor(private ctx: ChapterContext) {}

  async prepare() {
    const { world, stage } = this.ctx;
    const u = LAYOUT.unload;
    this.player = await stage.ensurePlayer(new Vector3(u.x, world.heightAt(u.x, u.z) + 0.2, u.z), 0);
  }

  run() {
    return new Promise<void>(() => {});
  }

  save() {
    return {};
  }

  dispose() {}
}
