import type { SegmentId } from "../../core/assets/manifest";
import type { Game } from "../../game/Game";
import type { Director } from "../Director";
import type { World } from "../World";
import type { PrologueStage } from "../PrologueStage";

export interface ChapterContext {
  game: Game;
  world: World;
  director: Director;
  stage: PrologueStage;
}

/** A story segment that plays inside the shared prologue world. */
export interface Chapter {
  id: SegmentId;
  /** shown in the load menu */
  label: string;
  /** Build chapter content (may run while the menu is still up). Must not advance time. */
  prepare(resume: Record<string, unknown> | null): Promise<void>;
  /** Play the chapter; resolves when the next chapter should begin. */
  run(resume: Record<string, unknown> | null): Promise<void>;
  update?(dt: number): void;
  save(): Record<string, unknown>;
  /** Remove content only this chapter needs. */
  dispose(): void;
}
