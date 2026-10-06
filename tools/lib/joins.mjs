// Joins between assets built by different build steps, checked by tools/build-assets.mjs before the
// manifest is written. With --only a step can be reused from the last manifest while the step it
// joins is rebuilt, so the gate compares what the two shipped files record.

const box = (b) => `x ${b.min[0]}…${b.max[0]}, y ${b.min[1]}…${b.max[1]}, z ${b.min[2]}…${b.max[2]}`;
const REBUILD = "Rebuild both steps: node tools/build-assets.mjs --only=keep/,cave/";

/**
 * The drain mouth: tools/gen/cave.mjs clips the cave to the keep's drain opening (keepinterior.mjs AIR
 * room "drain", world) as it was when the cave/ step ran. cave/anchors records that rectangle
 * (joins.drain.keep) and the cave's actual opening at the drain plane (stats.breach.bbox, [x0, x1, y0,
 * y1], inset 1–2 cm). keep/anchors records the shipped room (rooms.drain worldMin/worldMax). The
 * recorded rectangle must equal the keep's within 2 mm and the opening must fill it within 8 cm (as
 * cave.mjs validates), or the breach shows a crack or an overlap. `sourceDrain` ({min, max}, world)
 * stands in for keep/anchors when that file has no rooms.drain. Returns {ok, message}.
 */
export function checkDrainJoin(caveAnchors, keepAnchors, sourceDrain = null) {
  const cave = caveAnchors?.joins?.drain?.keep, bb = caveAnchors?.stats?.breach?.bbox;
  if (!cave && !bb) return { ok: false, message: "drain join: cave/anchors records neither joins.drain nor stats.breach; rebuild it: node tools/build-assets.mjs --only=cave/" };
  const room = keepAnchors?.rooms?.drain;
  let keep = room?.worldMin && room?.worldMax ? { min: room.worldMin, max: room.worldMax } : null;
  let from = "keep/anchors rooms.drain";
  if (!keep && sourceDrain) {
    keep = sourceDrain;
    from = "tools/gen/keepinterior.mjs AIR drain (keep/anchors has no rooms.drain)";
  }
  if (!keep) return { ok: false, message: "drain join: neither keep/anchors rooms.drain nor keepinterior.mjs AIR has the drain room; update checkDrainJoin (tools/lib/joins.mjs) to the keep's new layout" };
  if (cave) {
    let off = 0;
    for (let i = 0; i < 3; i++) off = Math.max(off, Math.abs(cave.min[i] - keep.min[i]), Math.abs(cave.max[i] - keep.max[i]));
    if (!(off <= 2e-3)) return { ok: false, message: `drain join: cave/anchors was built against the keep's drain opening ${box(cave)}, but ${from} has ${box(keep)} (off by ${off.toFixed(3)} m): the breach would crack or overlap. ${REBUILD}` };
  }
  if (bb) {
    const off = Math.max(Math.abs(bb[0] - keep.min[0]), Math.abs(bb[1] - keep.max[0]), Math.abs(bb[2] - keep.min[1]), Math.abs(bb[3] - keep.max[1]));
    if (!(off <= 0.08)) return { ok: false, message: `drain join: the cave's drain opening (cave/anchors stats.breach.bbox x ${bb[0]}…${bb[1]}, y ${bb[2]}…${bb[3]}) does not fit ${from} ${box(keep)} (off by ${off.toFixed(3)} m). ${REBUILD}` };
  }
  return { ok: true, message: `drain join: cave/anchors and ${from} agree (${box(keep)}${cave ? "" : "; opening bbox only, cave/anchors predates joins.drain"})` };
}

/**
 * The props join: tools/gen/props.mjs places and validates every prop against shipped files (the cave
 * and keep anchors and rooms, the cave's rock field via cave/mesh_a) and records their sha256 in
 * props/meta joins.inputs. With --only either side can be rebuilt alone, so every recorded input must
 * still be the file the manifest ships, and every id in `required` (props.mjs PROPS_INPUTS) must be
 * recorded. `assets`: the manifest entries. Returns {ok, message}.
 */
export function checkPropsJoin(propsMeta, assets, required = []) {
  const fix = "rebuild it: node tools/build-assets.mjs --only=props/ (with the other steps you are rebuilding)";
  const inputs = propsMeta?.joins?.inputs;
  if (!inputs) return { ok: false, message: `props join: props/meta records no joins.inputs (built before its inputs were pinned); ${fix}` };
  const unpinned = required.filter((id) => !(id in inputs));
  if (unpinned.length) return { ok: false, message: `props join: props/meta does not pin ${unpinned.join(", ")}, which tools/gen/props.mjs now reads; ${fix}` };
  const changed = [];
  for (const [id, hash] of Object.entries(inputs)) {
    const a = assets.find((x) => x.id === id);
    if (!a) changed.push(`${id} no longer ships`);
    else if (a.hash !== hash) changed.push(`${id} changed (props/ read ${hash.slice(0, 12)}, the manifest ships ${a.hash.slice(0, 12)})`);
  }
  if (changed.length)
    return {
      ok: false,
      message: `props join: props/meta was built against other inputs: ${changed.join("; ")}. Its placements (sconces, beds, B3 props, weapon stands, bones, the brow …) and the gallery set piece's fit to the rock would be stale; ${fix}`,
    };
  return { ok: true, message: `props join: props/meta was built against the shipped ${Object.keys(inputs).join(", ")}` };
}
