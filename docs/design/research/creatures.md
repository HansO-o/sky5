## Summary
I checked every candidate from this container: I downloaded each file, recorded HTTP status and size, inspected the glb/FBX/.blend contents, and rendered the creatures next to the Quaternius base character in headless Blender.

**Recommended set:**
- **Giant spiders:** Quaternius "Easy Enemy Pack" Spider (CC0). It's FBX only, but converts cleanly in Node with `assimpjs`.
- **Bear:** 0 A.D. brown bear (CC BY-SA 3.0, Wildfire Games). It comes from the same mirror and licence as the horse already in the game.
- **Wolf:** the 0 A.D. wolf (same mirror and licence) is the large-wolf alternative or extra enemy; CoinCoin's wolf (CC BY 4.0) is the fallback if share-alike is a problem.

**Hosts that don't work from this container (checked):**
- **Google Drive** returns a "Quota exceeded" HTML page (HTTP 200, 2009 bytes) for every file, including a tiny License.txt. That rules out all Quaternius packs hosted on Drive: Ultimate Animated Animals (which has a CC0 glTF wolf), Ultimate Monsters and Animated Monster.
- **Poly Pizza:** the site is behind a Cloudflare challenge (403) and the API needs a key (401).
- **Sketchfab** was excluded, as instructed.
- **GitHub API** (gh and api.github.com) is blocked by the proxy, but raw.githubusercontent.com works.
- **itch.io, opengameart.org, download.blender.org, registry.npmjs.org** all work.

Research files are in `/tmp/claude-0/research/`.
- **Renders:** `r_combat.png`, `r_rest.png`, `r_poses.png`, `r_spiders.png`, `r_conv.png`, `r_wolves.png`
- **Prototype scripts:** `merge.mjs` (clip merge by node name), `fixq.mjs`, `inspect.mjs`, `cmpskin.mjs`, `conv/assimp.mjs`, `conv/fbx2glb.mjs`, `fbx_blender.py`, `blend2glb.py`, `itchls.mjs` (finds itch upload IDs via the `download_url` flow), `itchget.mjs`

## 1. Giant spider, primary: Quaternius "Easy Enemy Pack" (Jan 2019), Spider. CC0
**Licence**
- https://quaternius.com/packs/easyenemy.html shows "License CC0" and links creativecommons.org/publicdomain/zero/1.0.
- The itch page says "FBX, OBJ and Blend formats and CC0 license".
- The zip has no licence file, so write one by hand.

**Download (works)**
- The existing `itch()` helper works: `itch("https://quaternius.itch.io/animated-easy-enemies", 1254673, dest)`.
- I found the upload ID through the `POST /download_url` then download-page flow.
- Result: HTTP 200, `application/x-zip-compressed`, 3,093,543 bytes.
- The spider is `Easy Animated Enemy Pack - Jan 2019/FBX/Spider.fbx` (1,233,452 B). There are also `Spider.blend` and `OBJ/Spider.obj`.
- Same pack and licence: Rat, Wasp, Snake and Frog, which could be extra cave enemies.

**Model**
- 2,712 tris, one skinned mesh, 59 bones (IK and pole targets included; the skin uses 39 joints).
- Two flat materials, no textures: black body (#0d0d0d) and dark-red eyes (#5e0606).

**Clips** (names in the FBX are `HumanArmature|Spider_*`):

| Clip | Length |
|---|---|
| Spider_Idle | 4.17 s |
| Spider_Walk | 0.83 s |
| Spider_Attack | 0.75 s |
| Spider_Death | 1.04 s (flips onto its back) |
| Spider_Jump | 0.71 s |

**Conversion (verified)**
- `assimpjs` (npm, MIT, WASM) converts FBX to glb in Node. Raw output is 1.09 MB; after dedup, weld, resample and meshopt it's about 238 KB.
- three.js `FBXLoader` + `GLTFExporter` and Blender 4.2 FBX import give the same skinned result (`r_conv.png`), so Blender isn't required.
- Build fixes needed:
  - Strip the `HumanArmature|` prefix from clip names.
  - Drop the `FB_ngon_encoding` extension.
  - The FBX is in centimetres, so the armature and mesh nodes carry a ×100 root scale. Normalise it; the raw leg span is about 5.9 m, so scale to about 2.4–2.8 m for a "giant" spider.
  - Force materials to `OPAQUE` with alpha 1. The FBX materials have alpha 0, so the three.js and Blender outputs render invisible; assimp's output was already opaque.
- The head faces glTF +Z, matching the project convention.

**Style:** flat-shaded low-poly, the same family as the Quaternius characters (`r_spiders.png`). For 2–3 spiders, clone with skeletons via `instantiateModelsToScene` and vary the body colour (black, brown, pale cave spider).

## 2. Spider fallback: OpenGameArt "Spider (3D)" by GuieA_7. CC BY-SA 4.0
- **Page:** https://opengameart.org/content/spider-3d (licence block on the page reads CC-BY-SA 4.0).
- **Download:** https://opengameart.org/sites/default/files/spider.zip returns 200, 1,797,796 B. It contains `spider.blend` (Blender 2.76), `spider.png` (512², painted), `spider.xcf` and `spider_noIK.blend`.
- **Model:** 758 tris, 39 bones.
- **Clips** (after Blender export):

| Clip | Length |
|---|---|
| idle | 1.28 s |
| walk | 0.64 s |
| attack | 1.88 s |
| die | 0.92 s |
| fallasleep | 1.24 s |
| sleep | 4.0 s |
| wakeup | 0.92 s |
| neutral | single frame |

- **Conversion:** needs Blender. I verified Blender 4.2.23 LTS (`download.blender.org/release/Blender4.2/blender-4.2.23-linux-x64.tar.xz`, 350,707,672 B) running headless with `export_scene.gltf(export_animation_mode="ACTIONS", export_force_sampling=True)`, which bakes the IK. The texture isn't linked in the old material, so assign `spider.png` in the build, as the horse build does. About 285 KB after meshopt, plus the texture.
- **Style:** gritty painted texture, closer to the 0 A.D. look than to Quaternius.
- **Rejected spiders:**
  - br-n518 "Spider" (CC0): 222 tris, IDLE/WALK/ATTACK only, no death.
  - Glest spider: CC-BY-SA 3.0 / GPL.
  - downraindc3d and fariszwp itch spiders: paid, proprietary licences.

## 3. Bear, primary: 0 A.D. brown bear (Wildfire Games). CC BY-SA 3.0
**Licence:** same as the horse. `assets-src/horse/LICENSE-0ad-art.txt` already holds the text. The mirror's README says derived art is CC-BY-SA 3.0; the mirror has no LICENSE file of its own (404).

**Download:** base URL `https://raw.githubusercontent.com/PhantomMatthew/ZeroAD-Godot/main/godot/assets`. Every file below returned 200.

| File | Size | Duration | Notes |
|---|---|---|---|
| `meshes/skeletal/bear.glb` | 192,440 B | – | 2,530 tris, 75 joints, material `Ursidae_Grizzly` |
| `animations/quadraped/bear_idle_01.glb` | 175,008 B | 2.0 s | |
| `bear_idle_02.glb` | 185,756 B | 2.63 s | |
| `bear_idle_03.glb` | 364,388 B | 8.66 s | sits down, sits, stands up; **not** a lie-down |
| `bear_idle_04.glb` | 186,640 B | about 2.7 s | |
| `bear_attack_01.glb` | 170,060 B | 1.0 s | |
| `bear_attack_02.glb` | 203,096 B | 2.0 s | |
| `bear_attack_03.glb` | 170,432 B | 1.0 s | |
| `bear_walk.glb` | 183,848 B | 1.29 s | |
| `bear_run.glb` | 178,480 B | 1.0 s | |
| `bear_death_01.glb` | 207,148 B | 1.67 s | |

Textures (512² RGBA) come from `https://raw.githubusercontent.com/0ad/0ad/master/binaries/data/mods/public/art/textures/skins/skeletal/`: `animal_bear_brown.png` (601,899 B) and `animal_bear_black.png` (485,673 B).

**Integration findings (verified)**
- **Use bear.glb for the mesh.** Each clip glb embeds only half the mesh (1,235 tris). bear.glb's inverse bind matrices and rest translations match the walk, idle, attack and run clips exactly (Δ = 0; rotations differ only by q/−q), so channels copy straight across by node name.
- **Re-base clip times to 0.** The clips sit on a shared timeline: idle_02 starts at 2.0 s, attack_02 at 1.0 s, attack_03 at 3.0 s, idle_03 at 4.63 s, idle_04 at 13.29 s.
- **The death clip needs special handling.** It was exported from the polar-bear variant, with different inverse bind matrices and 11 extra `prop*` bones. Copy only rotation channels plus root/pelvis translation, and drop `prop*`. That renders correctly: the bear ends curled on its side.
- **Sleeping and waking have to be faked; there's no sleep clip.**
  - Sleep: hold the Death end pose and add procedural breathing (oscillate the spine bones).
  - Wake: play Death reversed, then attack_02 (2 s) as the roar.
- **Scale:** the bear is 3.09 × 5.1 in 0 A.D. units. Scale by about 0.45 to get a 2.3 m body length. It faces glTF +Z.
- **Size:** about 650 KB after meshopt without the texture; drop idle_02 and idle_04 to cut it.
- **Merging advice:** don't slice sub-ranges by dropping keys. That loses constant channels: in my prototype, slicing kept only 70 of 228 channels. Either resample boundary keys or play sub-ranges with `AnimationGroup.start(loop, speed, from, to)`.
- **Upstream fallback** if the mirror disappears: `.../art/meshes/skeletal/bear.dae` (708,178 B, 200) and `.../art/animation/quadraped/bear_*.dae` (200), converted with assimpjs or Blender.
- **No CC0 or CC-BY animated bear exists among the sources checked.** Mathilde_Lea's "Low Poly Bear" (CC-BY 4.0) has no rig, and STKRudy85's "White Bear" (CC0) has no rig.

## 4. Large wolf (alternative to the bear, or 2–3 pack enemies)
### Primary: 0 A.D. wolf. CC BY-SA 3.0
- **Files:** same mirror, all 200:

| Clip | Size | Duration | Notes |
|---|---|---|---|
| `wolf_walk.glb` | 96,652 B | 1.96 s | |
| `wolf_run.glb` | 80,536 B | 0.79 s | |
| `wolf_attack_01.glb` | 107,040 B | 2.17 s | |
| `wolf_attack_02.glb` | 108,468 B | 2.17 s | |
| `wolf_idle_01.glb` | 301,592 B | 11.25 s | belly-down lying rest from 0.9–7.3 s: use as the sleep segment |
| `wolf_idle_02.glb` | 194,804 B | 5.96 s | |
| `wolf_idle_03.glb` | 246,544 B | 9.21 s | sits |
| `wolf_death_01.glb` | 84,584 B | 0.92 s | |
| `wolf_death_02.glb` | 78,676 B | 0.67 s | |

- **Textures:** `animal_wolf.png` and `animal_wolf_grey.png`, both 256², 171 KB and 167 KB.
- **Use a clip glb as the base, not wolf.glb.** wolf.glb has different inverse bind matrices, `Bone.005` vs `Bone_005` naming and no 0.6 root scale. All nine clip glbs share an identical 32-joint skeleton, and each holds the full 696-tri mesh with no material.
- **Size:** about 490 KB after meshopt without the texture.

### CC-BY fallback: OpenGameArt "[Animated] Wolf" by CoinCoin. CC BY 4.0
- **Download:** https://opengameart.org/sites/default/files/low-poly-wolf.zip returns 200, 3,096,809 B. It contains `source/loup.fbx` and `textures/wolf_Tex.png` (256²).
- **Model:** 1,334 tris, 32 bones.
- **Clips:**

| Clip | Length |
|---|---|
| idle | 1.28 s |
| run | 0.60 s |
| hit | 1.20 s |
| death | 0.87 s |
| ATK1 | 2.67 s (rears up) |
| ATK2 | 1.88 s |
| rotation | 0.62 s |

- No walk or sleep clips.
- **Conversion:** use assimpjs; it keeps the clip names. Blender's FBX import collapses them all into "Baked frames". About 374 KB after meshopt.
- **Style:** a hand-painted teal "dire wolf", good as a fantasy cave beast.

## Other sources checked and rejected
- **Quaternius Ultimate Animated Animal Pack (CC0):** has a glTF Wolf (Drive file id `1lFQoQ9ln2Z2wGuFFWObj9i5jHqUl_ftG`) with attack, death and more, but Drive is blocked. Also no bear.
- **Quaternius Animal Pack Vol.2 (CC0)**, available on OpenGameArt at `Animal%20Pack%20Vol.2%20by%20%40Quaternius.zip` (2.07 MB): the wolf has only Idle and Walking.
- **Quaternius Ultimate Monsters (CC0):** Drive only, chibi style, no spider (only Big, Blob and Flying sets).
- **Quaternius Bestiary – Dungeon Monsters Kit:** under QAL (commercial OK, no credit needed, but no redistribution of the assets as assets), 45 MB, humanoid goblins, skeletons and demons.
- **Gobkit (CC0, direct glb URLs listed in the open manifest `https://gobkit.com/api/free`):** AI-generated ("AI game-ready 3D monster generator"), and no spider, bear or wolf. It does have Bat, Rat and Boar.
- **KayKit:** no creature packs.
- **Kenney:** no rigged animals.

## Credits entries to add to `tools/credits-extra.mjs`
- **quaternius-easy-enemies** (model): "Easy Enemy Pack (Spider)", Quaternius, CC0 1.0, https://quaternius.com/packs/easyenemy.html
- **0ad-bear** (model): "Bear model, textures and animations (0 A.D.)", Wildfire Games, CC BY-SA 3.0, https://play0ad.com, note: converted to glTF via ZeroAD-Godot
- **0ad-wolf**, if used: same format as 0ad-bear.
- **Fallbacks:**
  - GuieA_7, "Spider (3D)", CC BY-SA 4.0, https://opengameart.org/content/spider-3d
  - CoinCoin, "[Animated] Wolf", CC BY 4.0, https://opengameart.org/content/animated-wolf

## Recommendations
- Giant spider x2-3 (walk/attack/death): Quaternius Easy Enemy Pack – Spider (2712 tris, 59 bones, flat black + red-eye materials; clips Spider_Idle 4.17s, Spider_Walk 0.83s, Spider_Attack 0.75s, Spider_Death 1.04s, Spider_Jump 0.71s) | https://quaternius.itch.io/animated-easy-enemies (license page https://quaternius.com/packs/easyenemy.html) | CC0 1.0 | verified=True | Existing itch() csrf helper: itch('https://quaternius.itch.io/animated-easy-enemies', 1254673, tmp/easy_enemies.zip) -> 200, 3,093,543 B zip; extract 'Easy Animated Enemy Pack - Jan 2019/FBX/Spider.fbx' (1,233,452 B). Convert FBX->glb in Node with npm 'assimpjs' (MIT, WASM): verified ok, 1.09 MB raw / ~238 KB after weld+resample+meshopt. Build fixes: strip 'HumanArmature|' clip prefix, drop FB_ngon_encoding, normalize x100 (cm) root scale to ~2.6 m leg span, force materials OPAQUE alpha=1. No license file in zip -> write LICENSE note.
- Giant spider fallback (with sleep clips): OpenGameArt 'Spider (3D)' by GuieA_7 (758 tris, 39 bones, 512² painted texture; idle, walk, attack, die, fallasleep, sleep, wakeup, neutral) | https://opengameart.org/content/spider-3d | CC BY-SA 4.0 | verified=True | GET https://opengameart.org/sites/default/files/spider.zip -> 200, 1,797,796 B (spider.blend v2.76 + spider.png). Needs headless Blender (verified blender-4.2.23-linux-x64.tar.xz from download.blender.org, 350,707,672 B): export_scene.gltf(export_animation_mode='ACTIONS', export_force_sampling=True) bakes IK; assign spider.png as base color in build.
- Bear (idle/attack/death + sleeping): 0 A.D. brown bear (2530 tris, 75 joints; idle_01..04, walk, run, attack_01..03, death_01). No sleep clip: hold death end-pose (curled on side) + procedural breathing; wake = death reversed then attack_02 | https://raw.githubusercontent.com/PhantomMatthew/ZeroAD-Godot/main/godot/assets (mirror of 0ad/0ad art; same source as the existing horse) | CC BY-SA 3.0 (Wildfire Games) | verified=True | download() from raw.githubusercontent.com: meshes/skeletal/bear.glb (192,440 B) + animations/quadraped/bear_{idle_01,idle_02,idle_03,idle_04,walk,run,attack_01,attack_02,attack_03,death_01}.glb (170-364 KB each, all 200) + texture https://raw.githubusercontent.com/0ad/0ad/master/binaries/data/mods/public/art/textures/skins/skeletal/animal_bear_brown.png (601,899 B). Merge: copy channels by node name onto bear.glb (IBMs identical), rebase clip times to 0; death_01 from polar skeleton -> rotation channels + root/pelvis translation only, drop prop_*. Scale ~0.45. Upstream .dae fallback in 0ad/0ad art/meshes/skeletal/bear.dae + art/animation/quadraped/.
- Large wolf (alternative to bear / pack enemies; sleeping/idle/attack/death): 0 A.D. wolf (696 tris, 32 joints; walk, run, attack_01/02, idle_01 with belly-down lying rest 0.9-7.3 s, idle_02, idle_03 sit, death_01/02) | https://raw.githubusercontent.com/PhantomMatthew/ZeroAD-Godot/main/godot/assets/animations/quadraped/ | CC BY-SA 3.0 (Wildfire Games) | verified=True | download wolf_{walk,run,attack_01,attack_02,idle_01,idle_02,idle_03,death_01,death_02}.glb (78-302 KB each, all 200); use a clip glb as base (NOT meshes/skeletal/wolf.glb: different IBMs/bone naming); add material with animal_wolf_grey.png (256², 166,922 B) from 0ad/0ad textures/skins/skeletal/.
- Wolf fallback without share-alike: OpenGameArt '[Animated] Wolf' by CoinCoin (1334 tris, 32 bones, stylized dire-wolf; idle, run, hit, death, ATK1, ATK2, rotation – no walk/sleep) | https://opengameart.org/content/animated-wolf | CC BY 4.0 | verified=True | GET https://opengameart.org/sites/default/files/low-poly-wolf.zip -> 200, 3,096,809 B (source/loup.fbx + textures/wolf_Tex.png 256²); convert with assimpjs (keeps take names; Blender FBX import collapses them to 'Baked frames'); ~374 KB after meshopt.

## Risks
- The 0 A.D. bear and wolf (and the GuieA_7 spider fallback) are CC BY-SA: the converted asset files must stay CC BY-SA and be credited. The horse already sets this precedent. No CC0 or CC-BY animated bear was found anywhere reachable; the CoinCoin wolf (CC BY 4.0) is the only non-share-alike large-quadruped option.
- Neither the bear nor the Quaternius spider has a real sleep clip. The bear needs a faked sleep (hold the death end-pose plus procedural breathing; wake = death played reversed). bear_idle_03 is a sit, not a lie-down, despite its low pelvis height.
- Google Drive returns 'Quota exceeded' for every file from this container. Any Quaternius pack hosted only on Drive (Ultimate Animated Animals wolf, Ultimate Monsters) is unusable for a reproducible fetch. Poly Pizza is behind Cloudflare (403) and its API needs a key (401).
- ZeroAD-Godot is a third-party GitHub mirror with no LICENSE file (only README text). If it disappears, fall back to the upstream 0ad/0ad .dae files (verified 200), which then need assimpjs or Blender conversion.
- The Quaternius Easy Enemies zip has no license file (CC0 is stated only on quaternius.com and itch). Record it manually. The itch upload ID 1254673 and the csrf flow could change.
- FBX conversion adds a build dependency (npm assimpjs, or three.js). Alternatively, convert once and commit the glb to assets-src. The converted spider needs fixes: strip the 'HumanArmature|' clip prefix, normalise the x100 cm root scale, force materials OPAQUE with alpha 1 (FBX alpha is 0), and drop the FB_ngon_encoding extension.
- 0 A.D. clips sit on a shared timeline (for example attack_02 starts at 1.0 s and idle_03 at 4.63 s) and must be re-based. Slicing sub-ranges by dropping keys loses constant channels; resample instead, or use Babylon AnimationGroup from/to.
- The bear death clip comes from the polar-bear skeleton variant (different inverse bind matrices, extra prop bones). Transferring only rotation channels plus root/pelvis translation looked correct in Blender but should be checked in Babylon. Each bear clip glb contains only half the mesh, so always use bear.glb for the mesh.
- Prototype merge.mjs with plain prune() stripped TEXCOORD_0 before the texture was bound (bear rendered black). Bind textures before prune, or use prune({keepAttributes:true}), as the existing horse build does.
- Style mix: the Quaternius spider is flat-coloured low-poly while the 0 A.D. bear and wolf use painted textures, similar to the horse already in the game. Lighting will matter in a dark cave. Gobkit alternatives are AI-generated and were rejected.