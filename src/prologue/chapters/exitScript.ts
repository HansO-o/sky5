// Original script for the exit chapter (出洞): every line of design §6.2, both routes, as data, plus
// the end card. docs/design/keep-exit-chapters.md is the source. Pure data and small helpers (no
// Babylon): exit.ts plays these through the Director. The conventions (routes, `{name}`, speaker
// labels, `on` / `when`) are the keep script's: see the top of keepScript.ts.

import type { PrologueFlags } from "../flags";
import { makeScript, type BarkPool, type BeatInfo, type BeatObjective, type Faction, type ScriptLine } from "./keepScript";

export { DEFAULT_NAME, fill, objectiveOf, plays, scriptState } from "./keepScript";
export type { Branch, Faction, LinesOptions, ScriptLine, ScriptState, Trigger, When, Who } from "./keepScript";

export type ExitBeat = "X0" | "X1" | "X2" | "X3" | "X4";

const same = (...steps: string[]): BeatObjective => ({ rebel: steps, imperial: steps });

/** The beat sheet (§6.1). */
export const EXIT_BEATS: readonly BeatInfo<ExitBeat>[] = [
  { id: "X0", title: "暗河", objective: same("沿着河道深入岩洞") },
  { id: "X1", title: "蛛巢", steps: [1, 2], objective: same("斩开蛛网", "击败蜘蛛", "斩开另一侧的蛛网") },
  { id: "X2", title: "狼穴", steps: [3, 4], objective: same("潜行绕过沉睡的巨狼（或与之一战）") },
  { id: "X3", title: "长坡", objective: same("循着风找到出口") },
  { id: "X4", title: "天光", steps: [5], objective: { rebel: ["前往溪谷的柳溪村，找到铁桦家的蜂场"], imperial: ["随伊沃前往石桥堡"] } },
];

/** Timings for the lines (§6.1, §6.3), in seconds; wolf values are the noise meter's. */
export const EXIT_TIMING = {
  /** X1: the phase A bark comes 0.6 s after the ambush trigger (small spiders at 1.0 and 4.0 s) */
  ambush: { bark: 0.6 },
  /** X2: stir line at meter 0.5, calm line back under 0.2, wake at 1.0, flee hint 6 s after waking; satchel line within 10 m */
  wolf: { stir: 0.5, calm: 0.2, wake: 1, fleeHint: 6, satchel: 10 },
  /** X4 platform: X4-1 at 0, X4-2 with the dragon overhead (≈ 11.5), X4-3 at the roar (≈ 19), closing lines 23 → ≈ 68, then the toast held 4 s */
  platform: { first: 0, overhead: 11.5, roar: 19, closing: 23, closingEnd: 68, endHold: 4 },
} as const;

export const EXIT_SCRIPT = {
  X0: [
    { id: "X0-R1", branch: "rebel", who: "布伦", text: "小时候，溪谷的老人讲过龙的故事。我一直当那是哄孩子睡觉的。" },
    { id: "X0-R2", branch: "rebel", who: "布伦", text: "故事里说，龙飞过的地方，连石头都会哭。" },
    { id: "X0-R3", branch: "rebel", who: "布伦", text: "……今天，我听见石头哭了。" },
    { id: "X0-R4", branch: "rebel", on: "fungus", optional: true, who: "布伦", cue: "at the fungus; cut #1", text: "这些发光的蘑菇，小时候我拿它们当灯笼。别吃——吃了你会看见死去的祖奶奶。" },
    { id: "X0-I1", branch: "imperial", who: "伊沃", text: "我在帝都念过史书。书上说，最后一条龙死在三百年前。" },
    { id: "X0-I2", branch: "imperial", who: "伊沃", text: "我在书记处抄了十年公文，从没有哪一份写过“龙”这个字。" },
    { id: "X0-I3", branch: "imperial", who: "伊沃", text: "要是书上写错了……那我这些年抄下来的东西，还有多少是真的？" },
    { id: "X0-I4", branch: "imperial", who: "伊沃", text: "……抱歉。我一紧张，话就多。" },
  ],
  X1: [
    { id: "X1-R1", branch: "rebel", who: "布伦", text: "蛛网……这么厚的网，可不是普通蜘蛛织得出来的。" },
    { id: "X1-R2", branch: "rebel", who: "布伦", text: "用刀砍开，别拿手扯。" },
    { id: "X1-I1", branch: "imperial", who: "伊沃", text: "这网有一人多高……我开始盼着书上写的全是错的了。" },
    { id: "X1-I2", branch: "imperial", who: "伊沃", text: "砍开它。我……我在后面给你照亮。" },
    { id: "X1-L", branch: "both", on: "cocoon", optional: true, who: "信件", cue: "the courier's letter from the cocoon", text: "北面山口有巨物掠过，翼展如帆，羊群尽失。驿站请示：可否上报？——批：勿传，免乱民心。" },
    { id: "X1-R3", branch: "rebel", on: "cocoon", optional: true, who: "布伦", text: "半个月前就有人看见了。帝国把消息压了下来。" },
    { id: "X1-I3", branch: "imperial", on: "cocoon", optional: true, who: "伊沃", text: "这是守备处的批文格式……这个字迹，是我们处长的。他早就知道。" },
    { id: "X1-R4", branch: "rebel", on: "phaseA", at: 0.6, who: "布伦", text: "墙缝里有东西——小的先来了！" },
    { id: "X1-R5", branch: "rebel", on: "phaseB", who: "布伦", text: "上面！大的下来了！" },
    { id: "X1-I5", branch: "imperial", on: "phaseA", at: 0.6, who: "伊沃", text: "墙、墙里有东西在爬——" },
    { id: "X1-I6", branch: "imperial", on: "phaseB", who: "伊沃", text: "头顶！它从上面下来了！" },
    { id: "X1-R6", branch: "rebel", on: "after", who: "布伦", text: "呸……我宁可再上一回断头台。" },
    { id: "X1-I7", branch: "imperial", on: "after", who: "伊沃", text: "我……我要把这个写进书里。用很大的字。" },
  ],
  X2: [
    { id: "X2-R1", branch: "rebel", who: "布伦", cue: "whisper", text: "嘘——蹲下。听见那喘气声没有？" },
    { id: "X2-R2", branch: "rebel", who: "布伦", text: "是头狼。个头赶得上一匹马，睡得正沉。我们的命，现在就挂在它的鼾声上。" },
    { id: "X2-R3", branch: "rebel", who: "布伦", text: "贴着左边的石壁走，慢点。别踩那些骨头。" },
    { id: "X2-I1", branch: "imperial", who: "伊沃", cue: "whisper", text: "停……前面有东西在喘气。" },
    { id: "X2-I2", branch: "imperial", who: "伊沃", text: "狼……这么大的狼。我这把剑在它面前，就是根牙签。" },
    { id: "X2-I3", branch: "imperial", who: "伊沃", text: "贴着左边的石壁，蹲着走。轻点——求你了。" },
    { id: "X2-R4", branch: "rebel", on: "satchel", optional: true, who: "布伦", cue: "the player looks at the satchel within 10 m", text: "那个包就在它鼻子底下……你真要去拿？" },
    { id: "X2-I4", branch: "imperial", on: "satchel", optional: true, who: "伊沃", cue: "the player looks at the satchel within 10 m", text: "那是猎人的背包。他大概……没能走出去。" },
    { id: "X2-R5", branch: "rebel", on: "stir", who: "布伦", text: "……别动。" },
    { id: "X2-I5", branch: "imperial", on: "stir", who: "伊沃", text: "……别、别动。" },
    { id: "X2-R6", branch: "rebel", on: "calm", who: "布伦", cue: "meter back under 0.2", text: "好……它又睡了。走。" },
    { id: "X2-I6", branch: "imperial", on: "calm", who: "伊沃", cue: "meter back under 0.2", text: "它……又睡着了。" },
    { id: "X2-R7", branch: "rebel", on: "wake", who: "布伦", text: "醒了——别站在它正面！" },
    { id: "X2-I7", branch: "imperial", on: "wake", who: "伊沃", text: "你、你把它吵醒了！——散开！" },
    { id: "X2-R8", branch: "rebel", on: "wake", at: 6, who: "布伦", cue: "flee hint, 6 s after the wake", text: "往上跑！它不会离窝太远！" },
    { id: "X2-I8", branch: "imperial", on: "wake", at: 6, who: "伊沃", cue: "flee hint, 6 s after the wake", text: "往上跑！它不会追出它的窝！" },
    { id: "X2-R9", branch: "rebel", on: "passed", who: "布伦", cue: "passed unseen", text: "……我憋了一口气，憋得眼前直冒金星。" },
    { id: "X2-I9", branch: "imperial", on: "passed", who: "伊沃", cue: "passed unseen", text: "我们过来了……我们居然过来了。" },
    { id: "X2-R10", branch: "rebel", on: "killed", who: "布伦", text: "这身皮毛够做一件过冬的大氅。可惜，没工夫剥。" },
    { id: "X2-I10", branch: "imperial", on: "killed", who: "伊沃", text: "……从今往后，我再也不笑话猎人了。" },
    { id: "X2-R11", branch: "rebel", on: "leashed", who: "布伦", text: "它回窝了。走，别回头！" },
    { id: "X2-I11", branch: "imperial", on: "leashed", who: "伊沃", text: "它回去了……快走，趁它还没改主意。" },
  ],
  X3: [
    { id: "X3-R1", branch: "rebel", who: "布伦", text: "闻到没有？松脂味。是外面的风。" },
    { id: "X3-R2", branch: "rebel", who: "布伦", text: "从早上被扔上囚车起，我一直在想：要是能再看一眼天就好了。" },
    { id: "X3-R3", branch: "rebel", on: "bend", who: "布伦", cue: "stops at the bend and lets the player go first", text: "你先走。是你一路把我们带到这儿的。" },
    { id: "X3-I1", branch: "imperial", who: "伊沃", text: "有风……是暖的。不——是烟。是镇子烧起来的烟。" },
    { id: "X3-I2", branch: "imperial", who: "伊沃", text: "出去以后，我得把今天的事一件件记下来。总得有人记下来。" },
    { id: "X3-I3", branch: "imperial", on: "bend", who: "伊沃", cue: "stops at the bend and lets the player go first", text: "你先请。今天的头一口新鲜空气，该归你。" },
  ],
  X4: [
    { id: "X4-R1", branch: "rebel", who: "布伦", at: 0, text: "雾门镇……" },
    { id: "X4-R2", branch: "rebel", who: "布伦", at: 11.5, cue: "dragon overhead, whisper", text: "……别出声。" },
    { id: "X4-R3", branch: "rebel", who: "布伦", at: 19, text: "……它根本没低头看。在它眼里，我们跟石头没两样。" },
    { id: "X4-R4", branch: "rebel", who: "布伦", at: 23, look: "player", text: "领主大人是从塔楼另一头逃出去的，我亲眼看见。他会回寒脊……我得去找他。" },
    { id: "X4-R5", branch: "rebel", who: "布伦", look: "player", text: "听着，{name}。顺着这道山脊往南，下到溪谷，有个村子叫柳溪。我爹的蜂场，就在村子东头。" },
    { id: "X4-R6", branch: "rebel", who: "布伦", look: "player", text: "跟他说是布伦让你去的。他会给你一张床，一碗热汤……还有一杯溪谷最好的蜂蜜酒。" },
    { id: "X4-R7", branch: "rebel", who: "布伦", look: "player", text: "在车上我说过，死前想再喝一口。现在看来——咱们得活着喝。" },
    { id: "X4-R8", branch: "rebel", who: "布伦", look: "player", text: "还有……那个书记官要是也活着——算了。等我想好了，自己跟他说。" },
    { id: "X4-R9", branch: "rebel", who: "布伦", look: "player", text: "去吧，朋友。从今天起，北境的天空不一样了。" },
    { id: "X4-I1", branch: "imperial", who: "伊沃", at: 0, text: "诸神在上……整座镇子……" },
    { id: "X4-I2", branch: "imperial", who: "伊沃", at: 11.5, cue: "dragon overhead", text: "它……就在我们头顶上……" },
    { id: "X4-I3", branch: "imperial", who: "伊沃", at: 19, text: "它连看都没看我们一眼。……对它来说，整座镇子不过是路过。" },
    { id: "X4-I4", branch: "imperial", who: "伊沃", at: 23, look: "player", text: "维罗将军要是还活着，一定会撤到石桥堡。龙回来了——这件事得由我亲手写，亲手送到。" },
    { id: "X4-I5", branch: "imperial", who: "伊沃", look: "player", text: "{name}，跟我一起走吧。有我作证，没人会再把你押上刑台。" },
    { id: "X4-I6", branch: "imperial", who: "伊沃", look: "player", text: "还有这个。" },
    { id: "X4-I7", branch: "imperial", who: "伊沃", look: "player", cue: "unfolds the list; the stroke crosses the name over 1.2 s", text: "早上那份名单。你的名字是我添上去的……现在，我亲手把它划掉。" },
    { id: "X4-I8", branch: "imperial", who: "伊沃", look: "player", text: "从今往后，你的名字只属于你自己。" },
    { id: "X4-I9", branch: "imperial", when: "letter", optional: true, who: "伊沃", look: "player", cue: "cut #3", text: "那封信……你还带着？留着吧。等到了石桥堡，我亲手寄。" },
    { id: "X4-I10", branch: "imperial", who: "伊沃", look: "player", text: "布伦……他放过我们一次。我会在报告里写上这一笔——虽然不会有人爱看。" },
    { id: "X4-I11", branch: "imperial", who: "伊沃", look: "player", text: "沿着山脚往东，顺着河走两天，就能看见石桥堡的塔楼。……走吧。" },
  ],
} as const satisfies Record<ExitBeat, readonly ScriptLine[]>;

export type ExitLineId = (typeof EXIT_SCRIPT)[ExitBeat][number]["id"];

const exit = makeScript(EXIT_SCRIPT);

/** Every exit line, in table order. */
export const EXIT_LINES = exit.all;
/** One exit line by id: `line("X4-I7")`. */
export const line = exit.line;
/** The lines of an exit beat on a route: `lines("X2", "rebel", { on: "stir" })`. */
export const lines = exit.lines;

/** Spider-fight barks of the companions (§6.2). */
export const EXIT_BARKS = {
  brun: { who: "布伦", lines: ["砍它的腿！", "别让它扑到你身上！", "呸！这玩意儿的血是绿的！"] },
  ivo: { who: "伊沃", lines: ["它要扑了——举盾！", "火！它们怕火！", "书上没写它们会跳！"] },
} as const satisfies Record<string, BarkPool>;

/** The exit's tip from the teaching ladder (§8); shown once (`flags.tips`). */
export const EXIT_TIPS = {
  /** the den */
  wolf: { id: "exit.wolf", text: "潜行时脚步最轻；走动会惊动它，奔跑会吵醒它" },
} as const;

/**
 * The paper prop Ivo carries (K6 warrant hand, X4-I7): this morning's execution list. `{name}` and
 * `{homeland}` are filled with `fill` (homeland = playerBody's `homeland(appearance)`). The spec asks
 * for "two filler names" without naming them; the two below are placeholders of this script.
 */
export const EXECUTION_LIST = {
  heading: "雾门镇 · 今晨处决名单",
  rows: ["托尔瓦德·霜颌 寒脊领主", "布伦·铁桦 溪谷人", "罗文 山南人", "欧达·冷泉 寒脊人", "米洛什 山南人", "{name} {homeland}人 ——添"],
  /** the handwritten row the stroke crosses at X4-I7 */
  struck: 5,
  /** seconds the stroke takes to cross it */
  strokeSeconds: 1.2,
} as const;

type Outcomes = PrologueFlags["outcomes"];

/** The end card (§6.2; replaces PrologueStage's placeholder). */
export const END_CARD = {
  title: "雾门镇 · 序章 · 完",
  epilogue: {
    rebel: "你随布伦·铁桦逃出了雾门镇。北方，龙影未散。",
    imperial: "你随书记官伊沃·塔兰逃出了雾门镇。你的名字，已从名单上划去。",
  },
  /** the summary line's values */
  faction: { rebel: "霜誓军", imperial: "帝国" },
  torture: { killed: "审讯官伏诛", bluff: "一张空白手令", fought: "刀兵相见" },
  beast: { asleep: "未被惊醒", killed: "被击杀", fled: "从狼口逃生", skipped: "—" },
  /** the route not taken */
  otherPath: { rebel: "另一条路仍在等你：跟随伊沃", imperial: "另一条路仍在等你：跟随布伦" },
  /** starts `keep` at step 0 with the same appearance, fresh flags, the other NPC highlighted */
  replay: "从要塞重玩（另一条路）",
  menu: "返回主菜单",
} as const satisfies {
  epilogue: Record<Faction, string>;
  faction: Record<Faction, string>;
  torture: Record<NonNullable<Outcomes["torture"]>, string>;
  beast: Record<NonNullable<Outcomes["beast"]>, string>;
  otherPath: Record<Faction, string>;
  [k: string]: unknown;
};

/** 阵营 霜誓军 · 审讯室 审讯官伏诛 · 巨狼 未被惊醒 · 倒下 2 次 (unknown outcomes show —). */
export function endSummary(o: { faction: Faction; torture?: Outcomes["torture"]; beast?: Outcomes["beast"]; deaths: number }): string {
  const torture = o.torture ? END_CARD.torture[o.torture] : "—";
  const beast = o.beast ? END_CARD.beast[o.beast] : "—";
  return [`阵营 ${END_CARD.faction[o.faction]}`, `审讯室 ${torture}`, `巨狼 ${beast}`, `倒下 ${o.deaths} 次`].join(" · ");
}

/** The end card's texts for a finished run (a run without a faction counts as rebel, like `keep.skip()`). */
export function endCard(f: Pick<PrologueFlags, "faction" | "outcomes" | "deaths">) {
  const faction: Faction = f.faction ?? "rebel";
  const deaths = Object.values(f.deaths).reduce((n, d) => n + d, 0);
  return {
    title: END_CARD.title,
    epilogue: END_CARD.epilogue[faction],
    summary: endSummary({ faction, torture: f.outcomes.torture, beast: f.outcomes.beast, deaths }),
    otherPath: END_CARD.otherPath[faction],
    replay: END_CARD.replay,
    menu: END_CARD.menu,
  };
}
