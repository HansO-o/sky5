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
import { AtmosphereProfiles, type Atmosphere } from "../engine/render/atmosphere";
import { applyLightBudget } from "../engine/render/lightBudget";

export const FOG_COLOR = new Color3(0.6, 0.64, 0.68);

/**
 * Lighting profiles inside the keep and the cave (design §3.2). The sun goes to 0 (it is never
 * switched off: the light set never changes); the light comes from the pool lights (braziers,
 * torches), a little sky fill and image-based light, and a raised exposure.
 */
export const INTERIORS = {
  hall: { env: 0.25, fog: [0.08, 0.06, 0.05], density: 0.02, exposure: 1.25, sun: 0, fill: 0.05 },
  basement: { env: 0.08, fog: [0.03, 0.03, 0.035], density: 0.035, exposure: 1.45, sun: 0, fill: 0.03 },
  cave: { env: 0.05, fog: [0.02, 0.025, 0.03], density: 0.04, exposure: 1.6, sun: 0, fill: 0.02 },
} satisfies Record<string, Atmosphere>;
export type InteriorName = keyof typeof INTERIORS;
/**
 * "outdoor" restores the open-air look (with the current fire mood); "climb-out" blends from an
 * interior profile to outdoor by the viewer's distance to a tunnel mouth.
 */
export type LightingProfile = "outdoor" | InteriorName | "climb-out";

export interface InteriorOptions {
  /** climb-out: the tunnel mouth (fully outdoor there) */
  anchor?: { x: number; y: number; z: number };
  /** climb-out: metres before the anchor over which the blend happens (default 13) */
  span?: number;
  /** climb-out: the interior profile it starts from (default "cave") */
  from?: InteriorName;
  /** the blend starts from these values instead of the current ones (e.g. `{ exposure: 1.6 }` stepping into daylight) */
  start?: Partial<Atmosphere>;
  /** set the fire mood too (0..1; e.g. 1 when stepping out above the burning town) */
  mood?: number;
}

const OUTDOOR_EXPOSURE = 1.05;
const OUTDOOR_FILL = 0.12;

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
  /** the hemispheric sky fill */
  fill: HemisphericLight;
  /** the sky dome (hidden with the outdoor world) */
  sky: Mesh;
  shadows: CascadedShadowGenerator | null;
  pipeline: DefaultRenderingPipeline;
  addShadowCaster(m: AbstractMesh): void;
  applyQuality(q: Quality): void;
  /** 0 = the overcast morning, 1 = the town burning (smoky orange fog, dimmer reddened light) */
  setMood(k: number): void;
  readonly mood: number;
  /**
   * Blend to a lighting profile over `seconds`: sun and fill intensity, image-based light, fog and
   * exposure (uniforms only: nothing recompiles). Inside (sun 0) the sun's shadow map stops
   * re-rendering. See {@link INTERIORS}; "climb-out" needs `o.anchor`.
   */
  setInterior(profile: LightingProfile, seconds?: number, o?: InteriorOptions): void;
  /** the profile last set ("outdoor" at start) */
  readonly interior: LightingProfile;
  /** per frame (World.update): advances blends; `eye` drives "climb-out" */
  update(dt: number, eye: Vector3): void;
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
  applyLightBudget([skyMat]);
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
    refreshShadows();
  };
  /** the sun's shadow map renders only while the sun shines (inside it is frozen) */
  const refreshShadows = () => {
    const map = shadows?.getShadowMap();
    const rate = sun.intensity > 1e-3 ? 1 : 0;
    // (only on a change: setting the rate re-arms one more render)
    if (map && map.refreshRate !== rate) map.refreshRate = rate;
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
  const smoke = new Color3();
  /** the open-air values at the current mood and quality */
  const outdoor = (): Atmosphere => {
    Color3.LerpToRef(FOG_COLOR, SMOKE, mood, smoke);
    return {
      env: envBase * (1 - mood * 0.3),
      fog: [smoke.r, smoke.g, smoke.b],
      density: baseFog * (1 + mood * 0.7),
      exposure: OUTDOOR_EXPOSURE,
      sun: sunBase.i * (1 - mood * 0.35),
      fill: OUTDOOR_FILL,
    };
  };
  /** write blended values into the scene (all uniforms) */
  const write = (a: Atmosphere) => {
    scene.environmentIntensity = a.env;
    scene.fogColor.set(a.fog[0], a.fog[1], a.fog[2]);
    scene.clearColor.set(a.fog[0], a.fog[1], a.fog[2], 1);
    scene.fogDensity = a.density;
    ip.exposure = a.exposure;
    sun.intensity = a.sun;
    fill.intensity = a.fill;
    refreshShadows();
  };
  const profiles = new AtmosphereProfiles({ outdoor, profiles: INTERIORS, write });
  /** the mood's parts that are not blended: sun tint, sky dome */
  const tint = () => {
    Color3.LerpToRef(sunBase.c, FIRE_SUN, mood, sun.diffuse);
    if (skyMat.emissiveTexture) skyMat.emissiveTexture.level = 1 - mood * 0.45;
    skyMat.emissiveColor.set(mood * 0.12, mood * 0.04, 0);
  };
  /** the mood changed: tint, and outdoors (no blend under way) the blended values at once */
  const applyMood = () => {
    tint();
    profiles.outdoorChanged();
  };
  const env3: Environment = {
    sun,
    fill,
    sky,
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
    get mood() {
      return mood;
    },
    setInterior(profile, seconds = 1.5, o = {}) {
      if (o.mood !== undefined) {
        mood = Math.max(0, Math.min(1, o.mood));
        tint();
      }
      profiles.set(profile, seconds, o);
    },
    get interior() {
      return profiles.profile as LightingProfile;
    },
    update(dt, eye) {
      profiles.update(dt, eye);
    },
    dispose() {
      shadows?.dispose();
      pipeline.dispose();
    },
  };
  return env3;
}
