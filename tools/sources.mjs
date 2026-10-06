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
  rough_block_wall: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  castle_wall_slates: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  old_planks_02: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  rough_wood: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  burned_ground_01: { res: "1k", maps: ["Diffuse", "nor_gl"] },
  // keep interior (tools/gen/keepinterior.mjs): basement walls, all floors, doors and woodwork
  stone_brick_wall_001: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  rock_tile_floor: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  dark_wooden_planks: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  // cave (tools/gen/cave.mjs → cave/tex/*): walls, floors, the stream bed, the last 25 m of the climb + the outcrop
  rock_face_03: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  rocks_ground_08: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  ganges_river_pebbles: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  mossy_rock: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
  // procedural props (tools/gen/procprops.mjs): the gallery drawbridge deck
  weathered_planks: { res: "1k", maps: ["Diffuse", "nor_gl", "arm"] },
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
  // keep/exit props (design §10.2): hall cover tables, the cave camp fire, the outcrop brow
  wooden_table_02: "1k",
  stone_fire_pit: "1k",
  rock_face_02: "1k",
};

export const PH_HDRIS = {
  kloofendal_overcast_puresky: { hdrRes: "1k" },
};

/**
 * Quaternius "Fantasy Props MegaKit [Standard]" (CC0 1.0, License_Standard.txt in the zip), itch.io
 * upload 13887750. tools/fetch-extra.mjs pulls only these glTF models (+ .bin), the trim textures
 * and the licence out of the 150 MB zip with ranged requests; tools/gen/propkit.mjs merges them into
 * the kit/fpm GLB (one node per model, named as here; `as` renames).
 */
export const FPM_KIT = {
  game: "https://quaternius.itch.io/fantasy-props-megakit",
  upload: 13887750,
  dir: "Exports/glTF/",
  models: [
    "Sword_Bronze", "Axe_Bronze", "Shield_Wooden",
    "Torch_Metal", "Lantern_Wall", "Candle_1",
    "Barrel", "Crate_Wooden", "Crate_Metal", "Chest_Wood", "Bag", "Pouch_Large",
    "Table_Large", "Chair_1", "Bench", "Stool", "Bed_Twin1", "WeaponStand", "Peg_Rack", "Shelf_Small_Bottles", "Dummy",
    "Chain_Coil", "Cage_Small", "Cauldron", "Key_Metal",
    "Potion_1", "Potion_2", "Potion_4", "Bottle_1", "SmallBottle", "SmallBottles_1",
    "Scroll_1", "Book_7", "Mug",
  ],
  /** kit node names that differ from the source model (the keep anchors ask for kit/Book) */
  as: { Book_7: "Book" },
  textures: ["T_Trim_Furniture", "T_Trim_Metal", "T_Trim_Props", "T_Trim_Cloth"].flatMap((t) => ["BaseColor", "Normal", "ORM"].map((m) => `${t}_${m}.png`)).concat(["T_Page_Noise.png"]),
};
