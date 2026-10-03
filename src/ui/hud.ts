import { settings } from "../core/settings";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, id: string): HTMLElementTagNameMap[K] {
  let e = document.getElementById(id) as HTMLElementTagNameMap[K] | null;
  if (!e) {
    e = document.createElement(tag);
    e.id = id;
    document.getElementById("ui")!.appendChild(e);
  }
  return e;
}

/** Lightweight DOM overlays shared by all scenes. */
export const hud = {
  /** `force` shows the line even with subtitles off (lines without voice-over). */
  subtitle(who: string | null, text: string, force = false) {
    const s = el("div", "subtitle");
    if ((!settings.value.subtitles && !force) || !text) {
      s.style.opacity = "0";
      return;
    }
    s.innerHTML = "";
    if (who) {
      const w = document.createElement("span");
      w.className = "who";
      w.textContent = who + "：";
      s.appendChild(w);
    }
    s.appendChild(document.createTextNode(text));
    s.style.opacity = "1";
  },
  clearSubtitle() {
    el("div", "subtitle").style.opacity = "0";
  },
  /** Small corner indicator; never a full-screen loading screen. */
  loading(on: boolean, text = "加载中") {
    const h = el("div", "loadhint");
    if (!h.firstChild) h.innerHTML = "<i></i><span></span>";
    h.querySelector("span")!.textContent = text;
    h.classList.toggle("on", on);
  },
  fade(on: boolean, seconds = 1.2) {
    const f = el("div", "fade");
    f.style.transitionDuration = `${seconds}s`;
    f.classList.toggle("on", on);
    return new Promise<void>((r) => setTimeout(r, seconds * 1000));
  },
  /** Brief white-out (a shockwave, a blow to the head). */
  flash(strength = 0.8, seconds = 1.6) {
    const f = document.createElement("div");
    f.style.cssText = `position:fixed;inset:0;background:#fff;opacity:${strength};pointer-events:none;transition:opacity ${seconds}s ease-out;z-index:5`;
    document.getElementById("ui")!.appendChild(f);
    requestAnimationFrame(() => requestAnimationFrame(() => (f.style.opacity = "0")));
    setTimeout(() => f.remove(), seconds * 1000 + 100);
  },
  toast(text: string, ms = 4000) {
    const t = el("div", "toast");
    t.textContent = text;
    t.classList.add("on");
    clearTimeout((t as unknown as { _t: number })._t);
    (t as unknown as { _t: number })._t = window.setTimeout(() => t.classList.remove("on"), ms);
  },
  prompt(text: string | null) {
    const p = el("div", "prompt");
    p.textContent = text ?? "";
    p.classList.toggle("hidden", !text);
  },
  crosshair(on: boolean) {
    el("div", "crosshair").classList.toggle("hidden", !on);
  },
  downloadStatus(text: string) {
    el("div", "dlstatus").textContent = text;
  },
};
