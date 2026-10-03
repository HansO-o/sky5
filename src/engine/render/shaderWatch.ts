import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

/** One shader program the engine had to build (an effect-cache miss). */
export interface ShaderCompile {
  /** the phase the game was in (see {@link ShaderWatch.mark}) */
  phase: string;
  /** the shader's base name ("pbr", "default", "particles", "shadowMap", ...) */
  name: string;
  /** performance.now() */
  at: number;
}

type ShaderPath = { spectorName?: string; vertex?: string; vertexToken?: string; vertexElement?: string };

/** The readable name of an effect's base name argument. */
export function shaderName(base: unknown) {
  if (typeof base === "string") return base;
  const p = (base ?? {}) as ShaderPath;
  return p.spectorName ?? p.vertex ?? p.vertexToken ?? p.vertexElement ?? "custom";
}

/**
 * Debug instrument: records every new shader program the engine builds (every `createEffect` that
 * misses the effect cache), tagged with the phase the game says it is in. Installed on the engine
 * before anything compiles; "no compiles in a play phase" is the check that nothing hitches mid-play.
 */
export class ShaderWatch {
  phase = "boot";
  readonly compiles: ShaderCompile[] = [];
  private seen = new WeakSet<object>();
  private restore: () => void;

  constructor(
    engine: AbstractEngine,
    private o: { report?: (c: ShaderCompile) => void } = {},
  ) {
    const host = engine as unknown as { createEffect: (...a: unknown[]) => object };
    const own = Object.prototype.hasOwnProperty.call(host, "createEffect");
    const orig = host.createEffect;
    const watch = this;
    host.createEffect = function (this: unknown, ...args: unknown[]) {
      const e = orig.apply(this, args);
      if (e && !watch.seen.has(e)) {
        watch.seen.add(e);
        const c = { phase: watch.phase, name: shaderName(args[0]), at: performance.now() };
        watch.compiles.push(c);
        watch.o.report?.(c);
      }
      return e;
    };
    this.restore = () => {
      if (own) host.createEffect = orig;
      else delete (host as { createEffect?: unknown }).createEffect;
    };
  }

  /** Later compiles are tagged with `phase` (e.g. "dragon:prepare", "dragon:play"). */
  mark(phase: string) {
    this.phase = phase;
  }

  /** Compiles so far, optionally only those in phases `which` accepts. */
  count(which?: (phase: string) => boolean) {
    return which ? this.compiles.filter((c) => which(c.phase)).length : this.compiles.length;
  }

  dispose() {
    this.restore();
  }
}
