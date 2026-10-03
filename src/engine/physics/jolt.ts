import type JoltType from "jolt-physics/wasm";

export type Jolt = typeof JoltType;
/** The initialised Jolt module (`J` everywhere): constructors, enums and `destroy`. */
export type JoltInstance = Awaited<ReturnType<typeof JoltType>>;

let modP: Promise<JoltInstance> | null = null;
/**
 * Load the Jolt wasm module once (lazy; ~1 MB of code + wasm, cached by the service worker).
 * The only Vite-specific import of the physics modules (framework S18 routes it through `runtime()`).
 */
export function loadJolt() {
  modP ??= (async () => {
    const [{ default: init }, { default: wasmUrl }] = await Promise.all([import("jolt-physics/wasm"), import("jolt-physics/jolt-physics.wasm.wasm?url")]);
    return init({ locateFile: () => wasmUrl });
  })();
  return modP;
}
