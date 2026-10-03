## Audio sources for the keep and cave chapters (all checked live, 2026-10-03)

**How it was checked.** For each Freesound id I fetched `https://freesound.org/s/{id}/` and read four things:
- the licence link on the page (only `creativecommons.org/publicdomain/zero/1.0` was accepted);
- the duration (`data-duration`);
- the user id (`uid`), taken from the page's own preview URL;
- the uploader's description and tags.

I then sent a HEAD request to `https://cdn.freesound.org/previews/{floor(id/1000)}/{id}_{uid}-hq.ogg`. **All 99 primary picks are CC0 and return 200.** Their previews total 23.3 MB.

I downloaded 108 previews to `/tmp/claude-0/research/fs/`. They already use the project's file names (`fs_{id}_{uid}-hq.ogg`), so they can be copied into `assets-src/audio` instead of downloading again. I also ran the exact `audio.mjs` ffmpeg chain on them.

Inputs for the next step are in the scratchpad (`/tmp/claude-0/-home-user/723fb141-388f-585a-9830-e42e4105f74b/scratchpad/`):
- `primary.tsv`: per sound, id, uid, user, duration, licence, HTTP status, bytes, title.
- `snippet.txt`: a ready `FS` array plus one `EXTRA_CREDITS` line per sound.

**Format in the tables below:** `id/uid` user "title" duration (channels of the HQ preview) — notes.

### Combat
| Need | Primary | Alternates |
|---|---|---|
| Sword swing | 840716/18136826, 840717/18136826, 840715/18136826 Nomagician "Sword Swing 1/3/2", 0.76 s each (made from wilhellboy 351367, which is also CC0) | 733890/6703998 velcronator "Whoosh 03" 0.99 s; 507466/2977885 Danjocross 0.92 s |
| Heavy or axe swing | 367182/5065048 GaussTheWizard "swing.mp3" 0.70 s (deep foam-sword whoosh, tagged axe) | 733890 |
| Sword on flesh | 547042, 547036, 547035 (uid 7614679) CogFireStudios "Hit Impact Sword 3/2/1", 1.2–1.3 s (tagged cut-flesh, gore) | 411122/1424100 vdovitsky "Sword hits the body" 1.67 s; 574821/10771194 Wenpire "Slash1" 1.05 s |
| Axe on flesh | 522091/11537497 magnuswaker "Pound of Flesh 1" 0.62 s and 779805/15956618 modusmogulus "Meaty Damage Impact" 0.74 s, layered with 452554/612689 kyles "axe chop into wood" 0.60 s | 641046/11537497 "Gore Impact" 1.15 s |
| Hit on a shield | 636102/11705708 fonografico "SHIELDHIT2" 1.10 s; 372877/6944346 Hakren "Iron-Wood Slam" 1.66 s (metal on a wood plank, suits a wooden shield with an iron boss); 783059/16503936 hushless "Sword Hitting Wood" 0.21 s | 182112/3371145 "Shield / sword hits" 7.9 s, multi-take |
| Block or parry | 616493, 616495, 616494 (uid 702542) Empiremonkey "block3/1/2", 0.6–0.93 s mono; 326867/4077311 JohnBuhr "Sword_Clash (9)" 1.51 s; 442769/71257 qubodup "Sword Hit" 0.76 s (a mix of other CC0 sounds) | OGA StarNinjas "20 Sword SFX" (CC0) `https://opengameart.org/sites/default/files/sword_clash_-_starninjas_0.zip` (144,575 B, 10 ogg files) |
| Sword draw (extra) | 577619/13023338 paulfabb "Sword Drawing 1" 2.0 s | 770035/13973196 Vrymaa "Sword - Unsheathe" 1.88 s |
| Footsteps on stone | Wdomino (uid 5026978) "Footsteps Stone" one-shots: 517122, 517121, 517125, 517137, 517136, 517135, 517134, 517117, 517124, 517123 (0.44–0.72 s, mono). Drop 517126: it is nearly silent (peak −39 dB). | Armoured NPCs: Ali_6868 (uid 984733) chainmail-on-gravel steps 384881, 384882, 384887 (0.5 s). Walking sequences: 521590/9395330 Fission9 3.55 s; 813622/16752880 6.71 s |
| Body fall | 504626/4437257 leonelmail "BODY FALL - V HVY - DIRT" 1.63 s; 325270 and 325269 (uid 2104797, account deleted) "Body fall 1/2", content at 0.54–1.15 s and 0.48–0.86 s | 734629/13973196 Vrymaa, six takes; the best is 0–1.77 s |
| Male pain grunts | MrFossy (uid 129727) PainGrunts 547203, 547202, 547201, 547200, 547207, 547206 (0.25–0.33 s) | 464486/4814007 0.57 s; 413177/8090574 micahlg 0.46 s |
| Male death cries | MrFossy 547182, 547181, 547189 (1.08–1.35 s) | 610998/1038806 unfa, 24 s series |
| Male attack shouts | 474651/9250976 Nox_Sound "Voice_Male_Attack" 5.41 s, 5 takes: [0–0.62] [1.29–1.73] [2.41–2.74] [3.50–4.17] [4.66–5.18]; 464485/4814007 elynch0901 "Male Attack Grunt" 0.88 s | 661242/189858 "Swing grunt" 1.03 s |

### Spider
| Need | Primary | Alternates |
|---|---|---|
| Hiss | 459476/6232598 Spoxe "Hissing Cockroach", real recording, 10.2 s; takes [0.53–0.97] [4.39–4.98] [7.19–7.84] [8.41–9.32]. 758900/15895934 short hiss 1.70 s | OGA rubberduck "80 CC0 creature SFX": `bug_01`–`bug_04` (0.35–0.58 s), `https://opengameart.org/sites/default/files/80-CC0-creature-SFX_0.zip` (1,885,648 B) |
| Skitter or chatter | 202108/3756348 spookymodem "Spider Chattering" 12.9 s (quiet, mean −46.7 dB); 443723/7262854 cabusta9 "Spider steps" 8.6 s (made with a plastic bag) | 521869/10058132 "Skittering bugs" 3.97 s |
| Attack | 672710 and 672712 (uid 14685597) kongg_ "Spider Attack 1/2", 0.50 s and 1.06 s (made for a spider enemy) | 505185/2194110 Darsycho "Angry spider monster" 8.4 s, 5 takes: [0–1.51] [1.88–3.18] [3.55–4.85] [5.22–6.31] [6.81–8.21] |
| Death | 559621/8216881 Leadstarson "medium monster death" 0.90 s layered with 515619/6769489 mrickey13 "Splat/Squish 2" 0.76 s | 751340/71257 qubodup "Slime Death" 0.29 s |
| Web (extra) | 659428/5287430 Sadiquecat "Stick through spider web" 2.44 s | |

### Bear
The Nivatius files are U.S. National Park Service public-domain grizzly recordings.

| Need | Primary | Alternates |
|---|---|---|
| Idle, breathing | 519596/7143328 "move and growl grizzly bear" 10.85 s; 519598 and 519597 "huf grizzly" 0.36 s and 0.49 s | 519599 "growl eating" 54 s, content 2.64–51.98 s |
| Roar | 763026/1764719 celldroid "Bear Angry Growl" 5.83 s (real black bear); 530573/1907923 barrypirro "Beast Roar" 6.38 s (designed, loud) | 240311/864571 "Nemean Roar" 15.6 s |
| Attack | OGA AntumDeluge "Bear Growls" (CC0; source is U.S. Fish & Wildlife Service) `https://opengameart.org/sites/default/files/bear.zip` (115,221 B): `ogg/bear_01.ogg` 1.07 s, `bear_02.ogg` 1.19 s; plus 342204/3908740 "Beast Snarling" 3.22 s | 571386/11058236 4.33 s |
| Charge | 519600 "running grizzly", content 6.15–12.25 s | |
| Death | 734841/14713973 QuantumFellow "dyingBeast" 4.19 s | 559621 |

### Cave, water and mechanisms
| Need | Primary | Alternates |
|---|---|---|
| Cave ambience bed | 553080/9250976 Nox_Sound "Ambiance_Atmosphere_Cave_Loop_Stereo" 57 s, already a loop (wind, drips, a bat, a small stream) | 516566/2247456 Kinoton "Dark Dungeon Ambience" 180 s; 636124/11705708 60 s |
| Drips | 609161/938246 nomadas, real cave recording, 47.6 s | 177958/985466 Sclolex 89.8 s (processed, very quiet at −48 dB mean); 162116/2155835 64 s |
| Distant wind | 852822/18763192 KolbyRFX "Subterranean Howling Wind Loop" 219 s (synthesised; trim to about 60 s); 530161/2683450 Flamiffer "Dungeon Air" 151.6 s | 130975/1483235 "Wailing Winds" 51 s |
| Underground stream | 552485/9847211 hinchinbrook "Water Flowing into Underground Sinkhole" 22.8 s, continuous | 509547/9847211 rocky stream 16 s; 753938/16236894 38 s. Rejected 414167 because it has birds in it. |
| Lever | 506146/1282624 mitchanary "lever_chains14" 1.78 s; 696746/13579627 Krokulator "lever" 0.60 s | 151271/2578041 0.62 s |
| Gears or chain | 784229/9813501 apintofmild "Chain Driven Mechanism" 65 s (tagged drawbridge); 199282/71257 qubodup "Big Metal Chain" 53 s (the page says CC0 since 2026-07-30) | 452234/612689 kyles gears 67 s |
| Drawbridge | Layer 784229 with 199282 | 483228/2524442 craigsmith "Drawbridge Opens" 12.6 s (provenance concern, see risks) |
| Drawbridge crash | 508546/5026978 Wdomino "Bridge Collapse" 10.15 s ([0.72–7.25] and [7.40–9.93]); 584891/13194852 "big log on dirt" (takes [0.36–1.12] [3.87–4.24] [11.07–11.39] [13.63–14.04]) | The project's existing 487142 |
| Rubble collapse | 567249/7108319 iwanPlays "Bricks/Stones/Rocks/Gravel Falling" 4.2 s (a mix of CC0 sources); 381645/5486695 AlanCat "RockFall1b" (takes [0.32–3.70] [8.81–11.65] [28.09–30.72]) | 550342/9250976 five debris takes; 712918/15139380 3 s rumble |
| Torch crackle | 637523/612689 kyles "small campfire crackling" 34.9 s, mono, no gaps (good for a loop); 181563/1857065 kingsrow "Fire Crackling 01" 34.2 s | 422742/6616210 2.44 s (tagged Torch/Loop); 249809/3756348 "Waving Torch" 4.3 s for a torch swing. Avoid 634775 (15 silence gaps) and 497193 (a gas burner). |
| Dungeon door, wood | 452608/612689 kyles "old heavy cellar door with metal latch" 19.4 s, many takes, e.g. [0.48–0.97] [2.61–3.14] [5.73–6.20] [11.09–11.81] [15.78–16.44]; 125957/981397 Ryding "Opening a creaking door" 3.68 s | |
| Iron gate and lock | 207137/2568776 ahill86 "MetalGate" ([0.41–1.48] latch, [2.52–7.26] swing); 159552/71257 qubodup gate slam with echo 2.78 s; 734641/13973196 "Lock - strong door" 1.65 s | |
| Stone door | 578490/6911631 PostProdDog "Heavy stone door opens" (content 1.46–12.58 s); 243699/3752922 "Hidden Wall Opening" 3.54 s; 465807/1348084 "big stone door slamming shut" 0.85 s (edited from contramundum 266440, also CC0) | |
| Chest | 202092/3756348 spookymodem "Chest Opening" 4.94 s; 771164/789424 "Treasure Chest Open" 1.34 s; close: 573648/6614920 1.26 s | 573654/6614920 (quiet); coins 347174/6324381 0.51 s |

Silence boundaries were measured at −40 dB, so the trims cut off reverb tails; add 0.2–0.4 s to each end point.

### Music (all URLs return 200; durations from remote ffprobe)

**Combat**
- **Primary: RandomMind "Medieval: Battle"** (CC0). https://opengameart.org/content/medieval-battle. File: https://opengameart.org/sites/default/files/battle_8.mp3 (78.9 s, 320 kbps, 3,158,907 B). Same composer as the "Lament" track the cart chapter already uses.
- **Alternates:**
  - cynicmusic "Battle Theme A" (CC0, strings and horns): `battleThemeA.mp3`, 95.9 s, 3,289,143 B.
  - Emma_MA "Determined Pursuit (epic orchestra loop)" (CC0, seamless loop): `determined_pursuit_loop.wav`, 108 s, 19 MB.
  - Kevin MacLeod tracks (CC BY 4.0), each at `https://incompetech.com/music/royalty-free/mp3-royaltyfree/<Title>.mp3`:
    - "Strength of the Titans" 1:02 (hurdy-gurdy and brass; good for the bear fight)
    - "Achilles" 1:01
    - "Five Armies" 2:36
    - "Darkling" 2:50
    - "Clash Defiant" 6:16 (war horn and choir)

**Calm cave exploration**
- **Primary: RandomMind "Medieval: Exploration"** (CC0, 236 s). **It is already in the repo** as `assets-src/audio/Exploration.mp3`, byte-identical in size (9,446,112 B) to https://opengameart.org/sites/default/files/Exploration_0.mp3. However, `tools/fetch-extra.mjs` doesn't fetch it and `tools/credits-extra.mjs` doesn't credit it. Add both.
- **Darker alternates:**
  - Paul Wortmann "Dark Cavern Ambient" (CC0): `dark_cavern_ambient_002.ogg` is a continuous 120 s loop (1,693,463 B); `_001` fades in and out.
  - HaelDB "Cave Theme" (dual OGA-BY 3.0 / CC0): `cave%20themeb4.ogg`, 280 s.
  - Kevin MacLeod "Ossuary 5 - Rest" 3:56 and "Ossuary 1 - A Beginning" 3:08 (calm, dark synths).
  - Kevin MacLeod "The Path of the Goblin King" 3:26 and "Night Vigil" 4:48.

**Tension, e.g. the spider nest**
- Kevin MacLeod "Unseen Horrors" 4:11 or "Gloom Horizon" 2:08.
- cinameng "Descent" (CC0) `descent.mp3`, 68.6 s loop.

**Required Kevin MacLeod credit text:** `"Title" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 https://creativecommons.org/licenses/by/4.0/`. This matches the project's existing "Gathering Darkness" entry.

### What happens in the build (`tools/gen/audio.mjs`)
I ran the exact filter chain (`aresample=48000,loudnorm=I=-18:TP=-2`, then libopus) on 0.21–0.76 s clips. It works: each output is 2.2–6.7 KB and peaks at about −2 dBFS.

The side effect is that every clip comes out roughly equally loud. For example, Wdomino footsteps peak at −25.7 dB in the source and −1.9 dB after the build. Relative loudness therefore has to be set at runtime with per-sound gain (footsteps around 0.2–0.3, drips and ambience low).

### Snippet for `tools/fetch-extra.mjs` (append to `FS`; 99 entries, all CC0)
```
[840716, 18136826], [840717, 18136826], [840715, 18136826], [367182, 5065048], [547042, 7614679], [547036, 7614679], [547035, 7614679], [411122, 1424100], [522091, 11537497], [779805, 15956618], [452554, 612689], [636102, 11705708], [372877, 6944346], [783059, 16503936], [616493, 702542], [616495, 702542], [616494, 702542], [326867, 4077311], [442769, 71257], [577619, 13023338], [517122, 5026978], [517121, 5026978], [517125, 5026978], [517137, 5026978], [517136, 5026978], [517135, 5026978], [517134, 5026978], [517117, 5026978], [517124, 5026978], [517123, 5026978], [384881, 984733], [384882, 984733], [384887, 984733], [504626, 4437257], [325270, 2104797], [325269, 2104797], [734629, 13973196], [547203, 129727], [547202, 129727], [547201, 129727], [547200, 129727], [547207, 129727], [547206, 129727], [547182, 129727], [547181, 129727], [547189, 129727], [474651, 9250976], [464485, 4814007], [459476, 6232598], [758900, 15895934], [202108, 3756348], [443723, 7262854], [672710, 14685597], [672712, 14685597], [505185, 2194110], [559621, 8216881], [515619, 6769489], [659428, 5287430], [519596, 7143328], [519598, 7143328], [519597, 7143328], [763026, 1764719], [530573, 1907923], [519599, 7143328], [519600, 7143328], [342204, 3908740], [734841, 14713973], [553080, 9250976], [609161, 938246], [177958, 985466], [852822, 18763192], [530161, 2683450], [552485, 9847211], [509547, 9847211], [506146, 1282624], [696746, 13579627], [784229, 9813501], [199282, 71257], [508546, 5026978], [584891, 13194852], [567249, 7108319], [381645, 5486695], [712918, 15139380], [637523, 612689], [181563, 1857065], [422742, 6616210], [249809, 3756348], [452608, 612689], [125957, 981397], [207137, 2568776], [159552, 71257], [734641, 13973196], [578490, 6911631], [243699, 3752922], [465807, 1348084], [202092, 3756348], [771164, 789424], [573648, 6614920], [347174, 6324381]
```
Matching credit lines, in the `credits-extra.mjs` format, are in `snippet.txt`. Add `download()` lines for `battle_8.mp3`, `Exploration_0.mp3` (or keep the existing file and just record it), `bear.zip` (unzip `ogg/bear_0[12].ogg`), and whichever Kevin MacLeod track you choose.

### Rejected after checking
- **336888 Omnisis "Gate-Heavy-OpenClose".** Marked CC0, but its description says it mixes 109710 Tomlija (CC-BY 3.0) and 268233 YleArkisto (CC-BY 4.0).
- **lendrick growls 77632–77637.** Sampled "with permission" from another user's upload, so the CC0 chain is unclear.
- **760636 chungkury parry.** Described as a "secondary creation using other sound effects" with no sources named.
- **523760.** It's an anime magic-spell block.
- **414167.** Has birds in it.
- **517126.** Nearly silent.
- **634775.** Full of gaps.
- **497193.** A gas burner, not a torch.

The incompetech titles "Spacial Winds" and "Dama Ciega" return 404.

## Recommendations
- Sword swings: Nomagician Sword Swing 1/3/2 (840716, 840717, 840715; uid 18136826; 0.76 s each). Heavy or axe swing: GaussTheWizard swing 367182/5065048 (0.70 s) | https://freesound.org/s/840716/ (also /840717/, /840715/, /367182/) | CC0 1.0 (checked on each page; the source knife recording, wilhellboy 351367, is also CC0) | verified=True | Add [840716,18136826],[840717,18136826],[840715,18136826],[367182,5065048] to FS in tools/fetch-extra.mjs. URL pattern: https://cdn.freesound.org/previews/840/840716_18136826-hq.ogg
- Sword and axe impacts on flesh: CogFireStudios Hit Impact Sword 3/2/1 (547042, 547036, 547035; uid 7614679; 1.2–1.3 s). Axe: magnuswaker Pound of Flesh 1 (522091/11537497, 0.62 s) and modusmogulus Meaty Damage Impact (779805/15956618, 0.74 s), layered with kyles axe chop (452554/612689, 0.60 s) | https://freesound.org/s/547042/ etc. | CC0 1.0 | verified=True | Add the [id, uid] pairs to FS. Example: https://cdn.freesound.org/previews/547/547042_7614679-hq.ogg
- Impacts on shields: fonografico SHIELDHIT2 (636102/11705708, 1.10 s), Hakren Iron-Wood Slam (372877/6944346, 1.66 s), hushless Sword Hitting Wood (783059/16503936, 0.21 s) | https://freesound.org/s/636102/, /372877/, /783059/ | CC0 1.0 | verified=True | FS entries [636102,11705708],[372877,6944346],[783059,16503936]
- Block or parry: Empiremonkey block1/2/3 (616495, 616494, 616493; uid 702542; 0.6–0.93 s), JohnBuhr Sword_Clash (9) (326867/4077311), qubodup Sword Hit (442769/71257) | https://freesound.org/s/616493/ etc. | CC0 1.0 | verified=True | FS entries. Alternate: OGA StarNinjas sword clash pack, CC0, https://opengameart.org/sites/default/files/sword_clash_-_starninjas_0.zip
- Footsteps on stone: Wdomino 'Footsteps Stone' one-shots 517122, 517121, 517125, 517137, 517136, 517135, 517134, 517117, 517124, 517123 (uid 5026978; 0.44–0.72 s, mono; skip 517126, which is near-silent). Armoured NPCs: Ali_6868 chainmail steps 384881, 384882, 384887 (uid 984733) | https://freesound.org/s/517122/ etc. | CC0 1.0 | verified=True | FS entries. Sources are quiet (peak about −23 dB) and the build's loudnorm raises them to about −2 dBFS, so use a runtime gain of about 0.25
- Body fall: leonelmail BODY FALL - V HVY - DIRT (504626/4437257, 1.63 s), Body fall 1/2 (325270, 325269; uid 2104797, deleted account), Vrymaa heavy fall (734629/13973196; trim 0–1.77 s) | https://freesound.org/s/504626/, /325270/, /325269/, /734629/ | CC0 1.0 | verified=True | FS entries; use trim [0, 2.0] for 734629
- Male grunts, pain and death: MrFossy PainGrunts 547203, 547202, 547201, 547200, 547207, 547206 and DeathScream 547182, 547181, 547189 (uid 129727). Attack shouts: Nox_Sound 474651/9250976 (5 takes: 0–0.62, 1.29–1.73, 2.41–2.74, 3.50–4.17, 4.66–5.18) and elynch0901 464485/4814007 | https://freesound.org/s/547203/ etc. | CC0 1.0 | verified=True | FS entries; trim the takes out of 474651
- Spider hiss, skitter, attack, death: Hiss: Spoxe Hissing Cockroach 459476/6232598 (takes 0.53–0.97, 4.39–4.98, 7.19–7.84, 8.41–9.32) and 758900/15895934. Skitter: spookymodem Spider Chattering 202108/3756348 and cabusta9 spider steps 443723/7262854. Attack: kongg_ Spider Attack 672710 and 672712 (uid 14685597); Darsycho Angry spider monster 505185/2194110. Death: Leadstarson 559621/8216881 plus mrickey13 squish 515619/6769489. Web: 659428/5287430 | https://freesound.org/s/459476/, /202108/, /672710/, /505185/, /559621/ etc. | CC0 1.0 | verified=True | FS entries. Alternate: OGA rubberduck 80 CC0 creature SFX (bug_01–04), https://opengameart.org/sites/default/files/80-CC0-creature-SFX_0.zip
- Bear growl, roar, attack: Nivatius NPS public-domain grizzly recordings: 519596 (idle growl, 10.85 s), 519598 and 519597 (huffs), 519599 (growls, 54 s), 519600 (running, content 6.15–12.25), all uid 7143328. Roar: celldroid real black bear 763026/1764719 and barrypirro Beast Roar 530573/1907923. Attack: OGA AntumDeluge Bear Growls (USFWS, CC0) bear_01/02.ogg and Christopherderp 342204/3908740. Death: QuantumFellow 734841/14713973 | https://freesound.org/s/519596/, /763026/; https://opengameart.org/content/bear-growls | CC0 1.0 (OGA pack README: CC0, source U.S. Fish & Wildlife Service) | verified=True | FS entries, plus download https://opengameart.org/sites/default/files/bear.zip to TMP and unzip /ogg\/bear_0[12]\.ogg$/ into assets-src/audio
- Cave ambience (drips, distant wind): Bed: Nox_Sound cave loop 553080/9250976 (57 s, already loops). Drips: nomadas real cave 609161/938246 (47.6 s). Wind: KolbyRFX subterranean wind loop 852822/18763192 (219 s, trim to about 60 s) or Flamiffer Dungeon Air 530161/2683450 | https://freesound.org/s/553080/, /609161/, /852822/, /530161/ | CC0 1.0 | verified=True | FS entries; trim the long loops and use the build's loop crossfade
- Underground stream: hinchinbrook 'Water Flowing into Underground Sinkhole' 552485/9847211 (22.8 s, continuous); alternate 509547/9847211 rocky stream 16 s | https://freesound.org/s/552485/ | CC0 1.0 | verified=True | FS entries; use loop: 2
- Lever, gears, drawbridge: Lever: mitchanary lever_chains14 506146/1282624 and Krokulator lever 696746/13579627. Mechanism: apintofmild Chain Driven Mechanism 784229/9813501 (65 s, tagged drawbridge) layered with qubodup Big Metal Chain 199282/71257 (53 s) | https://freesound.org/s/506146/, /696746/, /784229/, /199282/ | CC0 1.0 (199282's page notes it has been CC0 since 2026-07-30) | verified=True | FS entries. Alternate drawbridge: craigsmith 483228/2524442, but see the provenance risk
- Drawbridge crash and rubble collapse: Crash: Wdomino Bridge Collapse 508546/5026978 (10.15 s) and KrystianPawlowski big log 584891/13194852. Rubble: iwanPlays 567249/7108319 (4.2 s) and AlanCat RockFall1b 381645/5486695 (takes 0.32–3.70, 8.81–11.65, 28.09–30.72); greyfeather rumble 712918/15139380 | https://freesound.org/s/508546/, /567249/, /381645/ | CC0 1.0 | verified=True | FS entries with trim windows
- Torch crackle: kyles small campfire crackling 637523/612689 (34.9 s, mono, no gaps; loop it) or kingsrow Fire Crackling 01 181563/1857065 (34.2 s). Torch swing: spookymodem Waving Torch 249809/3756348 | https://freesound.org/s/637523/, /181563/, /249809/ | CC0 1.0 | verified=True | FS entries; use loop: 1.5 and trim to about 20 s
- Dungeon doors and gates: Wood: kyles cellar door with latch 452608/612689 (trim takes) and Ryding creaking door 125957/981397. Iron: ahill86 MetalGate 207137/2568776, qubodup gate slam 159552/71257, Vrymaa lock 734641/13973196. Stone: PostProdDog heavy stone door 578490/6911631 (1.46–12.58 s), ertfelda Hidden Wall Opening 243699/3752922, PaceHeart stone slam 465807/1348084 | https://freesound.org/s/452608/ etc. | CC0 1.0 | verified=True | FS entries with trims
- Chest open: spookymodem Chest Opening 202092/3756348 (4.94 s), steprock Treasure Chest Open 771164/789424 (1.34 s), close 573648/6614920, coins 347174/6324381 | https://freesound.org/s/202092/, /771164/ | CC0 1.0 | verified=True | FS entries
- Combat music: RandomMind 'Medieval: Battle' (78.9 s, 320 kbps). Bear fight: Kevin MacLeod 'Strength of the Titans' (1:02) or 'Achilles' (1:01). Alternates: cynicmusic 'Battle Theme A' (CC0, 95.9 s), Kevin MacLeod 'Five Armies' (2:36) | https://opengameart.org/content/medieval-battle; https://incompetech.com | CC0 (OGA page) / CC BY 4.0 (Kevin MacLeod, credit required) | verified=True | download('https://opengameart.org/sites/default/files/battle_8.mp3', A/'oga_medieval_battle.mp3'); download('https://incompetech.com/music/royalty-free/mp3-royaltyfree/Strength%20of%20the%20Titans.mp3', A/'km_Strength_of_the_Titans.mp3')
- Calm cave exploration music: RandomMind 'Medieval: Exploration' (236 s). Already in assets-src/audio/Exploration.mp3 (identical size, 9,446,112 B) but not fetched or credited. Darker options: Paul Wortmann 'Dark Cavern Ambient' 002 (CC0, 120 s loop) and Kevin MacLeod 'Ossuary 5 - Rest' (3:56) | https://opengameart.org/content/medieval-exploration; https://opengameart.org/content/dark-cavern-ambient | CC0 / CC BY 4.0 (Kevin MacLeod) | verified=True | download('https://opengameart.org/sites/default/files/Exploration_0.mp3', A/'Exploration.mp3') and add a credits entry; optionally download('https://opengameart.org/sites/default/files/dark_cavern_ambient_002.ogg', ...)

## Risks
- Provenance: craigsmith's Freesound uploads are digitised 1930s–60s Hollywood studio effects (USC Cinema transfers) that the uploader released as CC0. Whether he holds the rights is uncertain. The project already ships four of them (479790 hooves, 487142 and 675900 collapses, 675821 arrows). Avoid the drawbridge candidates 483228 and 483224 from the same series, and consider replacing the four, e.g. collapse → 508546 or 712918, arrows → velcronator whooshes.
- Freesound 336888 (Omnisis heavy gate, 6.7k downloads) is labelled CC0 but mixes CC-BY sources (Tomlija 109710, CC-BY 3.0; YleArkisto 268233, CC-BY 4.0). It is excluded; if it is ever used, Tomlija and YleArkisto must be credited.
- lendrick growls 77632–77637 and chungkury parry 760636 are derivatives whose sources are unclear or were used 'with permission'. Both are excluded.
- assets-src/audio/Exploration.mp3 (RandomMind 'Medieval: Exploration', CC0) is present but missing from tools/fetch-extra.mjs and tools/credits-extra.mjs, so the build isn't reproducible and the credit is missing.
- The build's loudnorm (I=-18, TP=-2) brings every clip, short or long, to about −2 dBFS peak (tested). Quiet sources such as footsteps, drips (177958 at −48 dB mean, 552485, 202108) and chest 573654 get boosted along with their noise floor, and relative loudness is lost. Runtime per-sound gain is required; alternatively skip loudnorm for one-shots under 3 s.
- 199282 (qubodup Big Metal Chain) changed licence: its page says it has been CC0 since 2026-07-30. Record that date in the credit; crediting qubodup anyway is harmless.
- Kevin MacLeod tracks are CC BY 4.0 and need a visible credit in the exact incompetech format. The incompetech URLs for 'Spacial Winds' and 'Dama Ciega' return 404.
- Freesound HQ previews are lossy (about 192 kbps Ogg, or roughly 110 kbps for mono sources), and the Opus re-encode is a second lossy generation. That is acceptable and matches the current practice.
- Long sources (852822 at 219 s, 530161 at 151 s, 516566 at 180 s, 519599 at 54 s) should be trimmed to about 30–60 s loops to keep the size budget down.
- Several spider and bear sounds are designed rather than recorded (plastic bag, reversed guinea pig, synthesised) because real spiders are silent. Listen before final selection; I checked by metadata and signal analysis only, not by ear.
- One author account is deleted (deleted_user_2104797, Body fall 325270/325269). The previews still serve and the sounds are CC0, but the credit can only name the deleted-user handle.