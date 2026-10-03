import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { Material } from "@babylonjs/core/Materials/material";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShadowDepthWrapper } from "@babylonjs/core/Materials/shadowDepthWrapper";
import type { Scene } from "@babylonjs/core/scene";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { applyLightBudget } from "../engine/render/lightBudget";

export const LAYERS = ["grass", "dirt", "rock", "road", "snow"] as const;
export type Layer = (typeof LAYERS)[number];

/**
 * Terrain splatting for PBRMaterial. Weights come from the vertex colour (dirt, rock, road, snow;
 * grass = remainder). Layers are sampled with world-space XZ coordinates; rock is tri-planar so steep
 * slopes don't stretch. Height-aware blending uses each layer's luminance as a height proxy.
 */
export class TerrainSplatPlugin extends MaterialPluginBase {
  diffuse: Record<Layer, Texture | null> = { grass: null, dirt: null, rock: null, road: null, snow: null };
  normal: Record<Layer, Texture | null> = { grass: null, dirt: null, rock: null, road: null, snow: null };
  /** metres per texture repeat */
  tile: Record<Layer, number> = { grass: 4.5, dirt: 4, rock: 7, road: 3.2, snow: 6 };
  useNormals = true;

  constructor(material: Material) {
    super(material, "TerrainSplat", 200, { TERRAIN: false, TERRAIN_NORMALS: false });
    this._enable(true);
  }

  isCompatible(_l: ShaderLanguage) {
    return true;
  }

  getClassName() {
    return "TerrainSplatPlugin";
  }

  isReadyForSubMesh() {
    return LAYERS.every((l) => this.diffuse[l]?.isReady() && (!this.useNormals || this.normal[l]?.isReady()));
  }

  prepareDefines(defines: MaterialDefines) {
    defines["TERRAIN"] = true;
    defines["TERRAIN_NORMALS"] = this.useNormals;
  }

  getAttributes(attributes: string[]) {
    attributes.push("color");
  }

  getSamplers(samplers: string[]) {
    for (const l of LAYERS) samplers.push(`tD_${l}`);
    if (this.useNormals) for (const l of LAYERS) samplers.push(`tN_${l}`);
  }

  getActiveTextures(active: BaseTexture[]) {
    for (const l of LAYERS) {
      if (this.diffuse[l]) active.push(this.diffuse[l]!);
      if (this.normal[l]) active.push(this.normal[l]!);
    }
  }

  hasTexture(t: BaseTexture) {
    return LAYERS.some((l) => this.diffuse[l] === t || this.normal[l] === t);
  }

  getUniforms(lang: ShaderLanguage = ShaderLanguage.GLSL) {
    return {
      ubo: [
        { name: "tTileA", size: 4, type: "vec4" },
        { name: "tTileB", size: 4, type: "vec4" },
      ],
      fragment:
        lang === ShaderLanguage.WGSL
          ? `#ifdef TERRAIN
uniform tTileA: vec4f;
uniform tTileB: vec4f;
#endif`
          : `#ifdef TERRAIN
uniform vec4 tTileA;
uniform vec4 tTileB;
#endif`,
    };
  }

  bindForSubMesh(ubo: UniformBuffer) {
    const t = this.tile;
    ubo.updateFloat4("tTileA", 1 / t.grass, 1 / t.dirt, 1 / t.rock, 1 / t.road);
    ubo.updateFloat4("tTileB", 1 / t.snow, 0, 0, 0);
    for (const l of LAYERS) {
      ubo.setTexture(`tD_${l}`, this.diffuse[l]);
      if (this.useNormals) ubo.setTexture(`tN_${l}`, this.normal[l]);
    }
  }

  getCustomCode(shaderType: string, lang: ShaderLanguage = ShaderLanguage.GLSL): Record<string, string> | null {
    if (lang === ShaderLanguage.WGSL) {
      if (shaderType === "vertex")
        return {
          CUSTOM_VERTEX_DEFINITIONS: `#ifdef TERRAIN
attribute color: vec4f;
varying vTerrainW: vec4f;
#endif`,
          CUSTOM_VERTEX_MAIN_END: `#ifdef TERRAIN
vertexOutputs.vTerrainW = vertexInputs.color;
#endif`,
        };
      const samplers =
        LAYERS.map((l) => `var tD_${l}Sampler: sampler;\nvar tD_${l}: texture_2d<f32>;`).join("\n") +
        "\n#ifdef TERRAIN_NORMALS\n" +
        LAYERS.map((l) => `var tN_${l}Sampler: sampler;\nvar tN_${l}: texture_2d<f32>;`).join("\n") +
        "\n#endif";
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef TERRAIN
varying vTerrainW: vec4f;
${samplers}
fn tLum(c: vec3f) -> f32 { return dot(c, vec3f(0.3, 0.59, 0.11)); }
fn tUnpack(n: vec3f) -> vec3f { return n * 2.0 - 1.0; }
#endif`,
        CUSTOM_FRAGMENT_UPDATE_ALPHA: `#ifdef TERRAIN
{
  let P = fragmentInputs.vPositionW;
  let N0 = normalize(fragmentInputs.vNormalW);
  let uv = P.xz;
  var w = clamp(fragmentInputs.vTerrainW, vec4f(0.0), vec4f(1.0));
  let wg = clamp(1.0 - (w.x + w.y + w.z + w.w), 0.0, 1.0);
  let cg = textureSample(tD_grass, tD_grassSampler, uv * uniforms.tTileA.x).rgb;
  let cd = textureSample(tD_dirt, tD_dirtSampler, uv * uniforms.tTileA.y).rgb;
  // tri-planar rock
  var bw = pow(abs(N0), vec3f(4.0));
  bw = bw / (bw.x + bw.y + bw.z);
  let rs = uniforms.tTileA.z;
  let crx = textureSample(tD_rock, tD_rockSampler, P.zy * rs).rgb;
  let cry = textureSample(tD_rock, tD_rockSampler, P.xz * rs).rgb;
  let crz = textureSample(tD_rock, tD_rockSampler, P.xy * rs).rgb;
  let cr = crx * bw.x + cry * bw.y + crz * bw.z;
  let cw = textureSample(tD_road, tD_roadSampler, uv * uniforms.tTileA.w).rgb;
  let cs = textureSample(tD_snow, tD_snowSampler, uv * uniforms.tTileB.x).rgb;
  // height-aware blend
  var hw = array<f32, 5>(wg * (0.55 + tLum(cg)), w.x * (0.55 + tLum(cd)), w.y * (0.55 + tLum(cr)), w.z * (0.55 + tLum(cw)), w.w * (0.55 + tLum(cs)));
  var mx = 0.0;
  for (var i = 0; i < 5; i++) { mx = max(mx, hw[i]); }
  var sum = 0.0;
  for (var i = 0; i < 5; i++) { hw[i] = max(hw[i] - mx * 0.55, 0.0); sum += hw[i]; }
  for (var i = 0; i < 5; i++) { hw[i] = hw[i] / max(sum, 1e-4); }
  var albedo = cg * hw[0] + cd * hw[1] + cr * hw[2] + cw * hw[3] + cs * hw[4];
  // macro variation against visible tiling
  let macroC = textureSample(tD_grass, tD_grassSampler, uv * 0.013).rgb;
  albedo = albedo * (0.75 + 0.5 * tLum(macroC));
  surfaceAlbedo = toLinearSpaceVec3(albedo);
#ifdef TERRAIN_NORMALS
  let ng = tUnpack(textureSample(tN_grass, tN_grassSampler, uv * uniforms.tTileA.x).rgb);
  let nd = tUnpack(textureSample(tN_dirt, tN_dirtSampler, uv * uniforms.tTileA.y).rgb);
  let nr = tUnpack(textureSample(tN_rock, tN_rockSampler, P.xz * rs).rgb);
  let nw = tUnpack(textureSample(tN_road, tN_roadSampler, uv * uniforms.tTileA.w).rgb);
  let ns = tUnpack(textureSample(tN_snow, tN_snowSampler, uv * uniforms.tTileB.x).rgb);
  let nt = normalize(ng * hw[0] + nd * hw[1] + nr * hw[2] + nw * hw[3] + ns * hw[4]);
  let T = normalize(vec3f(1.0, 0.0, 0.0) - N0 * N0.x);
  let B = cross(T, N0);
  normalW = normalize(T * nt.x + B * nt.y + N0 * nt.z);
#endif
}
#endif`,
      };
    }
    if (shaderType === "vertex")
      return {
        CUSTOM_VERTEX_DEFINITIONS: `#ifdef TERRAIN
attribute vec4 color;
varying vec4 vTerrainW;
#endif`,
        CUSTOM_VERTEX_MAIN_END: `#ifdef TERRAIN
vTerrainW = color;
#endif`,
      };
    const samplers =
      LAYERS.map((l) => `uniform sampler2D tD_${l};`).join("\n") +
      "\n#ifdef TERRAIN_NORMALS\n" +
      LAYERS.map((l) => `uniform sampler2D tN_${l};`).join("\n") +
      "\n#endif";
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef TERRAIN
varying vec4 vTerrainW;
${samplers}
float tLum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 tUnpack(vec3 n) { return n * 2.0 - 1.0; }
#endif`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `#ifdef TERRAIN
{
  vec3 P = vPositionW;
  vec3 N0 = normalize(vNormalW);
  vec2 uv = P.xz;
  vec4 w = clamp(vTerrainW, 0.0, 1.0);
  float wg = clamp(1.0 - (w.x + w.y + w.z + w.w), 0.0, 1.0);
  vec3 cg = texture2D(tD_grass, uv * tTileA.x).rgb;
  vec3 cd = texture2D(tD_dirt, uv * tTileA.y).rgb;
  vec3 bw = pow(abs(N0), vec3(4.0));
  bw /= (bw.x + bw.y + bw.z);
  float rs = tTileA.z;
  vec3 cr = texture2D(tD_rock, P.zy * rs).rgb * bw.x + texture2D(tD_rock, P.xz * rs).rgb * bw.y + texture2D(tD_rock, P.xy * rs).rgb * bw.z;
  vec3 cw = texture2D(tD_road, uv * tTileA.w).rgb;
  vec3 cs = texture2D(tD_snow, uv * tTileB.x).rgb;
  float hw[5];
  hw[0] = wg * (0.55 + tLum(cg));
  hw[1] = w.x * (0.55 + tLum(cd));
  hw[2] = w.y * (0.55 + tLum(cr));
  hw[3] = w.z * (0.55 + tLum(cw));
  hw[4] = w.w * (0.55 + tLum(cs));
  float mx = max(max(max(hw[0], hw[1]), max(hw[2], hw[3])), hw[4]);
  float sum = 0.0;
  for (int i = 0; i < 5; i++) { hw[i] = max(hw[i] - mx * 0.55, 0.0); sum += hw[i]; }
  for (int i = 0; i < 5; i++) { hw[i] /= max(sum, 1e-4); }
  vec3 albedo = cg * hw[0] + cd * hw[1] + cr * hw[2] + cw * hw[3] + cs * hw[4];
  vec3 macroC = texture2D(tD_grass, uv * 0.013).rgb;
  albedo *= 0.75 + 0.5 * tLum(macroC);
  surfaceAlbedo = toLinearSpace(albedo);
#ifdef TERRAIN_NORMALS
  vec3 nt = normalize(
      tUnpack(texture2D(tN_grass, uv * tTileA.x).rgb) * hw[0] +
      tUnpack(texture2D(tN_dirt, uv * tTileA.y).rgb) * hw[1] +
      tUnpack(texture2D(tN_rock, P.xz * rs).rgb) * hw[2] +
      tUnpack(texture2D(tN_road, uv * tTileA.w).rgb) * hw[3] +
      tUnpack(texture2D(tN_snow, uv * tTileB.x).rgb) * hw[4]);
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N0 * N0.x);
  vec3 B = cross(T, N0);
  normalW = normalize(T * nt.x + B * nt.y + N0 * nt.z);
#endif
}
#endif`,
    };
  }
}

export function createTerrainMaterial(scene: Scene) {
  const m = new PBRMaterial("terrain", scene);
  m.metallic = 0;
  m.roughness = 0.93;
  m.environmentIntensity = 0.85;
  applyLightBudget([m]);
  const plugin = new TerrainSplatPlugin(m);
  return { material: m, plugin };
}

/**
 * Wind sway for foliage: displaces world position proportional to the square of local height,
 * phase-shifted by world position so neighbouring trees don't move in lockstep.
 */
export class WindPlugin extends MaterialPluginBase {
  static time = 0;
  static strength = 1;
  /** amplitude in metres at 10 m height */
  amplitude = 0.25;
  /** local height where sway starts */
  baseHeight = 0.5;

  constructor(material: Material) {
    super(material, "Wind", 150, { WIND: false });
    this._enable(true);
  }
  isCompatible() {
    return true;
  }
  getClassName() {
    return "WindPlugin";
  }
  prepareDefines(defines: MaterialDefines) {
    defines["WIND"] = true;
  }
  getUniforms(lang: ShaderLanguage = ShaderLanguage.GLSL) {
    return {
      ubo: [{ name: "windParams", size: 4, type: "vec4" }],
      vertex: lang === ShaderLanguage.WGSL ? "#ifdef WIND\nuniform windParams: vec4f;\n#endif" : "#ifdef WIND\nuniform vec4 windParams;\n#endif",
    };
  }
  bindForSubMesh(ubo: UniformBuffer) {
    ubo.updateFloat4("windParams", this.amplitude * WindPlugin.strength, WindPlugin.time, this.baseHeight, 0);
  }
  getCustomCode(shaderType: string, lang: ShaderLanguage = ShaderLanguage.GLSL): Record<string, string> | null {
    if (shaderType !== "vertex") return null;
    if (lang === ShaderLanguage.WGSL)
      return {
        CUSTOM_VERTEX_UPDATE_WORLDPOS: `#ifdef WIND
{
  let h = max(positionUpdated.y - uniforms.windParams.z, 0.0) * 0.1;
  let ph = dot(worldPos.xz, vec2f(0.071, 0.053)) + uniforms.windParams.y;
  let sway = vec2f(sin(ph * 1.3) + 0.4 * sin(ph * 2.9 + 1.7), cos(ph * 1.1) * 0.6 + 0.3 * sin(ph * 3.7)) * uniforms.windParams.x * h * h;
  worldPos = vec4f(worldPos.x + sway.x, worldPos.y, worldPos.z + sway.y, worldPos.w);
}
#endif`,
      };
    return {
      CUSTOM_VERTEX_UPDATE_WORLDPOS: `#ifdef WIND
{
  float h = max(positionUpdated.y - windParams.z, 0.0) * 0.1;
  float ph = dot(worldPos.xz, vec2(0.071, 0.053)) + windParams.y;
  vec2 sway = vec2(sin(ph * 1.3) + 0.4 * sin(ph * 2.9 + 1.7), cos(ph * 1.1) * 0.6 + 0.3 * sin(ph * 3.7)) * windParams.x * h * h;
  worldPos.xz += sway;
}
#endif`,
    };
  }
}

/**
 * Wind sway in the shadow pass: the shadow generator renders a caster with this material's own vertex
 * code (wind displacement included) instead of its generic depth shader, so shadows sway with it.
 */
export function swayShadows(mat: Material) {
  // WGSL keeps varyings in vertexOutputs; the injected shadow-depth code expects a plain vNormalW
  const options = mat.shaderLanguage === ShaderLanguage.WGSL ? { remappedVariables: ["vNormalW", "vertexOutputs.vNormalW"] } : undefined;
  mat.shadowDepthWrapper = new ShadowDepthWrapper(mat, mat.getScene(), options);
}
