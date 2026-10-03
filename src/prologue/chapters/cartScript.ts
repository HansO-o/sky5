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
  /** Earliest start: distance (m) left to the end of the ride (CartChapter's `end`, RIDE_END short of the road's end). */
  remaining?: number;
  /** Pause after the line before the next may start. */
  gap?: number;
  /** Character the speaker looks at: "player" (default) or another speaker. */
  look?: Speaker | "player" | "leader" | "ahead";
}

export const SCRIPT: Line[] = [
  { who: "brun", t: 5, text: "……还喘着气？那就好。这一路颠得，我还以为你撑不过山口。" },
  { who: "brun", text: "你是在山口林子里被逮住的吧？帝国那天撒了网，网里不止我们，还有那个偷马的。" },
  { who: "rowan", text: "都怪你们这些发了誓的疯子。帝国满山搜你们，顺手把我这种小人物也兜了进来。", look: "brun", gap: 0.8 },
  { who: "rowan", text: "那匹灰马都快被我驯服了，再给我一个晚上，我就过了河。", look: "player" },
  { who: "rowan", text: "你跟我，本来就不该在这儿。他们要抓的是这帮霜誓军。", look: "player", gap: 1.2 },
  { who: "brun", text: "绳子绑在你手上和绑在我手上，是同一个结，贼。", look: "rowan", gap: 1.5 },
  { who: "driver", text: "后面的，都给我闭嘴！", look: "ahead", gap: 2 },
  { who: "rowan", text: "……那他呢？他怎么不说话？嘴还被堵着。", look: "leader" },
  { who: "brun", text: "说话放尊重点。那是托尔瓦德·霜颌，寒脊每座山头都认得这个名字。", look: "rowan", gap: 1 },
  { who: "rowan", text: "霜颌……那个在寒脊烧了帝国税仓的人？……连他都被捆上了车……", look: "leader" },
  { who: "rowan", text: "诸神啊。他们要把我们押到哪儿去？", look: "player", gap: 1.5 },
  { who: "brun", text: "不知道。不过看这条路的方向……他们没打算让我们走回来。", look: "rowan", gap: 6 },

  { who: "brun", t: 120, text: "看那边的山口。年轻的时候，我在这片山里追过雪狐。", look: "player" },
  { who: "brun", text: "那时候，帝国的旗子还插不到这么北。", look: "player", gap: 1.5 },
  { who: "rowan", text: "你是哪儿人？", look: "brun" },
  { who: "brun", text: "雾门镇南边的溪谷。我爹在那儿有一片麦地，还有一窝蜂。", look: "rowan", gap: 1 },
  { who: "brun", text: "……要是死前能再喝一口溪谷的蜂蜜酒就好了。", look: "player", gap: 8 },

  { who: "captain", remaining: 470, text: "前面就是雾门镇。车队保持队形！", look: "ahead", gap: 1 },
  { who: "rowan", text: "雾门……不，不，不能是这儿。", look: "player", gap: 1 },
  { who: "brun", remaining: 330, text: "城墙上披红斗篷的那个，就是卡西乌斯·维罗。帝国派到北境的一把刀。", look: "ahead" },
  { who: "brun", text: "城门上又加了一道新闸。帝国这回是真想把我们关死在北境。", look: "player", gap: 2 },
  { who: "brun", remaining: 200, text: "雾门镇……我头一回卖蜂蜜，就是在这儿的集市上。被人骗了个精光。", look: "player", gap: 1.5 },
  { who: "guard", remaining: 110, text: "开门！押送犯人的车队到了！", look: "ahead", gap: 1 },
  { who: "brun", remaining: 70, text: "小时候我以为这道墙是用来挡狼的。现在才知道，它挡的是我们。", look: "player", gap: 1 },
  { who: "rowan", remaining: 35, text: "不……不……我只偷了一匹马……一匹马而已……", look: "leader", gap: 1 },
  { who: "driver", remaining: 6, text: "停车！所有人，下车！", look: "ahead", gap: 2 },
];

export function lineDuration(l: Line) {
  return Math.max(2.4, l.text.length * 0.19 + 0.8);
}
