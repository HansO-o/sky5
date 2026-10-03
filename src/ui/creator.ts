import { audio } from "../core/audio";
import { input } from "../core/input";
import { styleRange } from "./widgets";
import { HAIR_COLORS, HAIR_STYLES, RACES, type Appearance } from "../world/appearance";

const CSS = `
#creator { position: fixed; left: 0; top: 0; bottom: 0; width: min(400px, 100vw); padding: 22px 54px 18px 34px; overflow-y: auto; font-size: 14px; pointer-events: auto;
  background: linear-gradient(90deg, rgba(3,3,3,.94) 0, rgba(3,3,3,.9) 78%, rgba(3,3,3,0) 100%); scrollbar-width: thin; scrollbar-color: var(--ink-faint) transparent; }
#creator .heading { margin-bottom: 8px; }
#creator .heading h2 { font-size: 20px; letter-spacing: .45em; }
#creator h3 { display: flex; align-items: center; gap: 12px; font-family: var(--display); font-weight: 400; color: var(--ink); letter-spacing: .4em; font-size: 13.5px; margin: 13px 0 4px; }
#creator h3::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, var(--line), transparent); }
#creator .list { display: flex; flex-direction: column; }
#creator .list button { all: unset; cursor: pointer; font-family: var(--display); letter-spacing: .4em; padding: 3px 12px; color: #77736c; transition: color .15s; }
#creator .list button:hover { color: var(--ink); }
#creator .list button.on { color: #fff; text-shadow: 0 0 12px var(--glow); background: linear-gradient(90deg, var(--band), transparent 85%); }
#creator .desc { color: var(--ink-dim); font-size: 12.5px; line-height: 1.6; min-height: 3.2em; margin: 4px 12px 2px; }
#creator .row { display: grid; grid-template-columns: 4em 1fr 2.6em; gap: 12px; align-items: center; min-height: 27px; padding: 0 12px; }
#creator .row:hover { background: linear-gradient(90deg, var(--band), transparent 90%); }
#creator .row label { color: var(--ink-dim); letter-spacing: .2em; }
#creator .row output { color: var(--ink-faint); font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
#creator .swatches { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
#creator .sw { all: unset; cursor: pointer; width: 17px; height: 17px; outline: 1px solid rgba(255,255,255,.12); outline-offset: 2px; }
#creator .sw.on { outline: 1px solid #fff; }
#creator input[type=text] { width: calc(100% - 24px); margin: 4px 12px; box-sizing: border-box; background: transparent; border: 0; border-bottom: 1px solid var(--line-strong); color: #fff; padding: 6px 2px; font: inherit; font-family: var(--display); font-size: 18px; letter-spacing: .25em; outline: none; }
#creator input[type=text]:focus { border-bottom-color: #fff; }
#creator input[type=text]::placeholder { color: var(--ink-faint); letter-spacing: .2em; font-size: 14px; }
#creator .actions { display: flex; justify-content: space-between; margin: 14px 12px 0; }
#creator .actions button { all: unset; cursor: pointer; font-family: var(--display); letter-spacing: .4em; color: var(--ink-dim); padding: 6px 0; }
#creator .actions button:hover { color: #fff; text-shadow: 0 0 12px var(--glow); }
#creator .actions button.primary { color: var(--ink); }
#creator .hint { display: flex; gap: 14px; align-items: center; color: var(--ink-faint); font-size: 12px; margin: 10px 12px 0; letter-spacing: .1em; }
`;

export interface CreatorCallbacks {
  onChange(a: Appearance, sexChanged: boolean): void;
  onRotate(delta: number): void;
}

/** Character creation panel. Resolves with the final appearance when the player confirms. */
export function openCreator(initial: Appearance, cb: CreatorCallbacks): Promise<Appearance> {
  if (!document.getElementById("creator-css")) {
    const st = document.createElement("style");
    st.id = "creator-css";
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const a: Appearance = { ...initial };
  const root = document.createElement("section");
  root.id = "creator";
  document.getElementById("ui")!.appendChild(root);
  input.releaseLock();

  return new Promise((resolve) => {
    let dragging = false, lastX = 0;
    const canvas = document.getElementById("scene")!;
    const down = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      cb.onRotate((e.clientX - lastX) * 0.01);
      lastX = e.clientX;
    };
    const up = () => (dragging = false);
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" && (e.target as HTMLInputElement).type === "text") return;
      if (e.code === "KeyQ") cb.onRotate(-0.25);
      if (e.code === "KeyE") cb.onRotate(0.25);
    };
    canvas.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);

    const emit = (sexChanged = false) => cb.onChange({ ...a }, sexChanged);
    const render = () => {
      const race = RACES.find((r) => r.id === a.race)!;
      const styles = HAIR_STYLES[a.sex];
      root.innerHTML = `
        <div class="heading"><i class="orn l"></i><h2>你是谁</h2><i class="orn r"></i></div>
        <h3>种族</h3>
        <div class="list">${RACES.map((r) => `<button class="${r.id === a.race ? "on" : ""}" data-race="${r.id}">${r.name}</button>`).join("")}</div>
        <div class="desc">${race.desc}</div>
        <div class="row"><label>性别</label><div class="stepper"><button data-sex-step="-1">◀</button><span>${a.sex === "m" ? "男" : "女"}</span><button data-sex-step="1">▶</button></div><output></output></div>
        <h3>外貌</h3>
        ${slider("height", "身高", a.height)}${slider("build", "体格", a.build)}${slider("head", "头部", a.head)}${slider("skin", "肤色", a.skin * 2 - 1)}
        <h3>头发</h3>
        <div class="row"><label>发型</label><div class="stepper"><button data-hair-step="-1">◀</button><span>${styles[a.hair % styles.length].name}</span><button data-hair-step="1">▶</button></div><output></output></div>
        ${a.sex === "m" ? `<div class="row"><label>胡须</label><div class="stepper"><button data-beard>◀</button><span>${a.beard ? "有" : "无"}</span><button data-beard>▶</button></div><output></output></div>` : ""}
        <div class="row"><label>发色</label><div class="swatches">${HAIR_COLORS.map((h, i) => `<button class="sw ${i === a.hairColor ? "on" : ""}" title="${h.name}" data-hc="${i}" style="background:rgb(${h.c.map((v) => Math.min(255, v * 200)).join(",")})"></button>`).join("")}</div><output></output></div>
        <h3>名字</h3>
        <input type="text" maxlength="12" placeholder="输入你的名字" value="${a.name.replace(/"/g, "&quot;")}">
        <div class="actions"><button data-act="random">随机</button><button class="primary" data-act="done">完成</button></div>
        <div class="hint"><span><kbd>Q</kbd> <kbd>E</kbd> 旋转</span><span>拖动画面也可旋转</span></div>`;
      root.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((r) => {
        styleRange(r);
        const o = r.parentElement!.querySelector("output")!;
        const show = () => (o.textContent = String(Math.round((+r.value + 1) * 50)));
        r.addEventListener("input", show);
        show();
      });
      root.querySelectorAll<HTMLButtonElement>("[data-race]").forEach((b) =>
        b.addEventListener("click", () => {
          a.race = b.dataset.race as Appearance["race"];
          a.hairColor = RACES.find((r) => r.id === a.race)!.hairColor;
          audio.uiTick("move");
          render();
          emit();
        }),
      );
      root.querySelectorAll<HTMLButtonElement>("[data-sex-step]").forEach((b) =>
        b.addEventListener("click", () => {
          a.sex = a.sex === "m" ? "f" : "m";
          a.hair = 0;
          audio.uiTick("move");
          render();
          emit(true);
        }),
      );
      root.querySelectorAll<HTMLButtonElement>("[data-hair-step]").forEach((b) =>
        b.addEventListener("click", () => {
          const n = HAIR_STYLES[a.sex].length;
          a.hair = (((a.hair % n) + +b.dataset.hairStep! + n) % n);
          audio.uiTick("move");
          render();
          emit();
        }),
      );
      root.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((r) =>
        r.addEventListener("input", () => {
          const v = +r.value;
          const k = r.dataset.k as "height" | "build" | "head" | "skin";
          if (k === "skin") a.skin = (v + 1) / 2;
          else a[k] = v;
          emit();
        }),
      );
      root.querySelectorAll<HTMLButtonElement>("[data-hc]").forEach((b) =>
        b.addEventListener("click", () => {
          a.hairColor = +b.dataset.hc!;
          render();
          emit();
        }),
      );
      root.querySelectorAll<HTMLButtonElement>("[data-beard]").forEach((b) =>
        b.addEventListener("click", () => {
          a.beard = !a.beard;
          audio.uiTick("move");
          render();
          emit();
        }),
      );
      const name = root.querySelector<HTMLInputElement>("input[type=text]")!;
      name.addEventListener("input", () => (a.name = name.value.trim()));
      root.querySelector<HTMLButtonElement>("[data-act=random]")!.addEventListener("click", () => {
        const sexBefore = a.sex;
        const r = RACES[Math.floor(Math.random() * RACES.length)];
        a.race = r.id;
        a.sex = Math.random() < 0.5 ? "m" : "f";
        a.height = Math.random() * 2 - 1;
        a.build = Math.random() * 2 - 1;
        a.head = Math.random() * 1.2 - 0.6;
        a.skin = Math.random();
        a.hair = Math.floor(Math.random() * HAIR_STYLES[a.sex].length);
        a.hairColor = Math.floor(Math.random() * HAIR_COLORS.length);
        a.beard = Math.random() < 0.6;
        audio.uiTick("select");
        render();
        emit(a.sex !== sexBefore);
      });
      root.querySelector<HTMLButtonElement>("[data-act=done]")!.addEventListener("click", () => {
        if (!a.name) {
          name.focus();
          name.placeholder = "请先输入名字";
          return;
        }
        audio.uiTick("select");
        canvas.removeEventListener("pointerdown", down);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("keydown", key);
        root.remove();
        resolve({ ...a });
      });
    };
    render();
  });
}

function slider(k: string, label: string, v: number) {
  return `<div class="row"><label>${label}</label><input type="range" min="-1" max="1" step="0.01" value="${v}" data-k="${k}"><output></output></div>`;
}
