## Summary

I checked three sources: Poly Haven (the live API, 521 model slugs, all CC0), Quaternius and KayKit. Kenney and OpenGameArt were checked only as fallbacks. **The best single source for props is Quaternius "Fantasy Props MegaKit [Standard]".** It is CC0 and free, and it has glTF files for 94 assets. I confirmed its license file and listed its contents through ranged downloads.

It covers the sword, axe, round shield, wall torch, barrels, crates, an animated chest, a cage, a chain coil, a table, chairs, a bed, a weapon rack, potions and bottles. It uses the same Quaternius PBR style (BaseColor, Normal, ORM) as the game's characters. Poly Haven adds photoreal alternatives that match the world's textures.

Nothing free covers these, so they need procedural generation: a lever, hanging chains or shackles, a prisoner-size cage (or the small Quaternius cage scaled up), crystals and a rope bridge. The existing `tools/gen/shapes.mjs` box and cylinder helpers are enough for this, plus one small torus helper.

No Blender, OBJ or FBX converter is installed. That rules out most OpenGameArt assets, which ship only as .blend or .obj.

### Armour (part names checked in assets-src)
- The free outfits tier (I listed the itch upload 16289385 zip directly) is **Peasant + Ranger only**.
- Ranger parts are already merged by `tools/gen/characters.mjs` as `outfit_ranger_Acc_Pauldron`, `outfit_ranger_Arms_Bracer`, `outfit_ranger_Body_Belt_1` (plus `Body_Belt_1.001` on the female body), `outfit_ranger_Head_Hood` and `outfit_ranger_Feet_Boots`. This is leather armour.
- Knight, plate and other armour outfits are only in the paid Pro/Source tiers, so they can't be fetched.
- Poly Haven has no armour or helmets.
- KayKit Adventurers has a rigid `Knight_Helmet` mesh under its `head` node, but the chunky toy proportions don't suit our characters.
- **Recommendation:** tint the Ranger parts per faction through baseColorFactor (as the build already does for muting). The Quaternius `Dummy` prop (1.86 m) can stand in for an armour stand.

### Quaternius Fantasy Props MegaKit [Standard] (CC0, verified)
- itch game `https://quaternius.itch.io/fantasy-props-megakit`, **upload id 13887750**, file `Fantasy Props MegaKit[Standard].zip`: 150.2 MB, 523 entries.
- It downloads with the existing `itch()` csrf POST to `/file/13887750?source=game_download`; no purchase key is needed (tested).
- glTF files are at `Exports/glTF/<Name>.gltf` and `.bin`. Four shared 2048² trim texture sets sit beside them: `T_Trim_{Furniture,Metal,Props,Cloth}_{BaseColor,Normal,ORM}.png`, about 31 MB of PNG. `T_Page_Noise.png` (7.5 MB) is only needed for scrolls.
- No glTF extensions are used. `License_Standard.txt` says CC0 1.0.

Key models (triangle count, size in metres):

| Model | Tris | Size (m) | Notes |
|---|---|---|---|
| Sword_Bronze | 1540 | 0.27×1.13×0.07 | Y-up; origin near the grip |
| Axe_Bronze | 826 | 0.29×0.83×0.05 | Bearded hand axe; origin mid-handle |
| Shield_Wooden | 1404 | 0.61 dia | Round, iron rim and boss; back at z=0, faces +Z |
| Torch_Metal | 970 | 0.22×0.65×0.39 | Wall plate at z=0, sticks out +Z; basket top at y≈+0.37 |
| Lantern_Wall | 2822 | 1.34 tall | Bracket with hanging chain and lantern |
| Barrel | 824 | 0.70×0.90 | |
| Crate_Wooden | 1576 | | |
| Crate_Metal | 2738 | | |
| Chest_Wood | 2546 | 1.28×0.72×0.76 | Skinned (joints Root, Chest_Bottom, Chest_Top); clips Chest_Open, Chest_Opened, Chest_Close, Chest_Closed |
| Cage_Small | 4588 | 0.85×0.81×0.88 | Has door ring and latch; animal size |
| Chain_Coil | 3744 | 1.07 dia | Lies flat on the floor |
| Table_Large | 986 | 2.85×0.81×1.10 | |
| Chair_1 | 496 | | |
| Stool | 152 | | |
| Bench | 404 | 2.78 long | |
| Bed_Twin1 / Bed_Twin2 | ~1.6k | 1.88×0.81×2.41 | |
| WeaponStand | 2084 | 1.39×1.11×0.98 | A-frame rack |
| Peg_Rack | 712 | | Wall pegs |
| Potion_1 / 2 / 4 | 440–536 | | Vertex-coloured glass; Potion_2 is red |
| Bottle_1, SmallBottle, SmallBottles_1, Shelf_Small_Bottles | | | |

Also in the kit: Key_Metal, Cauldron (0.99 m, usable as a brazier bowl), CandleStick_Stand (1.31 m), Candle_1/2, Chandelier, Mug, Table_Plate, Bag, Pouch_Large, Dummy, Banner_1/2(_Cloth), Anvil_Log, Whetstone, Workbench, Rope_1/2/3, Bucket_Wooden_1, Vase_Rubble_Medium, Coin_Pile, Scroll_1/2 and Book*.

#### Build gotchas
1. **COLOR_0 on `*_Vertex` materials is an intentional tint.** The sword blade is bronze (0.46,0.18,0.03), with a guard of (0.72,0.25,0.01) and a grip of (0.21,0.07,0.04). Retint the blade and guard to steel greys at build time. The axe head and shield metal work the same way.
2. **37 models also carry COLOR_0 on materials not named `_Vertex`** (Chair_1, Table_Large, Barrel, Bench, Shield_Wooden's furniture part, and others). glTF and Babylon always multiply base colour by COLOR_0. `T_Trim_Furniture_BaseColor` is already wood-brown, so values like (0.18,0.11,0.03) would come out near-black. Check this visually; the likely fix is to strip COLOR_0 from non-`_Vertex` materials, or to lerp it toward white.
3. Materials bind the ORM texture only as metallicRoughnessTexture. Add `occlusionTexture` pointing at the same image (R channel).
4. Merge the selected props into one kit GLB so the four trim sets are shared. Compress to 1024 KTX2 and instantiate by node name. Emitting one GLB per prop would duplicate the 2048² trims.
5. Mute the palette the way characters.mjs does (k≈0.8) to match the grey-brown northern look. The Standard tier has no worn texture variants (those are Pro only).

### Quaternius Stylized Nature MegaKit [Standard] (CC0, verified)
- `https://quaternius.itch.io/stylized-nature-megakit`, **upload id 11055123**: 104.1 MB.
- `glTF/Mushroom_Common.gltf` (880 tris, 0.56×0.46×0.78 cluster) and `glTF/Mushroom_Laetiporus.gltf` (3216 tris, orange bracket fungus). Both use `glTF/Mushrooms.png`, a 1024² atlas.
- Good cave dressing. Tint or add emissive for glowing mushrooms. The kit has no crystals.

The Medieval Village MegaKit (upload 12563480, 161 MB) is architecture: walls, doors, stairs, Prop_Wagon, Prop_Crate. No new props are needed from it.

### Poly Haven (all CC0; every slug below confirmed present in `/assets?t=models` and `/info/<slug>`)
Already shipped: `kite_shield`, `wooden_axe_03` (the headsman's axe, attached to `hand_r` in execution.ts), `wooden_barrels_01`, `wooden_crate_01`, `wooden_lantern_01`, `wooden_bucket_01/02`, `wicker_basket_01`.

New candidates, with 1k glTF download size including textures and triangle count:

**Weapons**
- `antique_estoc`: 2.5 MB, 8.2k tris. A 1.49 m cruciform thrusting sword with the blade along −Z; scale ×0.7 for a one-handed sword.
- `ornate_medieval_dagger`: 2.1 MB, 6.3k tris.
- `ornate_war_hammer`: 2.1 MB, 5.2k tris.
- `ornate_medieval_mace`: 2.8 MB, 14.8k tris.
- `wooden_axe`: 2.0 MB, 3.3k tris.
- `wooden_axe_02`: 2.2 MB, 2.2k tris. Both axes are rustic felling axes.
- `hatchet` is modern (rubber grip) and `wooden_handle_saber` is a pirate sabre; both reject.

**Fire**
- `stone_fire_pit`: 2.5 MB, 3.9k tris, 1.45 m stone ring, for a campfire or brazier.
- Poly Haven has no wall torch or brazier. `barrel_stove` (a modern oil drum) and `Lantern_01` (a hurricane lamp) don't fit.

**Containers**
- `wine_barrel_01`: 0.9 MB, 10.8k tris.
- `wooden_crate_02`: 2.2 MB, 5.2k tris; has stencilled "W E C" lettering.
- `treasure_chest`: 5.5 MB and **103k tris**. It has a separate `treasure_chest_lid` node, but needs heavy simplification.
- Reject `old_military_crate` and `wooden_military_crate` (army stencils), and `Barrel_01/02`, `barrel_03` (modern drums).

**Furniture**
- `wooden_table_02`: 0.5 MB, **196 tris**, rustic; a great fit.
- `WoodenTable_01`: 0.6 MB, 952 tris, 1.8 m bench-table.
- `wooden_stool_01`: 1.0 MB.
- `wooden_stool_02`: 2.7 MB, low rustic stool.
- `painted_wooden_bench`: 2.0 MB, 630 tris.
- `GothicBed_01`: 1.2 MB, 18.7k tris. The only bed that fits; ornate, so lord's quarters.
- `wooden_bookshelf_worn`: 2.8 MB, 10k tris.
- `wooden_candlestick`: **8.4 MB** at 1k, 3.3k tris.
- Reject: `old_bed_frame` (hospital), `vintage_day_bed`, `worn_metal_rack`, `katana_stand_01`, `wooden_display_shelves_01`.

**Tabletop**
- `ceramic_pot`: 1.6 MB.
- `brass_goblets`: 4.8 MB.
- `wooden_bowl_01`: 1.8 MB.
- `carved_wooden_plate`: 1.6 MB.
- `wicker_basket_02`: 3.1 MB.
- `wine_bottles_01` has modern labels; reject. Poly Haven has no potions.

**Bridge**
- `modular_wooden_pier`: 7.8 MB.
- Its `modular_wooden_pier_planks` node is a 2.52×2.20 m deck with 5.5k tris.
- `section_02` and `section_03` are 2.5×3.4 m decks on poles, 2.6 m high, with 11.8k–14.2k tris.
- The style matches the weathered world textures.

**Cave**
- `rock_07` and `rock_09` (have LODs), and `rock_face_02`: 3.5 MB.
- `single_root`: 3.8 MB, 114k tris, has LODs.
- `root_cluster_02`: 14 MB, **340k tris**.
- `dead_tree_trunk_02`, `tree_stump_02`.
- Poly Haven has nothing for chain, shackle, cage, lever, bridge, mushroom, crystal, armour, helmet or potion (tag and name search).

**How to fetch:** add slugs to `PH_MODELS` in `tools/sources.mjs` (at "1k"). The existing `fetch-sources.mjs` calls `https://api.polyhaven.com/files/<slug>`, reads `gltf['1k'].gltf.url` plus its `include` list, and writes the credits automatically. Then add an entry to the `PH` map in `tools/build-assets.mjs` with ratio, tex, segment and pos.

### KayKit, Kenney and OpenGameArt (fallbacks only)
**KayKit Dungeon Remastered 1.0** (CC0; LICENSE.txt checked)
- Raw self-contained GLBs with an embedded 1024 gradient atlas: `https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf/<name>.gltf.glb`. `torch_mounted` and `wall_gated` both returned HTTP 200.
- File listing: `https://data.jsdelivr.com/v1/packages/gh/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0@main?structure=flat` (203 models).
- Useful items: `torch_mounted`, `wall_gated` (4×4 m cell-bar wall), `keyring_hanging`, `bed_floor`, `bottle_*`, `chest`, `floor_tile_grate`, `floor_tile_big_spikes`.
- The flat toy style clashes with both our characters and our world.

**KayKit Adventurers** has `sword_1handed`, `axe_1handed`, `shield_round` and similar; same style problem.

**Kenney** (CC0)
- `platformer-kit` includes `lever.glb`.
- `castle-kit` includes `bridge-straight.glb`, `bridge-draw.glb` and `metal-gate.glb`.
- Flat cartoon style; not recommended.

**OpenGameArt CC0** (medieval cage, CageBed, simple 3d crystals, wooden bridge) ships only .blend or .obj, and the geometry is trivial. Building these procedurally is better.

### Research artefacts
All in /tmp/claude-0/research/:
- `itch_zipget.mjs`: ranged extraction of chosen entries from an itch zip, about 35 MB instead of 254 MB.
- `itch_zipls.mjs`: lists an itch zip's contents.
- `fpm_list.txt`: full contents of the props zip.
- `fpm/Exports/glTF/*.gltf`: all 98 glTF JSON files, plus .bin files for 16 of them.
- `render.mjs`, `renders_a.png`, `renders_b.png`: silhouette renders.
- `sheet1.png`, `sheet2.png`: Poly Haven thumbnail sheets.
- `std_crop.jpg`: Quaternius Standard overview.

## Recommendations
- One-handed sword: Quaternius FPM Sword_Bronze (1.13 m, 1540 tris, origin near the grip). Retint the vertex colours to steel at build time. Photoreal alternative: Poly Haven antique_estoc (1.49 m, scale x0.7, 8.2k tris, 2.5 MB at 1k). | https://quaternius.itch.io/fantasy-props-megakit (upload 13887750) / https://polyhaven.com/a/antique_estoc | CC0 1.0 (both) | verified=True | In fetch-extra.mjs: itch('https://quaternius.itch.io/fantasy-props-megakit', 13887750, TMP/fpm.zip), then unzip with /^Exports\/glTF\/(Sword_Bronze|...)\.(gltf|bin)$|^Exports\/glTF\/T_Trim_(Furniture|Metal|Props|Cloth)_(BaseColor|Normal|ORM)\.png$|^License_Standard\.txt$/ into assets-src/props/fpm. Poly Haven: add antique_estoc:'1k' to PH_MODELS.
- War axe: FPM Axe_Bronze (0.83 m bearded hand axe, 826 tris; retint the head to iron). Alternatives: PH wooden_axe (3.3k tris, 2.0 MB) or wooden_axe_02 (2.2k tris, 2.2 MB), or the already shipped wooden_axe_03. | Quaternius Fantasy Props MegaKit [Standard]; https://polyhaven.com/a/wooden_axe | CC0 1.0 | verified=True | Same FPM unzip (Axe_Bronze.gltf/.bin); PH via PH_MODELS {wooden_axe:'1k'}.
- Shield (round / kite): FPM Shield_Wooden (round, 0.61 m, iron rim and boss, 1404 tris, back at z=0 facing +Z) for soldiers. Keep the existing PH kite_shield for imperial set dressing. | Quaternius FPM; https://polyhaven.com/a/kite_shield (already in sources.mjs) | CC0 1.0 | verified=True | FPM unzip (Shield_Wooden); kite_shield is already fetched.
- Simple armour: No free wearable armour exists for the 65-joint skeleton (the outfits Standard zip has Peasant + Ranger only; Knight etc. are paid). Reuse the merged Ranger parts outfit_ranger_Acc_Pauldron, outfit_ranger_Arms_Bracer, outfit_ranger_Body_Belt_1, outfit_ranger_Head_Hood and outfit_ranger_Feet_Boots, tinted per faction. Use FPM Dummy (1.86 m) as an armour stand. | assets-src/chars/outfits (Quaternius Modular Character Outfits Fantasy, upload 16289385); FPM Dummy | CC0 1.0 | verified=True | Already in assets-src/chars/outfits; Dummy via FPM unzip.
- Wall torches / braziers: FPM Torch_Metal (wall-mounted basket torch, 970 tris, wall plate at z=0, flame at y≈+0.37) plus the existing fx fire sprites. FPM Lantern_Wall (bracket, chain and lantern). For braziers: PH stone_fire_pit (1.45 m ring, 3.9k tris, 2.5 MB) or FPM Cauldron as the fire bowl; FPM CandleStick_Stand (1.31 m) for interiors. | Quaternius FPM; https://polyhaven.com/a/stone_fire_pit | CC0 1.0 | verified=True | FPM unzip (Torch_Metal, Lantern_Wall, Cauldron, CandleStick_Stand); PH_MODELS {stone_fire_pit:'1k'}.
- Barrels: FPM Barrel (824 tris) for interiors. Already shipped PH wooden_barrels_01; PH wine_barrel_01 (10.8k tris, 0.9 MB) as a photoreal single barrel. | Quaternius FPM; https://polyhaven.com/a/wine_barrel_01 | CC0 1.0 | verified=True | FPM unzip (Barrel); PH_MODELS {wine_barrel_01:'1k'}.
- Crates: FPM Crate_Wooden (1576 tris) and Crate_Metal (2738). PH wooden_crate_01 is already shipped; PH wooden_crate_02 (5.2k tris, has 'W E C' stencil) is optional. | Quaternius FPM; https://polyhaven.com/a/wooden_crate_02 | CC0 1.0 | verified=True | FPM unzip; PH_MODELS {wooden_crate_02:'1k'}.
- Chests (lootable): FPM Chest_Wood (2546 tris, skinned Root/Chest_Bottom/Chest_Top, clips Chest_Open/Chest_Opened/Chest_Close/Chest_Closed), ideal for an open interaction. Photoreal alternative: PH treasure_chest (separate lid node, but 103k tris and 5.5 MB, needs about 0.05 simplify). | Quaternius FPM; https://polyhaven.com/a/treasure_chest | CC0 1.0 | verified=True | FPM unzip (Chest_Wood); PH_MODELS {treasure_chest:'1k'} if wanted.
- Chains / shackles: FPM Chain_Coil (floor coil, 3744 tris) and the chain inside Lantern_Wall for dressing. Hanging chains and wall shackles should be procedural: instanced torus links plus a ring cuff, using the existing PH rusty_metal_02 texture. Add a torus() helper to tools/gen/shapes.mjs. | Quaternius FPM + procedural (tools/gen) | CC0 1.0 / own code | verified=True | FPM unzip (Chain_Coil, Lantern_Wall); procedural generation in tools/gen.
- Iron cage: FPM Cage_Small (0.85×0.81×0.88 m, has a door ring and latch, 4588 tris, no vertex colours). Scale about x2.3 for a prisoner cage (bars thicken proportionally), or build bars procedurally with cylinder() and rusty_metal_02. Fallback: KayKit wall_gated (4×4 m cell-bar wall), style mismatch. | Quaternius FPM; KayKit Dungeon Remastered (raw.githubusercontent) | CC0 1.0 | verified=True | FPM unzip (Cage_Small); KayKit https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf/wall_gated.gltf.glb
- Table: FPM Table_Large (2.85 m feast table, 986 tris) for the keep hall. PH wooden_table_02 (196 tris, 0.5 MB, rustic) or WoodenTable_01 (1.8 m, 952 tris) for photoreal rooms. | Quaternius FPM; https://polyhaven.com/a/wooden_table_02, https://polyhaven.com/a/WoodenTable_01 | CC0 1.0 | verified=True | FPM unzip; PH_MODELS {wooden_table_02:'1k', WoodenTable_01:'1k'}.
- Chair / stool / bench: FPM Chair_1 (496 tris), Stool (152) and Bench (404, 2.78 m). PH wooden_stool_02 (low rustic stool), wooden_stool_01 and painted_wooden_bench (630 tris). | Quaternius FPM; Poly Haven | CC0 1.0 | verified=True | FPM unzip; PH_MODELS {wooden_stool_02:'1k', painted_wooden_bench:'1k'}.
- Bed: FPM Bed_Twin1 / Bed_Twin2 (about 1.6k tris, 1.88×2.41 m). For a lord's room: PH GothicBed_01 (18.7k tris, 1.2 MB, ornate). Reject PH old_bed_frame and vintage_day_bed (modern). | Quaternius FPM; https://polyhaven.com/a/GothicBed_01 | CC0 1.0 | verified=True | FPM unzip; PH_MODELS {GothicBed_01:'1k'}.
- Weapon rack: FPM WeaponStand (A-frame rack, 1.39×1.11×0.98 m, 2084 tris, no vertex colours) and Peg_Rack (wall pegs). Populate them with Sword/Axe/Shield instances. | Quaternius FPM | CC0 1.0 | verified=True | FPM unzip (WeaponStand, Peg_Rack).
- Potions / bottles: FPM Potion_1, Potion_2 (red, healing), Potion_4, Bottle_1, SmallBottle, SmallBottles_1 and Shelf_Small_Bottles (vertex-coloured glass, about 130–540 tris each). Poly Haven has no fitting bottles (wine_bottles_01 has modern labels). | Quaternius FPM | CC0 1.0 | verified=True | FPM unzip.
- Cave mushrooms: Quaternius Stylized Nature MegaKit Mushroom_Common (880 tris) and Mushroom_Laetiporus (3216 tris, orange bracket fungus), sharing a 1024² Mushrooms.png atlas. Tint or add emissive for glowing mushrooms. | https://quaternius.itch.io/stylized-nature-megakit (upload 11055123) | CC0 1.0 | verified=True | itch('https://quaternius.itch.io/stylized-nature-megakit', 11055123, TMP/snm.zip); unzip /^glTF\/(Mushroom_Common|Mushroom_Laetiporus)\.(gltf|bin)$|^glTF\/Mushrooms\.png$|^License_Standard\.txt$/ into assets-src/props/nature.
- Cave crystals: Procedural: tapered hexagonal prisms (cylinder() with sides:6 and radius2 for the taper, plus a tip) in clusters, with an emissive or refractive material and a point light. No free glTF source fits; OGA CC0 crystals are .blend only and no Blender is available. | Procedural (tools/gen/shapes.mjs) | own code | verified=True | Generate in tools/gen.
- Cave rocks / roots: PH rock_07 and rock_09 (have LODs), rock_face_02 and single_root (has LODs). root_cluster_02 is 340k tris, so simplify it hard or skip it. | Poly Haven | CC0 1.0 | verified=True | PH_MODELS {rock_07:'1k', rock_09:'1k', rock_face_02:'1k', single_root:'1k'}.
- Wooden bridge: PH modular_wooden_pier (7.8 MB at 1k). Use its 'modular_wooden_pier_planks' node (2.52×2.20 m deck, 5.5k tris) or section_02/03 (2.5×3.4 m deck on 2.6 m poles, about 12–14k tris) for a stream crossing. For a rope bridge over a gorge, build it procedurally from boxes with the old_planks_02 / rough_wood textures plus rope cylinders. | https://polyhaven.com/a/modular_wooden_pier | CC0 1.0 | verified=True | PH_MODELS {modular_wooden_pier:'1k'}; select the nodes in build-assets.
- Lever: Procedural: a box base plate, a cylinder handle and a knob, using rusty_metal_02 and medieval_wood. Animate the handle's rotation. Kenney platformer-kit lever.glb exists (CC0) but is a cartoon style mismatch. | Procedural; fallback https://kenney.nl/assets/platformer-kit | own code / CC0 | verified=True | Generate in tools/gen.
- Tabletop / room dressing (optional): FPM Mug, Table_Plate, Candle_1/2, Key_Metal, Bag, Pouch_Large, Scroll_1 and Book_* (all tiny). PH ceramic_pot, wooden_bowl_01, carved_wooden_plate, brass_goblets, wicker_basket_02, wooden_bookshelf_worn and wooden_candlestick (8.4 MB at 1k). | Quaternius FPM; Poly Haven | CC0 1.0 | verified=True | FPM unzip; PH_MODELS entries.

## Risks
- Style mix: the Quaternius props are stylised hand-painted PBR, while the world (terrain, keep, fort, rocks) uses photoreal Poly Haven textures. Mute the props' baseColor as characters.mjs does (k≈0.8) and keep each room to one source family.
- 37 FPM models carry COLOR_0 on materials not named *_Vertex (Chair_1, Table_Large, Barrel, Bench, Shield_Wooden's furniture part, etc.). Babylon/glTF multiplies base colour by it, and the furniture trim is already wood-coloured, so some parts will render near-black. Check visually and strip COLOR_0 (or lerp it to white) on non-_Vertex materials at build time.
- Sword_Bronze and Axe_Bronze are bronze through vertex colours (0.46,0.18,0.03 and 0.72,0.25,0.01). They need a build-time retint to read as iron or steel.
- FPM materials bind ORM only as metallicRoughnessTexture, not occlusion. Add an occlusionTexture, or accept flatter shading.
- If each FPM prop is emitted as its own GLB, the four shared 2048² trim sets (about 31 MB PNG) are duplicated in every file. Merge the props into one kit GLB at 1024 KTX2.
- The itch.io signed-URL flow (csrf POST /file/<upload_id>) could change or be rate-limited. The zips are large: FPM 150 MB and Stylized Nature 104 MB per fresh fetch. Ranged extraction (prototype in /tmp/claude-0/research/itch_zipget.mjs) cuts this to about 35 MB.
- No free wearable armour exists for the 65-joint Quaternius skeleton (Knight etc. are paid tiers). Armour must come from tinted Ranger parts or rigid props parented to bones.
- Several gaps have no suitable free glTF and must be generated procedurally: lever, hanging chains/shackles, prisoner-size cage, crystals and rope bridge. shapes.mjs has no torus helper yet.
- Cage_Small is animal-sized (0.85 m). Scaling it to person size makes the bars thick and cartoonish.
- Heavy Poly Haven candidates need aggressive simplification or should be skipped: treasure_chest (103k tris), root_cluster_02 (340k), single_root (114k, has LODs), wooden_candlestick (8.4 MB at 1k), and modular_wooden_pier sections (11–23k tris each, 7.8 MB).
- PH antique_estoc is 1.49 m with its blade along −Z, so it needs about x0.7 scale and a re-orientation for the hand_r attach (the existing axe attach uses a different axis convention).
- KayKit and Kenney fallbacks (wall_gated, torch_mounted, lever.glb, bridge-straight.glb) are CC0 but have a flat toy style that clashes with both the characters and the world.