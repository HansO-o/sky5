// Original script for the keep chapter (要塞): every line of design §5.3, both routes, as data.
// docs/design/keep-exit-chapters.md is the source: ids, speakers and lines are copied from its tables.
// Pure data and small helpers (no Babylon): keep.ts plays these through the Director.
//
// Routes (`branch`): "rebel" = the player followed 布伦 through the postern, "imperial" = the player
// followed the scribe through the main gate, "both" = played before the choice or on either route.
//
// The player's name: lines hold the placeholder `{name}` (the spec's `${name}`), and the paper prop
// `{homeland}`. Fill them with `fill(text, { name: stage.appearance?.name, homeland })` right before
// showing the line; a missing name becomes 朋友, as the spec says. Strings never hold the name itself,
// so `tools/check-lines.mjs` and the unit tests see every line exactly as written.
//
// Speaker labels (`who`) are what the subtitle shows. The scribe is 书记官 until he introduces himself
// (imperial K1-I6) and 伊沃 after; on the rebel route he stays 书记官. The caged scout is 女囚 or
// 霜誓军斥候 until she gives her name, 卡雅 after.

import type { Faction, PrologueFlags } from "../flags";

export type { Faction };

/** The route a line belongs to: one of the two, or both (before the choice, or shared). */
export type Branch = "both" | Faction;

/**
 * An extra condition on top of the route, for scene variants:
 * - `fight`: the torture room was a fight (always on the rebel route; imperial only when the player
 *   attacked during the bluff, `outcomes.torture === "fought"`);
 * - `bluff`: imperial, the warrant bluff was not broken off (`outcomes.torture !== "fought"`);
 * - `fought`: imperial, the bluff turned into a fight (`outcomes.torture === "fought"`);
 * - `letter`: the player carries the barracks letter (`inv.letter`).
 */
export type When = "fight" | "bluff" | "fought" | "letter";

/**
 * What starts a line that is not part of its beat's main sequence (lines without `on` play in table
 * order as the beat's scripted conversation):
 * - keep: `nag` K0 pressure barks · `away` the player wandered off · `commit` the choice was made ·
 *   `latch` the doors wait for the underground assets · `armour` the armour went on · `fallback` a
 *   soft-lock timer ran out · `after` the fight is over · `footlocker` the optional barracks letter ·
 *   `surrender` the assistant gave up · `downed` the interrogator kneels at 0 HP · `dies` he dies ·
 *   `cage` the cage is open · `read` an optional record is read · `attacked` the player broke the
 *   bluff · `silent` a silent backstab · `detected` the backstab target noticed the player ·
 *   `chatter` the camp talks before it is alerted · `bridge` the drawbridge has landed;
 * - exit: `fungus` the glowing mushrooms (cut #1) · `cocoon` the cocoon search · `phaseA`/`phaseB`
 *   the spider ambush phases · `satchel` the player looks at the hunter's satchel · `stir`, `calm`,
 *   `wake`, `passed`, `killed`, `leashed` the wolf's states (the flee hint is a `wake` line at 6 s) ·
 *   `bend` the companion stops at the last bend.
 */
export type Trigger =
  | "nag"
  | "away"
  | "commit"
  | "latch"
  | "armour"
  | "fallback"
  | "after"
  | "footlocker"
  | "surrender"
  | "downed"
  | "dies"
  | "cage"
  | "read"
  | "attacked"
  | "silent"
  | "detected"
  | "chatter"
  | "bridge"
  | "fungus"
  | "cocoon"
  | "phaseA"
  | "phaseB"
  | "satchel"
  | "stir"
  | "calm"
  | "wake"
  | "passed"
  | "killed"
  | "leashed"
  | "bend";

/** Every speaker label the keep and exit scripts show (design §1). */
export type Who =
  | "布伦"
  | "书记官"
  | "伊沃"
  | "帝国守卫"
  | "帝国守卫长"
  | "帝国盾兵"
  | "帝国士兵"
  | "帝国弓手"
  | "狱卒"
  | "霜誓军头目"
  | "霜誓军斧手"
  | "霜誓军弓手"
  | "霜誓军逃犯"
  | "霜誓军斥候"
  | "审讯官"
  | "审讯助手"
  | "女囚"
  | "卡雅"
  | "老囚犯"
  | "审讯记录"
  | "信件";

export interface ScriptLine {
  /** the spec's id (K1-I6, X2-R5, …); its prefix before "-" is the beat */
  readonly id: string;
  /** the speaker label as displayed */
  readonly who: Who;
  /**
   * a second possible speaker, when the spec gives two (`布伦 / 伊沃`): K0-P1 whichever NPC is nearer;
   * K2-F the route's companion (`who` on the rebel route, `alt` on the imperial one)
   */
  readonly alt?: Who;
  /** the line; `{name}` = the player's name (see `fill`) */
  readonly text: string;
  readonly branch: Branch;
  readonly when?: When;
  /** what starts the line; absent = the beat's main sequence, in table order */
  readonly on?: Trigger;
  /** the spec's stage direction for the line (whisper, off-screen, what happens with it) */
  readonly cue?: string;
  /** start, in seconds, on the set-piece timeline the spec gives (§5.2, §6.1), or after its trigger */
  readonly at?: number;
  /** silence after the line, in seconds, where the spec asks for one */
  readonly gap?: number;
  /** how long the line stays up, in seconds, where the spec fixes it (otherwise the reading time) */
  readonly dur?: number;
  /** the clip the speaker plays with the line, where the spec names one */
  readonly talk?: string;
  /** whom the speaker faces, where the spec says so */
  readonly look?: "player";
  /** content the player may never see (optional rooms and items, cut-list material) */
  readonly optional?: boolean;
}

/** What decides the scene variants (`When`); build it from the flags with `scriptState`. */
export interface ScriptState {
  torture?: PrologueFlags["outcomes"]["torture"];
  letter?: boolean;
}

export function scriptState(f: Pick<PrologueFlags, "outcomes" | "inv">): ScriptState {
  return { torture: f.outcomes.torture, letter: f.inv.letter };
}

/** Shown for `{name}` when the player has none (the spec: `stage.appearance?.name || "朋友"`). */
export const DEFAULT_NAME = "朋友";

/** Fills `{name}` and `{homeland}` in a line. */
export function fill(text: string, v: { name?: string | null; homeland?: string | null } = {}): string {
  return text.replace(/\{(name|homeland)\}/g, (_, k: string) => (k === "name" ? v.name || DEFAULT_NAME : (v.homeland ?? "")));
}

/** Whether a line plays on `branch` ("both": only the shared lines) given the scene state (none: every variant). */
export function plays(l: ScriptLine, branch: Branch, state?: ScriptState): boolean {
  if (branch === "both" ? l.branch !== "both" : l.branch !== "both" && l.branch !== branch) return false;
  if (!l.when || !state) return true;
  switch (l.when) {
    case "fight":
      return branch === "rebel" || state.torture === "fought";
    case "bluff":
      return state.torture !== "fought";
    case "fought":
      return state.torture === "fought";
    case "letter":
      return state.letter === true;
  }
}

export interface LinesOptions {
  /** only the lines this trigger starts; "main" = only the beat's main sequence (lines without `on`) */
  on?: Trigger | "main";
  /** decide `when` variants; without it every variant of the route is returned */
  state?: ScriptState;
}

/** The objective steps of a beat (each goes to `hud.objective` and a toast, in order). */
export interface BeatObjective {
  readonly rebel: readonly string[];
  readonly imperial: readonly string[];
  /** imperial when the torture room turned into a fight (not in the spec's table: the rebel steps) */
  readonly fought?: readonly string[];
}

export interface BeatInfo<B extends string = string> {
  readonly id: B;
  /** the beat's name in the beat sheet */
  readonly title: string;
  /** the checkpoint steps the beat sheet's "Step after" column lists for this beat (§5.1, §6.1, §11) */
  readonly steps?: readonly number[];
  /** the whole beat may be cut or skipped by the player */
  readonly optional?: boolean;
  /** the beat has no lines on purpose */
  readonly silent?: boolean;
  readonly objective: BeatObjective;
}

/** Shared helpers over one chapter's table (`lines` / `line`). */
export function makeScript<T extends Readonly<Record<string, readonly ScriptLine[]>>>(table: T) {
  type Id = T[keyof T][number]["id"];
  const all: ScriptLine[] = Object.values(table).flat();
  const byId = new Map(all.map((l) => [l.id, l]));
  return {
    /** every line, in table order */
    all: all as readonly ScriptLine[],
    /** One line by its spec id (throws on an unknown id). */
    line(id: Id): ScriptLine {
      const l = byId.get(id);
      if (!l) throw new Error(`no script line ${id}`);
      return l;
    },
    /** The lines of a beat that play on `branch`, in table order. */
    lines(beat: keyof T & string, branch: Branch, o: LinesOptions = {}): ScriptLine[] {
      return table[beat].filter(
        (l) => plays(l, branch, o.state) && (o.on === undefined || (o.on === "main" ? !l.on : l.on === o.on)),
      );
    },
  };
}

/** The objective steps of a beat on a route. */
export function objectiveOf(b: BeatInfo, branch: Faction, state?: ScriptState): readonly string[] {
  if (branch === "imperial" && b.objective.fought && state?.torture === "fought") return b.objective.fought;
  return b.objective[branch];
}

// ---------------------------------------------------------------------------------------------------

export type KeepBeat = "K0" | "K1" | "K2" | "K3" | "K4" | "K5" | "K6" | "K7" | "K8" | "K9" | "K10" | "K11" | "K12";

const same = (...steps: string[]): BeatObjective => ({ rebel: steps, imperial: steps });

/** The beat sheet (§5.1). */
export const KEEP_BEATS: readonly BeatInfo<KeepBeat>[] = [
  { id: "K0", title: "两扇门", objective: same("做出选择：跟随布伦（西墙小门），或跟随书记官（正门）") },
  {
    id: "K1",
    title: "入堡",
    steps: [1],
    objective: { rebel: ["跟随布伦进入要塞", "你的双手重获自由"], imperial: ["跟随书记官进入要塞", "你的双手重获自由"] },
  },
  { id: "K2", title: "取装备", steps: [2], objective: { rebel: ["从箱子拿取护甲和武器"], imperial: ["从军械架拿取护甲和武器"] } },
  { id: "K3", title: "初战", objective: { rebel: ["击败帝国守卫"], imperial: ["击败霜誓军"] } },
  {
    id: "K4",
    title: "储藏室",
    steps: [3],
    objective: {
      rebel: ["搜索守卫长的尸体", "打开储藏室", "下到地牢"],
      imperial: ["搜索头目的尸体", "打开储藏室", "下到地牢"],
    },
  },
  { id: "K5", title: "楼梯", steps: [4], objective: same() },
  {
    id: "K6",
    title: "审讯室",
    steps: [5],
    objective: { rebel: ["击败审讯官", "打开笼子"], imperial: ["查看审讯室", "打开笼子"], fought: ["击败审讯官", "打开笼子"] },
  },
  { id: "K7", title: "牢房", optional: true, objective: same("穿过牢房区") },
  { id: "K8", title: "狱卒房", objective: { rebel: ["潜行接近狱卒"], imperial: ["潜行接近那个霜誓军"] } },
  { id: "K9", title: "排水道", steps: [6], objective: same("穿过排水道") },
  { id: "K10", title: "河边营地", steps: [7], objective: { rebel: ["击败营地里的帝国兵"], imperial: ["击败营地里的霜誓军"] } },
  { id: "K11", title: "拉杆", steps: [8], objective: same("拉下拉杆，放下吊桥", "过桥") },
  { id: "K12", title: "断桥", objective: same("沿着河道深入岩洞") },
];

/** Set-piece timings for the lines (§5.2), in seconds. */
export const KEEP_TIMING = {
  /** K0-01…05 start 4.5 s into K0 and take about 16 s */
  argument: { at: 4.5, dur: 16 },
  /** K0 nags: from 20 s, every 9 s, alternating speakers, at most 6; then the objective toast every 20 s */
  nag: { from: 20, every: 9, max: 6, toastEvery: 20 },
  /** K0: beyond 35 m of (60, −650) fireballs + K0-P1; beyond 60 m fade back to the start (toast) */
  away: { warn: 35, back: 60 },
  /** K6 imperial: silence after K6-I10 (the tremor comes 1.5 s into it) */
  bluffSilence: 4,
  /** K12: off-screen shout at 0, standoff lines from 6.5 s (about 11 s), the two closing lines at ≈ 18 s */
  standoff: { shout: 0, at: 6.5, dur: 11, closing: 18 },
} as const;

export const KEEP_SCRIPT = {
  K0: [
    { id: "K0-01", branch: "both", who: "布伦", at: 4.5, text: "它又绕回来了——都别站在空地上！" },
    { id: "K0-02", branch: "both", who: "书记官", text: "正门锁着，钥匙在我身上。进了门，石墙能替我们挡火！" },
    { id: "K0-03", branch: "both", who: "布伦", text: "西墙根有道送柴的小门，帝国人从来懒得锁。{name}，跟我走！" },
    { id: "K0-04", branch: "both", who: "书记官", text: "{name}，跟一个叛军进门，出来的时候你就是叛军！" },
    { id: "K0-05", branch: "both", who: "布伦", text: "跟一个书记官进门，明早他就把你重新写进死人名单！" },
    { id: "K0-N1", branch: "both", on: "nag", who: "布伦", text: "{name}！这边！" },
    { id: "K0-N2", branch: "both", on: "nag", who: "书记官", text: "锁开了一半——{name}，过来！" },
    { id: "K0-N3", branch: "both", on: "nag", who: "布伦", text: "它在山那头转弯了，下一趟就冲着我们来！" },
    { id: "K0-N4", branch: "both", on: "nag", who: "书记官", text: "别站在空地上！龙最先看见的，就是会动的东西！" },
    { id: "K0-N5", branch: "both", on: "nag", who: "布伦", text: "我数到十就关门——一……好吧，我不会数到十。快！" },
    { id: "K0-N6", branch: "both", on: "nag", who: "书记官", text: "今早的名单是我念的——让我还你一条命！" },
    { id: "K0-P1", branch: "both", on: "away", who: "布伦", alt: "书记官", cue: "the nearer NPC", text: "回来！那边全是火！" },
    { id: "K0-R1", branch: "rebel", on: "commit", who: "布伦", text: "好！霜誓军记得住，谁在火里站到了我们这边。" },
    { id: "K0-R2", branch: "rebel", on: "commit", who: "书记官", text: "……随你吧。但愿你别后悔。" },
    { id: "K0-R3", branch: "rebel", on: "commit", who: "书记官", cue: "going through the gate", text: "将军！有人看见维罗将军吗？！" },
    { id: "K0-I1", branch: "imperial", on: "commit", who: "书记官", text: "谢谢你……肯信一个早上还在念死人名单的人。" },
    { id: "K0-I2", branch: "imperial", on: "commit", who: "布伦", cue: "distant", text: "那就各走各的路。下回见面，别指望我手下留情。" },
  ],
  K1: [
    // §5.1 K1: while the underground assets load, the companion jiggles the latch and loops the beat
    // sheet's "门闩卡住了" verbatim (the §5.3 tables give it no id). It plays before the doors open, so
    // before the scribe introduces himself in K1-I6.
    { id: "K1-RL", branch: "rebel", on: "latch", who: "布伦", talk: "Push_Loop", cue: "loops until the doors may open", text: "门闩卡住了" },
    { id: "K1-IL", branch: "imperial", on: "latch", who: "书记官", talk: "Push_Loop", cue: "loops until the doors may open", text: "门闩卡住了" },
    { id: "K1-R1", branch: "rebel", who: "布伦", text: "有一年冬天，我在这儿替帝国人劈过柴。这扇门的闩，早让我撬松了。" },
    { id: "K1-R2", branch: "rebel", who: "布伦", text: "进去！快！" },
    { id: "K1-R3", branch: "rebel", who: "布伦", cue: "the beam falls outside", text: "……好，门也省得关了。龙进不来，帝国兵也别想从这儿进来。" },
    { id: "K1-R4", branch: "rebel", who: "布伦", cue: "bonds shot", text: "手伸过来。绳子勒了一整天，你的手该没知觉了。" },
    { id: "K1-R5", branch: "rebel", who: "布伦", cue: "bonds shot", text: "……好了。活动活动手指，待会儿要用。" },
    { id: "K1-I1", branch: "imperial", who: "书记官", text: "别出声……锁锈了……好了！" },
    { id: "K1-I2", branch: "imperial", who: "书记官", text: "进去——闩上！外头那东西可不会敲门。" },
    { id: "K1-I3", branch: "imperial", who: "帝国守卫", text: "站住！……书记官大人？您还活着！外面……外面还有人活着吗？" },
    { id: "K1-I4", branch: "imperial", who: "书记官", text: "比你想的少。去西边卫兵房看看，那道送柴的小门闩好了没有。" },
    { id: "K1-I5", branch: "imperial", who: "帝国守卫", text: "是、是！" },
    { id: "K1-I6", branch: "imperial", who: "书记官", text: "我们还没正式认识。伊沃·塔兰，雾门守备队的书记官。" },
    { id: "K1-I7", branch: "imperial", who: "伊沃", text: "今早那份名单……你的名字，是我添上去的。" },
    { id: "K1-I8", branch: "imperial", who: "伊沃", cue: "bonds shot", text: "手伸出来。这是守备队的绳结，我见过上百回，也解过上百回。" },
    { id: "K1-I9", branch: "imperial", who: "伊沃", cue: "bonds shot", text: "这一回，算我替早上那件事赔罪。远远不够，可总得有个开头。" },
  ],
  K2: [
    { id: "K2-R1", branch: "rebel", who: "布伦", text: "那口箱子里，是帝国人从我们身上扒下来的东西。打开看看。" },
    { id: "K2-R2", branch: "rebel", who: "布伦", cue: "takes an axe", text: "我爹的斧子……还以为再也摸不着了。" },
    { id: "K2-R3", branch: "rebel", who: "布伦", text: "架子上还剩一把剑、一把斧子。剑快，斧子沉——挑一把顺手的。" },
    { id: "K2-R4", branch: "rebel", on: "armour", who: "布伦", text: "合身！穿着霜誓军的皮甲站在帝国的要塞里——我爹要是看见了，能笑上三天。" },
    { id: "K2-I1", branch: "imperial", who: "伊沃", text: "架子上有制式长剑，盾也拿一面……别看我，我握笔比握剑稳。" },
    { id: "K2-I2", branch: "imperial", who: "伊沃", text: "盾牌别嫌沉。真打起来，它比剑更能救命。" },
    { id: "K2-I3", branch: "imperial", on: "armour", who: "伊沃", text: "守备队的皮甲，号码大了点。至少现在，没人会把你当成囚犯了。" },
    { id: "K2-F", branch: "both", on: "fallback", who: "布伦", alt: "伊沃", cue: "the companion (布伦 rebel, 伊沃 imperial); 45 s: tosses a sword, the armour goes on", text: "接着！" },
  ],
  K3: [
    { id: "K3-R0", branch: "rebel", who: "帝国守卫", cue: "off-screen, barracks", text: "兵器库那边有动静！" },
    { id: "K3-R1", branch: "rebel", who: "布伦", text: "有人来了——贴着门框，等他们进来！" },
    { id: "K3-R2", branch: "rebel", who: "帝国守卫长", text: "囚犯跑出来了！拿下！" },
    { id: "K3-R3", branch: "rebel", who: "帝国盾兵", text: "是铁桦！别让他跑了！" },
    { id: "K3-R4", branch: "rebel", on: "after", who: "布伦", text: "他们本来是看守，今天也成了笼子里的耗子。……这不是我想要的打法。" },
    { id: "K3-R5", branch: "rebel", on: "after", who: "布伦", text: "守卫长腰上挂着钥匙串。搜一搜——东边储藏室的门得用它开。" },
    { id: "K3-I0", branch: "imperial", who: "帝国守卫", cue: "off-screen, G2", text: "你们是——不、别——啊！" },
    { id: "K3-I1", branch: "imperial", who: "伊沃", text: "那是……刚才那个孩子。" },
    { id: "K3-I2", branch: "imperial", who: "霜誓军头目", text: "这边还有帝国的人！一个也别放过！" },
    { id: "K3-I3", branch: "imperial", who: "霜誓军斧手", text: "为了托尔瓦德！北境不跪！" },
    { id: "K3-I4", branch: "imperial", on: "after", who: "伊沃", text: "他们是跟着布伦摸进来的。……他们只是想活下去。可他们先拔的刀。" },
    { id: "K3-I5", branch: "imperial", on: "after", who: "伊沃", text: "头目身上有钥匙串——是从那孩子身上抢的。储藏室的门得用它开。" },
    { id: "K3-I6", branch: "imperial", on: "after", who: "伊沃", cue: "bars g2_door", text: "卫兵房的门我顶上了。现在只剩一条路：往下走。" },
  ],
  K4: [
    { id: "K4-R1", branch: "rebel", who: "布伦", text: "红的那瓶是治伤药。喝下去像吞了块炭，可能救命。" },
    { id: "K4-R2", branch: "rebel", who: "布伦", text: "楼梯在里头。地牢在底下——我在那儿蹲过三天，熟。" },
    { id: "K4-I1", branch: "imperial", who: "伊沃", text: "军需簿上记着十二瓶治疗药水……看来有人先来过，就剩这几瓶了。" },
    { id: "K4-I2", branch: "imperial", who: "伊沃", text: "底下是地牢和审讯室。我只下去过两次，都是去登记死人的名字。" },
    { id: "K4-RF", branch: "rebel", on: "fallback", who: "布伦", talk: "Kick", cue: "30 s: kicks the storeroom door open", text: "钥匙不要了？……算了，让开。" },
    { id: "K4-IF", branch: "imperial", on: "fallback", who: "伊沃", cue: "30 s: opens the storeroom with the spare key", text: "等等……守备处的备用钥匙，我好像带着。……有了。" },
    { id: "K4-R3", branch: "rebel", on: "footlocker", optional: true, who: "布伦", text: "一封没寄出去的家信……这些帝国兵，也是有娘的。" },
    { id: "K4-I3", branch: "imperial", on: "footlocker", optional: true, who: "伊沃", text: "靠墙那张是我的铺位。床底下那封信，本来要寄回家的……你替我收着吧。" },
  ],
  K5: [
    { id: "K5-R1", branch: "rebel", who: "布伦", cue: "tremor at the mid landing", text: "它落在要塞顶上了……它在找东西。也可能是在找人。" },
    { id: "K5-I1", branch: "imperial", who: "伊沃", cue: "tremor at the mid landing", text: "它停在楼顶上……听，像是在用爪子刨石头。" },
  ],
  K6: [
    { id: "K6-01", branch: "both", who: "审讯官", cue: "through the door", text: "最后问一遍。托尔瓦德的人藏在寒脊哪条山沟里？" },
    { id: "K6-02", branch: "both", who: "女囚", text: "去问山里的风吧。它知道的比我多。" },
    { id: "K6-03", branch: "both", who: "审讯助手", cue: "after the tremor", text: "师傅！上头整座楼都在晃！我们……我们得撤了！" },
    { id: "K6-04", branch: "both", who: "审讯官", text: "撤之前，把笼子里的收拾干净。要塞失守，囚犯不留——这是规矩。" },
    { id: "K6-R1", branch: "rebel", who: "布伦", cue: "low", text: "是卡雅……霜誓军的斥候。他们要杀了她。" },
    { id: "K6-R2", branch: "rebel", who: "布伦", talk: "Kick", cue: "kicks the door", text: "规矩？我来教教你北境的规矩！" },
    { id: "K6-R3", branch: "rebel", who: "审讯官", cue: "E2 starts", text: "铁桦？你本该在断头台上。——小子，拿家伙！" },
    { id: "K6-R4", branch: "rebel", on: "surrender", who: "布伦", text: "滚到墙角去。再让我看见你拿刀，就别怪我。" },
    { id: "K6-R5", branch: "both", when: "fight", on: "downed", who: "审讯官", cue: "kneeling at 0 HP", text: "我只问问题……不问旗号。帝国给钱，我就替帝国问……" },
    { id: "K6-R6", branch: "both", when: "fight", on: "dies", who: "审讯官", text: "替我看看……外面的天还在不在。" },
    { id: "K6-R7", branch: "rebel", on: "dies", who: "布伦", text: "……死得太便宜他了。笼子的钥匙应该在他身上。" },
    { id: "K6-R8", branch: "rebel", on: "cage", who: "卡雅", text: "布伦·铁桦……我还以为今天早上你的脑袋已经落地了。" },
    { id: "K6-R9", branch: "rebel", on: "cage", who: "布伦", text: "差一点。多亏了这位朋友——还有一条龙。说出来你都不信。" },
    { id: "K6-R10", branch: "rebel", on: "cage", who: "卡雅", text: "龙？……难怪那帮帝国人吓得腿都软了。" },
    { id: "K6-R11", branch: "rebel", on: "cage", who: "卡雅", text: "牢房那边还关着我们的人。钥匙给我，我带他们从楼上找路出去。你们往里走——狱卒房后头有条老排水道。" },
    { id: "K6-R12", branch: "rebel", on: "cage", who: "布伦", text: "当心点，卡雅。活着回寒脊。" },
    { id: "K6-R13", branch: "rebel", on: "cage", who: "卡雅", text: "你也是，铁桦。还有你，陌生人——这份情，我记下了。" },
    { id: "K6-RD", branch: "rebel", on: "read", optional: true, who: "审讯记录", cue: "E 阅读 at the records table", text: "……本月共讯十七人。其中九人供词不实，已处置。" },
    { id: "K6-R14", branch: "rebel", on: "read", optional: true, who: "布伦", text: "十七个……里面有三个，我认得。" },
    { id: "K6-I1", branch: "imperial", who: "伊沃", cue: "low", text: "那是奥斯维克，审讯官……他要杀了笼子里的人。" },
    { id: "K6-I2", branch: "imperial", who: "伊沃", text: "住手！" },
    { id: "K6-I3", branch: "imperial", who: "审讯官", text: "哟，书记官。不在桌子后面抄名字，跑到地牢里来做什么？" },
    { id: "K6-I4", branch: "imperial", who: "伊沃", text: "要塞守不住了。全员撤离，囚犯……就地释放。" },
    { id: "K6-I5", branch: "imperial", who: "审讯官", text: "谁的命令？" },
    { id: "K6-I6", branch: "imperial", who: "伊沃", text: "维罗将军的。" },
    { id: "K6-I7", branch: "imperial", who: "审讯官", text: "将军这会儿要么烧成了灰，要么正骑着马往南跑。我只问问题，不问旗号——你拿什么证明？" },
    { id: "K6-I8", branch: "imperial", who: "伊沃", talk: "Interact", cue: "holds out the paper (prop on hand_l)", text: "将军签过字的空白手令。书记官身上随时带着三张。" },
    { id: "K6-I9", branch: "imperial", who: "伊沃", text: "我现在就能在上面添一行字——“审讯官奥斯维克，临阵违令，就地处决。”" },
    { id: "K6-I10", branch: "imperial", who: "伊沃", gap: 4, cue: "4 s of silence follow, a tremor 1.5 s into it", text: "……你想让我写吗？" },
    { id: "K6-I11", branch: "imperial", when: "bluff", who: "审讯官", text: "……好。好得很。这笔账我记着，书记官。" },
    { id: "K6-I12", branch: "imperial", when: "bluff", who: "审讯官", cue: "throws the key", text: "钥匙给你。想放就放——让这些耗子跟着要塞一块儿埋了吧。" },
    { id: "K6-I13", branch: "imperial", when: "bluff", who: "审讯官", text: "小子，走！" },
    { id: "K6-I14", branch: "imperial", when: "bluff", who: "伊沃", cue: "exhales", text: "……那张纸是空的。将军从来没签过字。" },
    { id: "K6-I15", branch: "imperial", on: "cage", who: "霜誓军斥候", text: "一个帝国人……放我走？为什么？" },
    { id: "K6-I16", branch: "imperial", when: "bluff", on: "cage", who: "伊沃", text: "今天我添了太多名字。不想再多添一个。" },
    { id: "K6-I16f", branch: "imperial", when: "fought", on: "cage", who: "伊沃", cue: "replaces K6-I16", text: "今天死的人，已经够多了。" },
    { id: "K6-I17", branch: "imperial", on: "cage", who: "霜誓军斥候", text: "我不会谢你。……但我会记住你的脸。我叫卡雅。" },
    { id: "K6-I18", branch: "imperial", on: "cage", who: "卡雅", text: "牢房里还有我们的人。钥匙给我。——你们去狱卒房后头的排水道吧。别跟着那个审讯官走，他那种人，走到哪儿都在给别人挖坑。" },
    { id: "K6-I19", branch: "imperial", on: "cage", who: "伊沃", cue: "hands over the ring", text: "……拿去。别让我后悔。" },
    { id: "K6-IX1", branch: "imperial", when: "fought", on: "attacked", who: "审讯官", cue: "the player attacks between K6-I3 and K6-I13; E2' starts", text: "看来书记官的朋友更喜欢用刀讲道理。小子，拿家伙！" },
    { id: "K6-IX2", branch: "imperial", when: "fought", on: "attacked", who: "伊沃", text: "……我本来想用一张纸解决的。" },
  ],
  K7: [
    { id: "K7-01", branch: "both", optional: true, who: "老囚犯", text: "门开着？……呵。开着又怎样。" },
    { id: "K7-02", branch: "both", optional: true, who: "老囚犯", text: "我在这儿数过十一个冬天的雪——就从那个小窗口。外头早就没人记得我叫什么了。" },
    { id: "K7-R1", branch: "rebel", optional: true, who: "布伦", text: "老人家，上头有条龙在烧城。待在这儿就是等死。" },
    { id: "K7-I1", branch: "imperial", optional: true, who: "伊沃", text: "告诉我你的名字吧。我……我可以把它记下来。" },
    { id: "K7-I2", branch: "imperial", optional: true, who: "老囚犯", text: "记下来做什么？念给墙听吗？" },
    { id: "K7-03", branch: "both", optional: true, who: "老囚犯", text: "走吧，孩子们。这间牢房是我的，龙也拿不走。" },
    { id: "K7-R2", branch: "rebel", optional: true, who: "布伦", text: "……北境的冬天，能把人熬成石头。" },
    { id: "K7-I3", branch: "imperial", optional: true, who: "伊沃", text: "我抄过的那些名单里……大概也有过他的名字。" },
  ],
  K8: [
    { id: "K8-R1", branch: "rebel", who: "布伦", cue: "whisper", text: "嘘——那个狱卒背对着门，还在摆骰子。上头天都塌了，他倒是喝得沉得住气。" },
    { id: "K8-R2", branch: "rebel", who: "布伦", text: "蹲低，一步一步挪过去。等你站到他背后，再动手。" },
    { id: "K8-R3", branch: "rebel", on: "silent", who: "布伦", text: "干净。帝国人想砍你的头，真是瞎了眼。" },
    { id: "K8-R4", branch: "rebel", on: "detected", who: "狱卒", text: "谁？！……犯人跑出来了！" },
    { id: "K8-R5", branch: "rebel", on: "detected", who: "布伦", text: "被发现了——一起上！" },
    { id: "K8-I1", branch: "imperial", who: "伊沃", cue: "whisper", text: "狱卒死了……有个霜誓军在翻他的箱子。他还没看见我们。" },
    { id: "K8-I2", branch: "imperial", who: "伊沃", text: "蹲下，从背后靠近。……我、我就在这儿看着。" },
    { id: "K8-I3", branch: "imperial", on: "silent", who: "伊沃", text: "……我从没见过有人杀人这么安静。你以前究竟是做什么的？" },
    { id: "K8-I4", branch: "imperial", on: "detected", who: "霜誓军逃犯", text: "帝国的追兵？！来啊！" },
    { id: "K8-I5", branch: "imperial", on: "detected", who: "伊沃", text: "动手！" },
  ],
  K9: [
    { id: "K9-R1", branch: "rebel", who: "布伦", text: "排水道的铁栅被人撬开过……有人先我们一步走了这条路。" },
    { id: "K9-R2", branch: "rebel", who: "布伦", cue: "tremor; the drain ceiling collapses", text: "退后——！" },
    { id: "K9-R3", branch: "rebel", who: "布伦", text: "……底下是空的。是岩洞。风是从那儿往上吹的。" },
    { id: "K9-R4", branch: "rebel", who: "布伦", cue: "takes a wall torch", text: "有风，就有出口。火把我来拿，你看着脚下。" },
    { id: "K9-I1", branch: "imperial", when: "bluff", who: "伊沃", text: "铁栅是新撬开的……奥斯维克走的就是这儿。也许还不止他。" },
    { id: "K9-I1f", branch: "imperial", when: "fought", who: "伊沃", cue: "replaces K9-I1", text: "铁栅是新撬开的……有人先我们一步下去了。" },
    { id: "K9-I2", branch: "imperial", who: "伊沃", cue: "tremor; the drain ceiling collapses", text: "小心——！" },
    { id: "K9-I3", branch: "imperial", who: "伊沃", text: "底下……是天然的岩洞。旧图纸上画过，我一直以为是工匠瞎画的。" },
    { id: "K9-I4", branch: "imperial", who: "伊沃", cue: "takes a wall torch", text: "我来举火把。至少这件事，我做得比你好。" },
  ],
  K10: [
    { id: "K10-Ra", branch: "rebel", on: "chatter", who: "帝国士兵", text: "你说那东西会钻到这底下来吗？" },
    { id: "K10-Rb", branch: "rebel", on: "chatter", who: "帝国盾兵", text: "它那么大个，钻不进来。……应该钻不进来。" },
    { id: "K10-Rc", branch: "rebel", on: "chatter", who: "帝国弓手", text: "都闭嘴。听——上头又塌了一块。" },
    { id: "K10-Ia", branch: "imperial", when: "bluff", on: "chatter", who: "霜誓军斧手", text: "那个审讯官，叫得跟猪一样。" },
    { id: "K10-Ib", branch: "imperial", when: "bluff", on: "chatter", who: "霜誓军斧手", text: "早该有人给他放血了。可惜是在这种耗子洞里。" },
    { id: "K10-Ia'", branch: "imperial", when: "fought", on: "chatter", who: "霜誓军斧手", text: "托尔瓦德大人逃出去了没有？" },
    { id: "K10-Ib'", branch: "imperial", when: "fought", on: "chatter", who: "霜誓军斧手", text: "领主命硬，龙都烧不死他。" },
    { id: "K10-Ic", branch: "imperial", on: "chatter", who: "霜誓军弓手", text: "小声点。帝国的狗说不定还在后头追。" },
    { id: "K10-R1", branch: "rebel", who: "布伦", cue: "whisper; douses the torch", text: "三个帝国兵，也是从要塞逃下来的。石台上那个拿着弓。" },
    { id: "K10-R2", branch: "rebel", who: "布伦", text: "绕到石台后面，先收拾弓手——剩下两个交给我们俩。" },
    { id: "K10-I1", branch: "imperial", when: "bluff", who: "伊沃", cue: "whisper", text: "火堆边上……那是奥斯维克。他们杀了他。" },
    { id: "K10-I2", branch: "imperial", who: "伊沃", cue: "douses the torch", text: "三个霜誓军，高处那个有弓。蹲低，绕到弓手后面……我数到三就冲。" },
    { id: "K10-R3", branch: "rebel", on: "after", who: "布伦", text: "就剩咱们了。……看，河对岸有座吊桥，被吊起来了。" },
    { id: "K10-I3", branch: "imperial", on: "after", who: "伊沃", text: "……他们是卡雅放出来的人。钥匙是我给她的。" },
    { id: "K10-ID", branch: "imperial", when: "bluff", on: "read", optional: true, who: "审讯记录", cue: "E 搜查 on the interrogator's body", text: "……本月共讯十七人。其中九人供词不实，已处置。" },
    { id: "K10-I4", branch: "imperial", when: "bluff", on: "read", optional: true, who: "伊沃", text: "十七个名字。我会把它们带出去。" },
  ],
  K11: [
    { id: "K11-R1", branch: "rebel", who: "布伦", text: "链子从对岸一直牵到这根拉杆上。桥是从这边放的——拉它。" },
    { id: "K11-I1", branch: "imperial", who: "伊沃", text: "绞盘，拉杆——吊桥是从这边放的。你来拉吧，我的手到现在还在抖。" },
    { id: "K11-R2", branch: "rebel", on: "bridge", who: "布伦", text: "哈！修这座桥的人，比修要塞的靠谱。" },
    { id: "K11-I2", branch: "imperial", on: "bridge", who: "伊沃", text: "成了。……走，别在桥上停。" },
    { id: "K11-RF", branch: "rebel", on: "fallback", who: "布伦", cue: "60 s near the lever: pulls it", text: "站着别动，我来拉！" },
    { id: "K11-IF", branch: "imperial", on: "fallback", who: "伊沃", cue: "60 s near the lever: pulls it", text: "我、我来试试——" },
  ],
  K12: [
    { id: "K12-R0", branch: "rebel", who: "帝国弓手", at: 0, cue: "off-screen", text: "在那儿！吊桥那边！" },
    { id: "K12-R1", branch: "rebel", who: "帝国弓手", at: 6.5, text: "长官，我射得中他们——" },
    { id: "K12-R2", branch: "rebel", who: "书记官", text: "放下弓。" },
    { id: "K12-R3", branch: "rebel", who: "帝国弓手", text: "可他们是叛军！" },
    { id: "K12-R4", branch: "rebel", who: "书记官", text: "我说，放下。……今天死在雾门镇的人，已经够多了。" },
    { id: "K12-R5", branch: "rebel", who: "书记官", text: "{name}。早上那份名单，你的名字是我后来添上去的。……往后，你的名字，得你自己去写了。" },
    { id: "K12-R6", branch: "rebel", who: "布伦", text: "这份情我记下了，帝国人。下回在战场上碰见，我让你先出手。" },
    { id: "K12-R7", branch: "rebel", who: "书记官", text: "但愿没有下回。——撤！回上面去，另找出路！" },
    { id: "K12-R8", branch: "rebel", who: "布伦", at: 18, cue: "the pursuers leave; the player may walk", text: "……一个帝国的书记官。这世道，我是越来越看不懂了。" },
    { id: "K12-R9", branch: "rebel", who: "布伦", text: "走吧。这条河总得流到个有天的地方。" },
    { id: "K12-I0", branch: "imperial", who: "霜誓军弓手", at: 0, cue: "off-screen", text: "他们要过河了——追！" },
    { id: "K12-I1", branch: "imperial", who: "霜誓军弓手", at: 6.5, text: "布伦，让我射死那只帝国耗子！" },
    { id: "K12-I2", branch: "imperial", who: "布伦", text: "住手。" },
    { id: "K12-I3", branch: "imperial", who: "霜誓军弓手", text: "他们差点砍了我们的头！" },
    { id: "K12-I4", branch: "imperial", who: "布伦", look: "player", cue: "looks at the player", text: "你旁边那位，今早也差点被砍了头。" },
    { id: "K12-I5", branch: "imperial", who: "布伦", text: "{name}。你跟错了人——不过，活下去。总有一天你会明白，北境该由谁来守。" },
    { id: "K12-I6", branch: "imperial", who: "伊沃", text: "铁桦！卡雅……她出去了吗？" },
    { id: "K12-I7", branch: "imperial", who: "布伦", text: "出去了。她说，有个帝国书记官放了她。……我起先还不信。——兄弟们，撤！" },
    { id: "K12-I8", branch: "imperial", who: "伊沃", at: 18, cue: "the pursuers leave; the player may walk", text: "……我还以为，那支箭会射过来。" },
    { id: "K12-I9", branch: "imperial", who: "伊沃", text: "我们和他们之间，隔着一条河了。也好。往前走吧——岩洞总有个尽头。" },
  ],
} as const satisfies Record<KeepBeat, readonly ScriptLine[]>;

export type KeepLineId = (typeof KEEP_SCRIPT)[KeepBeat][number]["id"];

const keep = makeScript(KEEP_SCRIPT);

/** Every keep line, in table order. */
export const KEEP_LINES = keep.all;
/** One keep line by id: `line("K1-I6")`. */
export const line = keep.line;
/** The lines of a keep beat on a route: `lines("K6", "imperial", { on: "cage", state: scriptState(flags) })`. */
export const lines = keep.lines;

/** The K0 nag pool (barks every 9 s from 20 s, alternating, at most 6; see `KEEP_TIMING.nag`). */
export const K0_NAGS = lines("K0", "both", { on: "nag" });

/** Texts for the cut list (§14): cut #4 turns the archers into melee and these replace the lines. */
export const KEEP_CUT_TEXT: Readonly<Partial<Record<KeepLineId, string>>> = {
  "K12-R1": "长官，他们就在对岸——",
  "K12-I1": "布伦，让我追过去！",
};

/** Interaction labels (§5.1 prompts); the HUD puts the activate key in front ("E 打开箱子"). */
export const KEEP_PROMPTS = {
  followBrun: "跟随布伦（霜誓军）",
  followScribe: "跟随书记官（帝国）",
  chest: "打开箱子",
  sword: "拿起 铁剑",
  axe: "拿起 战斧",
  shield: "拿起 鸢盾",
  armour: "穿上 皮甲",
  search: "搜查",
  cage: "打开笼子",
  read: "阅读",
  lever: "拉下拉杆",
} as const;

/** Toasts besides the objectives. */
export const KEEP_TOASTS = {
  /** K0: the player went more than 60 m from the forecourt and is faded back to the start */
  pushedBack: "浓烟把你逼了回来",
} as const;

/**
 * The keep's tips from the teaching ladder (§8) that belong to the chapter (the ones the fighting
 * itself raises are `COMBAT_TIPS` in combatHud.ts). Each shows once per id (`flags.tips`).
 */
export const KEEP_TIPS = {
  /** first weapon pickup */
  ready: { id: "keep.ready", text: "R 拔出/收起武器" },
  /** rebel E1, the 盾兵 */
  guardBreak: { id: "keep.guardBreak", text: "盾兵挡得住轻击——按住左键 重击可以破防" },
  /** imperial E1, the 斧手's lunge */
  lunge: { id: "keep.lunge", text: "斧手会突进——看准时机格挡招架，再趁其踉跄反击" },
  /** the storeroom */
  potion: { id: "keep.potion", text: "按 Q 饮用治疗药水" },
  /** E3 */
  sneak: { id: "keep.sneak", text: "按 C 潜行（设置中可改为切换）· 从背后接近未察觉的敌人，左键一击制敌" },
  /** E4 */
  ranged: { id: "keep.ranged", text: "弓箭无法招架——举盾，或躲到石柱后面" },
} as const;

/** A pool of barks (non-blocking, at least 4 s apart per speaker: the Director's default cooldown). */
export interface BarkPool {
  /** the label to show; enemy pools name the side, so show the NPC's own label (帝国盾兵 …) instead */
  readonly who: string;
  /** general lines, picked at random */
  readonly lines: readonly string[];
  /** situational lines */
  readonly taunt?: readonly string[];
  readonly downed?: readonly string[];
  readonly shieldWall?: readonly string[];
  readonly death?: readonly string[];
  readonly alert?: readonly string[];
  readonly surrender?: readonly string[];
}

/** Combat barks of the human fights (§5.3 "Combat barks", E2 barks, K10 alert barks; §7 specials). */
export const KEEP_BARKS = {
  /** companion on the rebel route; `taunt` = the 怒吼 special, `downed` at 0 HP */
  brun: {
    who: "布伦",
    lines: ["来啊，帝国佬！", "盾再厚，重斧照样劈开！", "他在蓄力——退开！", "好一斧！", "还站得住吗？"],
    taunt: ["冲我来！"],
    downed: ["还死不了！"],
  },
  /** companion on the imperial route; `shieldWall` = the 盾墙 special, `downed` at 0 HP */
  ivo: {
    who: "伊沃",
    lines: ["举盾！", "等他砍空了再还手！", "斧子来了——挡住！", "……我居然还站着。"],
    shieldWall: ["我、我挡着——快喝药！"],
    downed: ["我……我还能站起来。"],
  },
  /** imperial enemies (rebel route) */
  imperial: {
    who: "帝国兵",
    lines: ["以皇帝之名！", "放下武器！", "叛贼！", "按住他！"],
    death: ["啊……该死……"],
    alert: ["谁在那儿？！", "要塞里的人追下来了——拿家伙！"],
  },
  /** Frostsworn enemies (imperial route) */
  rebel: {
    who: "霜誓军",
    lines: ["帝国的狗！", "为了寒脊！", "霜誓不灭！", "砍了他！"],
    death: ["领主……大人……"],
    alert: ["帝国的狗追下来了！", "一个都别放走！"],
  },
  /** E2 */
  interrog: { who: "审讯官", lines: ["别躲，我下手很轻的。", "疼吗？这才刚开始。", "叛军的骨头，也没多硬。"] },
  /** E2; `surrender` at ≤ 30 % HP */
  assistant: { who: "审讯助手", lines: ["师傅救我！", "别、别过来！"], surrender: ["我投降！我只是给他烧火的！别杀我！"] },
} as const satisfies Record<string, BarkPool>;
