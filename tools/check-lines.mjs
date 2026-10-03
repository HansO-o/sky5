// Fails (exit 1) when a string literal in src/**/*.ts(x) contains a banned phrase: lines and names too close
// to the game this prologue is inspired by. Runs before `vite build`:  node tools/check-lines.mjs
import fs from "node:fs";
import path from "node:path";
import { parseSync } from "vite";

const BANNED = [
  "你总算醒了", "越过边境", "一条船上", "北境真正的王", "乌鸦", "长桌", "银阁", "第二次机会", "进塔楼", "八条腿", "趴下",
  "飞走了", "从背后给它", "手痒", "回头路", "名单上没有这个人", "遗物送回", "认识过一个姑娘", "帝国的城墙", "灰鬃", "维雷",
  "卢西安", "马雷克",
];

const SRC = path.join(import.meta.dirname, "../src");

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) yield p;
  }
}

/** Every string literal, template-literal chunk and JSX text under `node`, with its source offset. */
function* strings(node) {
  if (Array.isArray(node)) {
    for (const n of node) yield* strings(n);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (node.type === "Literal" && typeof node.value === "string") yield { text: node.value, at: node.start };
  else if (node.type === "TemplateElement") yield { text: node.value.cooked ?? node.value.raw, at: node.start };
  else if (node.type === "JSXText") yield { text: node.value, at: node.start };
  for (const k in node) yield* strings(node[k]);
}

let bad = 0;
for (const file of files(SRC)) {
  const code = fs.readFileSync(file, "utf8");
  const rel = path.relative(process.cwd(), file);
  const { program, errors } = parseSync(file, code);
  if (errors.length) {
    console.error(`${rel}: parse error: ${errors[0].message}`);
    bad++;
    continue;
  }
  for (const { text, at } of strings(program)) {
    for (const p of BANNED) {
      if (!text.includes(p)) continue;
      const line = code.slice(0, at).split("\n").length;
      console.error(`${rel}:${line}: banned phrase 「${p}」 in ${JSON.stringify(text)}`);
      bad++;
    }
  }
}
if (bad) {
  console.error(`check-lines: ${bad} problem(s)`);
  process.exit(1);
}
console.log("check-lines: ok");
