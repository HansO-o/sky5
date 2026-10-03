import { hud } from "../ui/hud";
import type { World } from "./World";

/**
 * While the player hangs back, `who` calls out one of `lines` every `every` game seconds, never over
 * a scripted line. The player is not hanging back once `ok()` holds, nor while `distance()` (if
 * given) keeps shrinking. Returns the stop function (call it in a finally).
 */
export function nag(world: World, who: string, lines: string[], ok: () => boolean, every = 12, distance?: () => number) {
  let t = 0, i = 0, shown = 0, line = "", best = Infinity;
  const sub = () => document.getElementById("subtitle");
  const ours = () => {
    const s = sub();
    return !!s && s.style.opacity !== "0" && !!line && !!s.textContent?.endsWith(line);
  };
  const off = world.onUpdate((dt) => {
    if (shown > 0 && (shown -= dt) <= 0 && ours()) hud.clearSubtitle();
    let fine = false, d = Infinity;
    try {
      fine = ok();
      d = distance?.() ?? Infinity;
    } catch {
      fine = true; // whatever it watches is gone: say nothing
    }
    // closing in counts as following
    if (d < best - 0.8) {
      best = d;
      t = 0;
    }
    if (fine) {
      t = 0;
      return;
    }
    if ((t += dt) < every) return;
    t = 0;
    best = d; // from here on, progress is measured again
    const s = sub();
    if (s && s.style.opacity === "1" && !ours()) return; // someone is speaking
    line = lines[i++ % lines.length];
    hud.subtitle(who, line, true);
    shown = 2.8;
  });
  return () => {
    off();
    if (shown > 0 && ours()) hud.clearSubtitle();
  };
}
