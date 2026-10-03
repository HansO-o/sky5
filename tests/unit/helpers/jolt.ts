// Jolt and a Babylon scene in Node, for physics tests (the app loads Jolt's wasm through a Vite ?url import).
import init from "jolt-physics/wasm";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Logger } from "@babylonjs/core/Misc/logger";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Physics } from "../../../src/engine/physics/Physics";

type JoltInstance = Awaited<ReturnType<typeof init>>;
let joltP: Promise<JoltInstance> | null = null;

/** The Jolt module (loaded once per test file). */
export function nodeJolt() {
  joltP ??= init({
    locateFile: () => {
      let js: string;
      try {
        js = fileURLToPath(import.meta.resolve("jolt-physics/wasm"));
      } catch {
        js = path.resolve("node_modules/jolt-physics/dist/jolt-physics.wasm.js");
      }
      return js.replace(/\.js$/, ".wasm");
    },
  });
  return joltP;
}

/** A fresh physics world on the shared module. */
export async function newPhysics() {
  return Physics.create(await nodeJolt());
}

/** A headless right-handed scene (meshes and transform nodes; nothing renders). */
export function newScene() {
  // no version banner per engine
  Logger.LogLevels = Logger.WarningLogLevel | Logger.ErrorLogLevel;
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  return { engine, scene, dispose: () => (scene.dispose(), engine.dispose()) };
}

/** Run `seconds` of fixed steps. */
export function run(ph: Physics, seconds: number) {
  const n = Math.round(seconds / ph.step);
  for (let i = 0; i < n; i++) ph.update(ph.step);
}
