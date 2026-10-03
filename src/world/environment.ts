import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { HDRCubeTexture } from "@babylonjs/core/Materials/Textures/hdrCubeTexture";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Quality } from "../core/settings";
import { blobURL, loadKTX2 } from "../game/loaders";

export const FOG_COLOR = new Color3(0.6, 0.64, 0.68);

/** Sky dome UV-mapped to the upper half of an equirectangular panorama. */
function buildSkyDome(scene: Scene) {
  const lon = 64, lat = 20;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const R = 1;
  for (let j = 0; j <= lat; j++) {
    // elevation from +90 (j=0) down to -12 degrees
    const el = ((90 - (j / lat) * 102) * Math.PI) / 180;
    for (let i = 0; i <= lon; i++) {
      const az = (i / lon) * Math.PI * 2;
      pos.push(Math.cos(el) * Math.sin(az) * R, Math.sin(el) * R, Math.cos(el) * Math.cos(az) * R);
      uv.push(1 - i / lon, Math.min(1, (90 - (el * 180) / Math.PI) / 90));
    }
  }
  for (let j = 0; j < lat; j++)
    for (let i = 0; i < lon; i++) {
      const a = j * (lon + 1) + i, b = a + 1, c = a + lon + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const vd = new VertexData();
  vd.positions = pos;
  vd.uvs = uv;
  vd.indices = idx;
  const m = new Mesh("sky", scene);
  vd.applyToMesh(m);
  m.infiniteDistance = true;
  m.scaling.setAll(1800);
  m.isPickable = false;
  m.applyFog = false;
  m.renderingGroupId = 0;
  return m;
}

export interface Environment {
  sun: DirectionalLight;
  shadows: CascadedShadowGenerator | null;
  pipeline: DefaultRenderingPipeline;
  addShadowCaster(m: AbstractMesh): void;
  applyQuality(q: Quality): void;
  /** 0 = the overcast morning, 1 = the town burning (smoky orange fog, dimmer reddened light) */
  setMood(k: number): void;
  dispose(): void;
}

export async function createEnvironment(scene: Scene, camera: Camera): Promise<Environment> {
  scene.clearColor = new Color4(FOG_COLOR.r, FOG_COLOR.g, FOG_COLOR.b, 1);
  scene.fogMode = 2; // EXP2
  scene.fogColor = FOG_COLOR.clone();
  scene.fogDensity = 0.0024;
  scene.ambientColor = new Color3(0, 0, 0);

  // image-based lighting from the overcast HDRI (prefiltered on the GPU at load)
  const url = await blobURL("cart/sky_env");
  const env = await new Promise<HDRCubeTexture>((resolve, reject) => {
    const t = new HDRCubeTexture(url, scene, 128, false, true, false, true, () => resolve(t), (m) => reject(new Error(String(m))));
  });
  URL.revokeObjectURL(url);
  scene.environmentTexture = env;
  scene.environmentIntensity = 0.95;

  const skyTex = await loadKTX2("cart/sky", scene, { wrap: true, noMipmap: true });
  const sky = buildSkyDome(scene);
  const skyMat = new StandardMaterial("skyMat", scene);
  skyMat.disableLighting = true;
  skyMat.emissiveTexture = skyTex;
  skyMat.backFaceCulling = false;
  skyMat.fogEnabled = false;
  skyMat.disableDepthWrite = true;
  sky.material = skyMat;
  sky.infiniteDistance = true;

  // Diffuse overcast sun from the south-west, plus a faint sky fill for the shadowed side.
  const sun = new DirectionalLight("sun", new Vector3(0.45, -0.72, 0.52).normalize(), scene);
  sun.intensity = 2.1;
  sun.diffuse = new Color3(1, 0.96, 0.9);
  sun.position = new Vector3(-200, 300, -200);
  const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  fill.intensity = 0.12;
  fill.diffuse = new Color3(0.7, 0.75, 0.82);
  fill.groundColor = new Color3(0.25, 0.24, 0.22);
  fill.specular = Color3.Black();

  let shadows: CascadedShadowGenerator | null = null;
  const casters: AbstractMesh[] = [];
  const makeShadows = (size: number, cascades: number) => {
    shadows?.dispose();
    const sg = new CascadedShadowGenerator(size, sun);
    sg.numCascades = cascades;
    sg.lambda = 0.82;
    sg.shadowMaxZ = 220;
    sg.stabilizeCascades = true;
    sg.cascadeBlendPercentage = 0.08;
    sg.filteringQuality = CascadedShadowGenerator.QUALITY_MEDIUM;
    sg.usePercentageCloserFiltering = true;
    sg.bias = 0.0025;
    sg.normalBias = 0.02;
    sg.darkness = 0.18;
    sg.transparencyShadow = true;
    sg.enableSoftTransparentShadow = false;
    casters.forEach((m) => sg.addShadowCaster(m, false));
    shadows = sg;
  };

  const pipeline = new DefaultRenderingPipeline("post", true, scene, [camera]);
  pipeline.imageProcessingEnabled = true;
  const ip = pipeline.imageProcessing;
  ip.toneMappingEnabled = true;
  ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  ip.exposure = 1.05;
  ip.contrast = 1.12;
  ip.vignetteEnabled = true;
  ip.vignetteWeight = 1.6;
  ip.vignetteColor = new Color4(0, 0, 0, 0);
  ip.vignetteStretch = 0.3;
  // cool, slightly desaturated grade
  ip.colorCurvesEnabled = true;
  ip.colorCurves!.globalSaturation = -12;
  ip.colorCurves!.shadowsHue = 210;
  ip.colorCurves!.shadowsDensity = 18;
  ip.colorCurves!.shadowsSaturation = 20;
  ip.colorCurves!.highlightsHue = 40;
  ip.colorCurves!.highlightsDensity = 8;
  ip.colorCurves!.highlightsSaturation = 10;
  pipeline.bloomThreshold = 0.85;
  pipeline.bloomWeight = 0.18;
  pipeline.bloomKernel = 48;
  pipeline.bloomScale = 0.5;

  let mood = 0, baseFog = 0.0024;
  /** tier last applied: re-applying the same one is a no-op (it would rebuild the shadow maps) */
  let tier: Quality | null = null;
  const sunBase = { c: sun.diffuse.clone(), i: sun.intensity }, envBase = scene.environmentIntensity;
  const SMOKE = new Color3(0.36, 0.29, 0.25), FIRE_SUN = new Color3(1, 0.6, 0.38);
  const applyMood = () => {
    Color3.LerpToRef(FOG_COLOR, SMOKE, mood, scene.fogColor);
    scene.clearColor.set(scene.fogColor.r, scene.fogColor.g, scene.fogColor.b, 1);
    scene.fogDensity = baseFog * (1 + mood * 0.7);
    Color3.LerpToRef(sunBase.c, FIRE_SUN, mood, sun.diffuse);
    sun.intensity = sunBase.i * (1 - mood * 0.35);
    scene.environmentIntensity = envBase * (1 - mood * 0.3);
    if (skyMat.emissiveTexture) skyMat.emissiveTexture.level = 1 - mood * 0.45;
    skyMat.emissiveColor.set(mood * 0.12, mood * 0.04, 0);
  };
  const env3: Environment = {
    sun,
    get shadows() {
      return shadows;
    },
    pipeline,
    addShadowCaster(m) {
      casters.push(m);
      shadows?.addShadowCaster(m, false);
    },
    applyQuality(q) {
      if (q === tier) return;
      tier = q;
      if (q === "low") {
        shadows?.dispose();
        shadows = null;
        pipeline.bloomEnabled = false;
        pipeline.fxaaEnabled = true;
        pipeline.samples = 1;
        ip.colorCurvesEnabled = false;
        baseFog = 0.0032;
      } else if (q === "medium") {
        makeShadows(1024, 2);
        shadows!.shadowMaxZ = 120;
        pipeline.bloomEnabled = false;
        pipeline.fxaaEnabled = true;
        pipeline.samples = 1;
        ip.colorCurvesEnabled = true;
        baseFog = 0.0026;
      } else {
        makeShadows(2048, 3);
        pipeline.bloomEnabled = true;
        pipeline.fxaaEnabled = false;
        pipeline.samples = 4;
        ip.colorCurvesEnabled = true;
        baseFog = 0.0024;
      }
      applyMood();
    },
    setMood(k) {
      mood = Math.max(0, Math.min(1, k));
      applyMood();
    },
    dispose() {
      shadows?.dispose();
      pipeline.dispose();
    },
  };
  return env3;
}
