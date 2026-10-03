// Third-party source assets. Every entry here is downloaded by tools/fetch-sources.mjs into
// assets-src/ and is listed (with author + licence) in the generated credits.json.
//
// Poly Haven: all assets CC0 (https://polyhaven.com/license).

/** Surface textures: id -> maps to fetch. `res` is the source resolution we download. */
export const PH_TEXTURES = {
  forrest_ground_01: { res: "2k", maps: ["Diffuse", "nor_gl"] },
  forest_ground_04: { res: "2k", maps: ["Diffuse", "nor_gl"] },
  rocky_terrain_02: { res: "2k", maps: ["Diffuse", "nor_gl"] },
  rocky_trail: { res: "2k", maps: ["Diffuse", "nor_gl"] },
  snow_02: { res: "1k", maps: ["Diffuse", "nor_gl"] },
  pine_bark: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  weathered_brown_planks: { res: "2k", maps: ["Diffuse", "nor_gl", "arm"] },
  medieval_wood: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  thatch_roof_angled: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  plastered_stone_wall: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  rusty_metal_02: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  hessian_230: { res: "1k", maps: ["Diffuse", "nor_gl"] },
  brown_leather: { res: "1k", maps: ["Diffuse", "nor_gl"] },
  castle_brick_07: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  castle_wall_slates: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  old_planks_02: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  rough_wood: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  burned_ground_01: { res: "1k", maps: ["Diffuse", "nor_gl"] },
};

/** Extra texture maps that live inside a model asset (fir twig cards). */
export const PH_MODEL_TEXTURES = {
  fir_tree_01: { res: "2k", maps: ["twig_diff", "twig_alpha", "twig_nor_gl"] },
};

/** glTF models. */
export const PH_MODELS = {
  boulder_01: "1k",
  rock_moss_set_01: "1k",
  rock_moss_set_02: "1k",
  rock_face_01: "2k",
  mountainside: "2k",
  modular_fort_01: "2k",
  large_castle_door: "1k",
  wooden_barrels_01: "1k",
  wooden_crate_01: "1k",
  wooden_lantern_01: "1k",
  wooden_bucket_01: "1k",
  tree_stump_01: "1k",
  dead_tree_trunk: "1k",
  fern_02: "1k",
  kite_shield: "1k",
  wicker_basket_01: "1k",
  wooden_axe_03: "1k",
  wooden_bucket_02: "1k",
};

export const PH_HDRIS = {
  kloofendal_overcast_puresky: { hdrRes: "1k" },
};
