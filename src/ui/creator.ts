import { audio } from "../core/audio";
import { input } from "../core/input";
import { HAIR_COLORS, HAIR_STYLES, RACES, type Appearance } from "../world/appearance";

const CSS = `
#creator { position: fixed; right: 0; top: 0; bottom: 0; width: min(380px, 100vw); background: linear-gradient(90deg, rgba(0,0,0,0) 0, rgba(6,6,6,.88) 18%); padding: 28px 26px 28px 56px; overflow-y: auto; font-size: 14px; pointer-events: auto; }
#creator h2 { font-family: var(--serif); font-weight: 400; letter-spacing: .35em; margin: 0 0 14px; font-size: 21px; }
#creator h3 { font-family: var(--serif); font-weight: 400; color: var(--ink-dim); letter-spacing: .2em; font-size: 14px; margin: 18px 0 8px; }
#creator .races { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
#creator .chip { all: unset; cursor: pointer; text-align: center; padding: 7px 4px; border: 1px solid var(--line); color: var(--ink-dim); }
#creator .chip.on { border-color: #e9e4d8; color: #fff; background: rgba(255,255,255,.06); }
#creator .desc { color: var(--ink-dim); font-size: 12.5px; line-height: 1.6; min-height: 3.2em; margin-top: 8px; }
#creator .row { display: grid; grid-template-columns: 4.5em 1fr; gap: 10px; align-items: center; margin: 7px 0; }
#creator .row label { color: var(--ink-dim); }
#creator input[type=range] { width: 100%; accent-color: #cfc6b0; }
#creator .swatches { display: flex; gap: 6px; flex-wrap: wrap; }
#creator .sw { all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; }
#creator .sw.on { border-color: #fff; }
#creator input[type=text] { width: 100%; box-sizing: border-box; background: #0d0d0d; border: 1px solid var(--line); color: var(--ink); padding: 8px; font: inherit; font-size: 16px; }
#creator .actions { display: flex; gap: 10px; margin-top: 22px; }
#creator .actions button { flex: 1; cursor: pointer; background: #111; color: var(--ink); border: 1px solid var(--line); padding: 10px; font: inherit; letter-spacing: .2em; }
#creator .actions button.primary { border-color: #e9e4d8; }
#creator .hint { color: var(--ink-faint); font-size: 12px; margin-top: 10px; }
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
        <h2>你 是 谁 ？</h2>
        <h3>种族</h3>
        <div class="races">${RACES.map((r) => `<button class="chip ${r.id === a.race ? "on" : ""}" data-race="${r.id}">${r.name}</button>`).join("")}</div>
        <div class="desc">${race.desc}</div>
        <h3>性别</h3>
        <div class="races"><button class="chip ${a.sex === "m" ? "on" : ""}" data-sex="m">男</button><button class="chip ${a.sex === "f" ? "on" : ""}" data-sex="f">女</button></div>
        <h3>外貌</h3>
        ${slider("height", "身高", a.height)}${slider("build", "体格", a.build)}${slider("head", "头部", a.head)}${slider("skin", "肤色", a.skin * 2 - 1)}
        <h3>头发</h3>
        <div class="races">${styles.map((s, i) => `<button class="chip ${i === a.hair % styles.length ? "on" : ""}" data-hair="${i}">${s.name}</button>`).join("")}</div>
        <div class="swatches" style="margin-top:10px">${HAIR_COLORS.map((h, i) => `<button class="sw ${i === a.hairColor ? "on" : ""}" title="${h.name}" data-hc="${i}" style="background:rgb(${h.c.map((v) => Math.min(255, v * 200)).join(",")})"></button>`).join("")}</div>
        ${a.sex === "m" ? `<div class="row" style="margin-top:10px"><label>胡须</label><input type="checkbox" data-beard ${a.beard ? "checked" : ""}></div>` : ""}
        <h3>名字</h3>
        <input type="text" maxlength="12" placeholder="输入你的名字" value="${a.name.replace(/"/g, "&quot;")}">
        <div class="actions"><button data-act="random">随机</button><button class="primary" data-act="done">完成</button></div>
        <div class="hint">拖动画面或按 Q / E 旋转角色</div>`;
      root.querySelectorAll<HTMLButtonElement>("[data-race]").forEach((b) =>
        b.addEventListener("click", () => {
          a.race = b.dataset.race as Appearance["race"];
          a.hairColor = RACES.find((r) => r.id === a.race)!.hairColor;
          audio.uiTick("move");
          render();
          emit();
        }),
      );
      root.querySelectorAll<HTMLButtonElement>("[data-sex]").forEach((b) =>
        b.addEventListener("click", () => {
          if (a.sex === b.dataset.sex) return;
          a.sex = b.dataset.sex as Appearance["sex"];
          a.hair = 0;
          audio.uiTick("move");
          render();
          emit(true);
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
      root.querySelectorAll<HTMLButtonElement>("[data-hair]").forEach((b) =>
        b.addEventListener("click", () => {
          a.hair = +b.dataset.hair!;
          render();
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
      root.querySelector<HTMLInputElement>("[data-beard]")?.addEventListener("change", (e) => {
        a.beard = (e.target as HTMLInputElement).checked;
        emit();
      });
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
  return `<div class="row"><label>${label}</label><input type="range" min="-1" max="1" step="0.01" value="${v}" data-k="${k}"></div>`;
}
