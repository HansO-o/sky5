import type { SegmentId } from "../../core/assets/manifest";
import type { Game } from "../../game/Game";
import type { ScriptScope } from "../Director";
import type { World } from "../World";
import type { PrologueStage } from "../PrologueStage";

export interface ChapterContext {
  game: Game;
  world: World;
  /** this chapter's own script scope: cancelled when the chapter ends or is skipped */
  director: ScriptScope;
  stage: PrologueStage;
}

/** A story segment that plays inside the shared prologue world. */
export interface Chapter {
  id: SegmentId;
  /** shown in the load menu */
  label: string;
  /** continues straight from the previous chapter's last shot (no fade to black in between) */
  seamless?: boolean;
  /**
   * Build chapter content (may run while the menu is still up). Must not advance time.
   * `continued`: the previous chapter just ended in this session (actors are already in place).
   */
  prepare(resume: Record<string, unknown> | null, continued?: boolean): Promise<void>;
  /**
   * Play the chapter; resolves when the next chapter should begin. Await other promises (flights,
   * glides, fades) through `ctx.director.wait()`: a skip then stops the script there.
   */
  run(resume: Record<string, unknown> | null): Promise<void>;
  update?(dt: number): void;
  save(): Record<string, unknown>;
  /** Jump to the chapter's end state (the player chose to skip it). */
  skip?(): void;
  /** Remove content only this chapter needs. */
  dispose(): void;
}
