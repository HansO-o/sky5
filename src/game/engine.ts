import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { KhronosTextureContainer2 } from "@babylonjs/core/Misc/khronosTextureContainer2";
import { MeshoptCompression } from "@babylonjs/core/Meshes/Compression/meshoptCompression";

const local = (p: string) => new URL(`decoders/${p}`, document.baseURI).href;

/** Point every decoder at our own copies so the game works offline and never hits a CDN. */
function configureDecoders() {
  const T = "ktx2Transcoders/1/";
  KhronosTextureContainer2.URLConfig = {
    jsDecoderModule: local("babylon.ktx2Decoder.js"),
    wasmUASTCToASTC: local(T + "uastc_astc.wasm"),
    wasmUASTCToBC7: local(T + "uastc_bc7.wasm"),
    wasmUASTCToRGBA_UNORM: local(T + "uastc_rgba8_unorm_v2.wasm"),
    wasmUASTCToRGBA_SRGB: local(T + "uastc_rgba8_srgb_v2.wasm"),
    wasmUASTCToR8_UNORM: local(T + "uastc_r8_unorm.wasm"),
    wasmUASTCToRG8_UNORM: local(T + "uastc_rg8_unorm.wasm"),
    jsMSCTranscoder: local(T + "msc_basis_transcoder.js"),
    wasmMSCTranscoder: local(T + "msc_basis_transcoder.wasm"),
    wasmZSTDDecoder: local("zstddec.wasm"),
  };
  // Transcoding runs in a worker pool (never on the main thread).
  KhronosTextureContainer2.DefaultNumWorkers = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  MeshoptCompression.Configuration = { decoder: { url: local("meshopt_decoder.js") } };
}

export interface EngineInfo {
  engine: AbstractEngine;
  api: "webgpu" | "webgl2";
}

export async function createEngine(canvas: HTMLCanvasElement): Promise<EngineInfo> {
  configureDecoders();
  const params = new URLSearchParams(location.search);
  const forceGL = params.has("webgl");
  if (!forceGL && "gpu" in navigator) {
    try {
      const { WebGPUEngine } = await import("@babylonjs/core/Engines/webgpuEngine");
      if (await WebGPUEngine.IsSupportedAsync) {
        const engine = new WebGPUEngine(canvas, {
          antialias: false,
          adaptToDeviceRatio: false,
          powerPreference: "high-performance",
          enableAllFeatures: false,
          setMaximumLimits: true,
        });
        // Core materials ship WGSL; glslang/tint are only fetched if a GLSL-only shader shows up.
        await engine.initAsync();
        return { engine, api: "webgpu" };
      }
    } catch (e) {
      console.warn("WebGPU unavailable, falling back to WebGL2", e);
    }
  }
  const { Engine } = await import("@babylonjs/core/Engines/engine");
  const engine = new Engine(canvas, false, {
    powerPreference: "high-performance",
    stencil: true,
    preserveDrawingBuffer: false,
    disableWebGL2Support: false,
    antialias: false,
  });
  if (engine.webGLVersion < 2) throw new Error("WebGL2 is required");
  return { engine, api: "webgl2" };
}
