import { audio } from "../core/audio";

/** A centred title between two ornament hairlines. */
export function heading(title: string, tag: "h2" | "h1" = "h2") {
  const d = document.createElement("div");
  d.className = "heading";
  const h = document.createElement(tag);
  h.textContent = title;
  d.append(orn("l"), h, orn("r"));
  return d;
}

export function orn(kind: "l" | "r" | "mid") {
  const i = document.createElement("i");
  i.className = `orn ${kind}`;
  return i;
}

/** Keeps a range input's filled part (CSS var --p) in step with its value. */
export function styleRange(i: HTMLInputElement) {
  const upd = () => i.style.setProperty("--p", `${((+i.value - +i.min) / (+i.max - +i.min || 1)) * 100}%`);
  i.addEventListener("input", upd);
  upd();
  return i;
}

/**
 * A vertical list of menu entries (grey, the selected one white with a soft band), driven by mouse,
 * arrow keys / W S and Enter. The keyboard handler goes away with the element.
 */
export function menuList(items: [string, () => void][], o: { blocked?: () => boolean } = {}) {
  const nav = document.createElement("div");
  nav.className = "menu-list";
  let sel = 0;
  const buttons = items.map(([label, fn], k) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("mouseenter", () => {
      if (sel !== k) audio.uiTick("move");
      set(k);
    });
    b.addEventListener("click", () => {
      audio.uiTick("select");
      fn();
    });
    nav.appendChild(b);
    return b;
  });
  const set = (k: number) => {
    sel = (k + buttons.length) % buttons.length;
    buttons.forEach((b, j) => b.classList.toggle("sel", j === sel));
  };
  set(0);
  const key = (e: KeyboardEvent) => {
    if (!nav.isConnected) return window.removeEventListener("keydown", key);
    if (o.blocked?.()) return;
    if (["ArrowUp", "KeyW"].includes(e.code)) {
      set(sel - 1);
      audio.uiTick("move");
    } else if (["ArrowDown", "KeyS"].includes(e.code)) {
      set(sel + 1);
      audio.uiTick("move");
    } else if (["Enter", "KeyE"].includes(e.code)) {
      e.preventDefault();
      buttons[sel].click();
    }
  };
  window.addEventListener("keydown", key);
  return nav;
}
