// Original script for the cart ride. All names, places and lines are original.
//
// Cast (seats in the player's wagon):
//   布伦      rebel soldier of the Frostsworn, sits opposite the player
//   罗文      horse thief, front right
//   托尔瓦德  Frostsworn leader, hooded and gagged, front left
//   车夫      imperial driver

export type Speaker = "brun" | "rowan" | "driver" | "guard" | "captain";

export const SPEAKER_NAMES: Record<Speaker, string> = {
  brun: "布伦",
  rowan: "罗文",
  driver: "帝国车夫",
  guard: "城门守卫",
  captain: "帝国队长",
};

export interface Line {
  who: Speaker;
  text: string;
  /** Earliest start: seconds since the ride began. */
  t?: number;
  /** Earliest start: distance (m) remaining to the end of the road. */
  remaining?: number;
  /** Pause after the line before the next may start. */
  gap?: number;
  /** Character the speaker looks at: "player" (default) or another speaker. */
  look?: Speaker | "player" | "leader" | "ahead";
}

export const SCRIPT: Line[] = [
  { who: "brun", t: 5, text: "嘿，你。你总算醒了。" },
  { who: "brun", text: "想偷偷越过边境，是吧？结果一头撞进了帝国的埋伏——跟我们一样，还有那边那个贼。" },
  { who: "rowan", text: "该死的霜誓军。要不是你们闹事，北境本来太平得很。帝国的眼睛只盯着你们。", look: "brun", gap: 0.8 },
  { who: "rowan", text: "我本来已经偷到马了。再走半天，我就到山南了。", look: "player" },
  { who: "rowan", text: "你跟我，本来就不该在这儿。他们要抓的是这帮霜誓军。", look: "player", gap: 1.2 },
  { who: "brun", text: "现在我们是一条船上的人了，贼。", look: "rowan", gap: 1.5 },
  { who: "driver", text: "后面的，都给我闭嘴！", look: "ahead", gap: 2 },
  { who: "rowan", text: "……那他呢？他怎么不说话？嘴还被堵着。", look: "leader" },
  { who: "brun", text: "注意你的嘴。你面前坐着的是托尔瓦德·霜颌——寒脊的领主，北境真正的王。", look: "rowan", gap: 1 },
  { who: "rowan", text: "托尔瓦德？霜誓军的首领？……要是连他都被抓了……", look: "leader" },
  { who: "rowan", text: "诸神啊。他们要把我们押到哪儿去？", look: "player", gap: 1.5 },
  { who: "brun", text: "不知道。但不管去哪儿，前面等着我们的，多半是乌鸦。", look: "rowan", gap: 6 },

  { who: "brun", t: 120, text: "看那边的山口。年轻的时候，我在这片山里追过雪狐。", look: "player" },
  { who: "brun", text: "那时候，帝国的旗子还插不到这么北。", look: "player", gap: 1.5 },
  { who: "rowan", text: "你是哪儿人？", look: "brun" },
  { who: "brun", text: "雾门镇南边的溪谷。我爹在那儿有一片麦地，还有一窝蜂。", look: "rowan", gap: 1 },
  { who: "brun", text: "……要是死前能再喝一口溪谷的蜂蜜酒就好了。", look: "player", gap: 8 },

  { who: "captain", remaining: 470, text: "前面就是雾门镇。车队保持队形！", look: "ahead", gap: 1 },
  { who: "rowan", text: "雾门……不，不，不能是这儿。", look: "player", gap: 1 },
  { who: "brun", remaining: 330, text: "瞧，城墙上那个穿红披风的，是帝国的将军——卡西乌斯·维罗。", look: "ahead" },
  { who: "brun", text: "还有站在他身边的那几个精灵。银阁的使者。这一切少不了他们的份。", look: "player", gap: 2 },
  { who: "brun", remaining: 200, text: "雾门镇。我年轻时在这儿认识过一个姑娘，她会做最好的炖鹿肉……", look: "player", gap: 1.5 },
  { who: "guard", remaining: 110, text: "开门！押送犯人的车队到了！", look: "ahead", gap: 1 },
  { who: "brun", remaining: 70, text: "真奇怪。以前看到帝国的城墙，我还会觉得安心。", look: "player", gap: 1 },
  { who: "rowan", remaining: 35, text: "先祖在上，冬母在上……谁来救救我……", look: "leader", gap: 1 },
  { who: "driver", remaining: 6, text: "停车！所有人，下车！", look: "ahead", gap: 2 },
];

export function lineDuration(l: Line) {
  return Math.max(2.4, l.text.length * 0.19 + 0.8);
}
