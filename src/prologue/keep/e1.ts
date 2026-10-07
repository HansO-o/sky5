// The keep's first fight, E1 (design §5.4, §7, §8): two enemies come into the hall, the player and the
// companion fight them, a death retries the fight in place (the stage's `Encounter`).
//
// Rebel route: an imperial shield-bearer and the guard captain come out of the barracks (G3) through
// its doorway. Imperial route: a Frostsworn axeman and his leader come through the guard room (G2)
// and its door (`g2_door`), which bursts open. The first attempt walks them in (their brains wait
// while the script has the bodies); a retry puts them straight back in the hall behind the fade.
//
// Tutorial opening (`TUTORIAL`, §7): for 30 s only the tutorial opponent (the shield-bearer, the
// axeman) may attack the player (one token on the player, and the other enemy is kept on the
// companion); it winds up at 0.5× and hits for ×0.8; the companion deals ×0.5 to the one it holds.
// The opening ends early when the tutorial opponent is beaten. Barks and the route's lesson tip
// (heavy breaks the shield; parry the axeman's lunge) come with it.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { hud } from "../../ui/hud";
import { PLAYER, TUTORIAL, type ArchetypeId } from "../../engine/combat/attacks";
import type { Combatant, CombatEvent } from "../../engine/combat/CombatSystem";
import type { Encounter, Mark } from "../../engine/combat/Encounter";
import type { Character } from "../../world/characters";
import { walkPath } from "../actors";
import type { AiActor, CompanionActor, PrologueAI } from "../ai";
import type { PrologueCombat } from "../combat";
import type { ScriptScope } from "../Director";
import type { Faction } from "../flags";
import type { World } from "../World";
import { KEEP_BARKS, KEEP_TIPS, type BarkPool } from "../chapters/keepScript";
import { cue } from "./cues";
import type { Underground } from "./underground";

/** One E1 enemy: its role, archetype, where it starts on the first attempt and on a retry, and its way in. */
interface E1Enemy {
  id: "tutor" | "lead";
  archetype: ArchetypeId;
  /** world x, z, yaw (y: the ground floor) */
  spawn: [number, number, number];
  /** a retry's start, in the hall (behind the fade) */
  retry: [number, number, number];
  /** the first attempt's walk in (world x, z on the ground floor) */
  path: [number, number][];
  /** seconds after the walk-in starts that this one sets off */
  delay: number;
}

/**
 * The routes' enemies. Rebel: out of the barracks doorway (x 59.3…60.7, z −664.2…−663.6), round the
 * hall tables at (60, −661.5) and the pillars at (57 | 63, −660). Imperial: from G2 through the guard
 * room's door (z −657.7…−656.3 at x 53.4…54.0) into the hall.
 */
const ENEMIES: Record<Faction, E1Enemy[]> = {
  rebel: [
    { id: "tutor", archetype: "shieldSoldier", spawn: [62.5, -667.5, Math.PI], retry: [64.0, -660.6, Math.PI / 2], path: [[60.4, -665.3], [60.3, -663.0], [64.0, -662.8], [64.0, -659.8]], delay: 0 },
    { id: "lead", archetype: "guardCaptain", spawn: [60.0, -667.0, Math.PI], retry: [56.2, -661.4, -Math.PI / 2], path: [[59.7, -665.0], [59.7, -663.0], [56.0, -662.8], [55.9, -660.2]], delay: 0.9 },
  ],
  imperial: [
    { id: "tutor", archetype: "axeman", spawn: [50.4, -659.2, -Math.PI / 2], retry: [56.6, -657.6, -Math.PI / 2], path: [[52.6, -657.2], [54.6, -657.0], [56.6, -657.4]], delay: 0 },
    { id: "lead", archetype: "axeLeader", spawn: [49.6, -657.4, -Math.PI / 2], retry: [56.4, -655.8, -Math.PI / 2], path: [[52.5, -656.8], [54.6, -656.8], [56.6, -656.0]], delay: 0.8 },
  ],
};

/** Retry marks (§5.4; the rebel companion's from the anchors: the design's lies in the G1/G2 partition). */
const RETRY: Record<Faction, { player: [number, number, number]; companion: [number, number, number] }> = {
  rebel: { player: [54.6, -657.0, -Math.PI / 2], companion: [55.4, -656.6, -Math.PI / 2] },
  imperial: { player: [60.5, -657.5, Math.PI / 2], companion: [61.5, -658.5, Math.PI / 2] },
};

export interface E1Host {
  world: World;
  u: Underground;
  ai: PrologueAI;
  combat: PrologueCombat;
  companion: CompanionActor;
  faction: Faction;
  /** the chapter's script scope (the walk-in and the opening's timer end with it) */
  scope: ScriptScope;
  /** a door the imperial enemies burst through (g2_door), opened as they reach it */
  door?: { open(seconds?: number): Promise<boolean> } | null;
}

/**
 * E1 for one route: `start()` begins it (the walk-in, then the fight), `cleared` resolves when every
 * enemy is down, `leader` is the one with the key ring (the captain, the Frostsworn leader).
 */
export class KeepE1 {
  readonly encounter: Encounter<AiActor>;
  /** resolves once the fight is won */
  readonly cleared: Promise<void>;
  /** the opening's rules are on (the first 30 s of an attempt, until the tutorial opponent falls) */
  tutorial = false;
  /** the enemies are in the hall and fighting (the walk-in is over) */
  engaged = false;
  private offs: (() => unknown)[] = [];
  private tutorialOff: (() => void) | null = null;
  private disposed = false;
  private tipShown = false;

  constructor(private h: E1Host) {
    const { u, ai, combat, faction } = h;
    const gfY = u.origin.y + 0.4;
    const mark = (p: [number, number, number]): Mark => ({ x: p[0], y: gfY + 0.05, z: p[1], yaw: p[2] });
    const box = u.keep.zones.E1?.[0];
    const lo = box ? u.keepPoint(box.min) : new Vector3(48.2, gfY, -663.6);
    const hi = box ? u.keepPoint(box.max) : new Vector3(66, gfY + 4, -654.2);
    const enemyFaction = faction === "rebel" ? "imperial" : "rebel";
    let resolve!: () => void;
    this.cleared = new Promise<void>((r) => (resolve = r));
    this.encounter = combat.encounter<AiActor>(
      {
        id: "E1",
        arena: [{ min: [lo.x, lo.y - 0.6, lo.z], max: [hi.x, hi.y + 2, hi.z] }],
        spawns: ENEMIES[faction].map((s) => ({
          id: s.id,
          make: async ({ attempt }) => {
            const first = attempt === 0;
            const a = await ai.enemy({
              id: `keep_e1_${s.id}`,
              archetype: s.archetype,
              faction: enemyFaction,
              at: mark(first ? s.spawn : s.retry),
              group: "keep_e1",
              ...(s.id === "tutor" ? { damageMul: TUTORIAL.damageMul, windupRate: TUTORIAL.windupRate } : {}),
            });
            // the walk-in has the body first (its brain waits)
            if (first) a.brain.suspend();
            return a;
          },
        })),
        music: "audio/music_fight",
        musicAfter: null,
        retry: { player: mark(RETRY[faction].player), companion: mark(RETRY[faction].companion), minHp: 0.6 },
        onStart: () => {
          void this.walkIn().catch(() => {});
        },
        onRetry: () => this.engageAll(),
        onClear: () => {
          this.endTutorial();
          resolve();
        },
      },
      { companion: h.companion },
    );
    this.offs.push(
      combat.system.events.on((e) => this.onCombat(e)),
      ai.events.on(({ actor, event }) => {
        if (event.type !== "bark") return;
        if (actor === h.companion) this.companionBark(event.kind);
      }),
    );
  }

  /** The actor the key ring is on (null before the fight or after a failed spawn). */
  get leader(): AiActor | null {
    return this.encounter.actor("lead") ?? null;
  }

  get tutor(): AiActor | null {
    return this.encounter.actor("tutor") ?? null;
  }

  /** Begin: the start snapshot, the spawn, the music, then the walk-in. */
  start() {
    return this.encounter.start();
  }

  /** The first attempt: both walk in (the imperial pair through the guard-room door), then fight. */
  private async walkIn() {
    const h = this.h;
    const d = h.scope;
    const gfY = h.u.origin.y + 0.4;
    const actors = ENEMIES[h.faction].map((s) => ({ s, a: this.encounter.actor(s.id) }));
    if (h.faction === "imperial" && h.door) {
      // the door bursts open as they reach it
      await d.sleep(0.6);
      void h.door.open(0.45);
      cue("doorHeavy", { x: 53.7, y: gfY + 1.2, z: -657.0 }, { ref: 8 });
    }
    await d.all(
      ...actors.map(async ({ s, a }) => {
        if (!a?.body) return;
        await d.sleep(s.delay);
        if (a.disposed) return;
        await d.wait(walkPath(h.world, a.body, s.path.map(([x, z]) => new Vector3(x, gfY, z)), { speed: 3.1 }));
      }),
    );
    if (this.disposed || this.encounter.state !== "active") return;
    this.engageAll();
  }

  /** Into the fight: the brains get their bodies back, the tutorial opening starts. */
  private engageAll() {
    const h = this.h;
    this.engaged = true;
    const player = h.combat.player;
    for (const a of this.encounter.actors) {
      if (a.disposed) continue;
      a.brain.resume();
    }
    this.startTutorial();
    const tutor = this.tutor, lead = this.leader;
    if (tutor && !tutor.disposed) tutor.brain.engage(player);
    if (lead && !lead.disposed) lead.brain.engage(this.tutorial ? h.companion.combatant : player);
  }

  /** The opening rules (§7): one enemy on the player, the other held by the companion, for 30 s. */
  private startTutorial() {
    this.endTutorial();
    const h = this.h;
    const sys = h.combat.system;
    const player = h.combat.player;
    const comp = h.companion;
    const tutor = this.tutor, lead = this.leader;
    if (!tutor || tutor.disposed || tutor.combatant.defeated) return;
    this.tutorial = true;
    sys.setTokenLimit(player, TUTORIAL.tokens);
    comp.combatant.damageMul = TUTORIAL.companionMul;
    const hold = () => {
      if (!lead || lead.disposed || lead.combatant.defeated) return;
      lead.brain.forceTarget(comp.combatant, TUTORIAL.seconds);
      comp.brain.forceTarget(lead.combatant, TUTORIAL.seconds);
    };
    hold();
    let t = 0;
    let again = 0;
    const off = h.world.onUpdate((dt) => {
      t += dt;
      again += dt;
      // (a roar or a stagger may have pulled them apart: put them back together now and then)
      if (again >= 2) {
        again = 0;
        if (lead && !lead.disposed && lead.brain.target !== comp.combatant) hold();
      }
      if (t >= TUTORIAL.seconds || tutor.disposed || tutor.combatant.defeated) this.endTutorial();
    });
    this.tutorialOff = () => {
      off();
      this.tutorial = false;
      sys.setTokenLimit(player, PLAYER.tokens);
      comp.combatant.damageMul = 1;
      // the hold lets go: two against two from here
      if (lead && !lead.disposed && !lead.combatant.defeated) {
        lead.brain.forceTarget(comp.combatant, 0);
        comp.brain.forceTarget(lead.combatant, 0);
      }
    };
    // (the opening also ends with the scope: a skipped chapter leaves no rule behind)
    h.scope.until(() => this.disposed).catch(() => this.endTutorial());
  }

  private endTutorial() {
    const f = this.tutorialOff;
    this.tutorialOff = null;
    f?.();
  }

  // ------------------------------------------------------------------ barks and tips

  private pool(): BarkPool {
    return this.h.faction === "rebel" ? KEEP_BARKS.imperial : KEEP_BARKS.rebel;
  }

  private actorOf(c: Combatant): AiActor | null {
    return this.encounter.actors.find((a) => a.combatant === c) ?? null;
  }

  private bark(who: string, lines: readonly string[] | undefined, npc: Character | null, o: { force?: boolean } = {}) {
    if (!lines?.length) return;
    this.h.scope.bark(who, lines[Math.floor(Math.random() * lines.length)], { npc, force: o.force });
  }

  private onCombat(e: CombatEvent) {
    if (this.disposed || this.encounter.state !== "active") return;
    const h = this.h;
    const player = h.combat.player;
    if (e.type === "windup") {
      const a = this.actorOf(e.attacker);
      if (a) {
        // the lesson of the imperial route: the axeman's lunge can be parried
        if (h.faction === "imperial" && e.attack.id === "axe_lunge" && e.target === player) this.tip(KEEP_TIPS.lunge);
        if (Math.random() < 0.3) this.bark(a.combatant.spec.label ?? this.pool().who, this.pool().lines, a.body);
      } else if (e.attacker === h.companion.combatant && Math.random() < 0.2) {
        const p = h.faction === "rebel" ? KEEP_BARKS.brun : KEEP_BARKS.ivo;
        this.bark(p.who, p.lines, h.companion.body);
      }
    } else if (e.type === "hit") {
      // the lesson of the rebel route: the shield takes light blows, a heavy breaks it
      if (h.faction === "rebel" && e.hit.attacker === player && e.hit.outcome === "absorbed") this.tip(KEEP_TIPS.guardBreak);
    } else if (e.type === "death") {
      const a = this.actorOf(e.target);
      if (a) this.bark(a.combatant.spec.label ?? this.pool().who, this.pool().death, a.body, { force: true });
    }
  }

  private companionBark(kind: string) {
    const h = this.h;
    const rebel = h.faction === "rebel";
    if (kind === "special") this.bark(rebel ? KEEP_BARKS.brun.who : KEEP_BARKS.ivo.who, rebel ? KEEP_BARKS.brun.taunt : KEEP_BARKS.ivo.shieldWall, h.companion.body, { force: true });
    else if (kind === "down") this.bark(rebel ? KEEP_BARKS.brun.who : KEEP_BARKS.ivo.who, rebel ? KEEP_BARKS.brun.downed : KEEP_BARKS.ivo.downed, h.companion.body, { force: true });
  }

  /** The route's lesson tip, once (and on its own after 12 s of the first attempt's fight). */
  private tip(t: { id: string; text: string }) {
    if (this.tipShown) return;
    this.tipShown = true;
    hud.tip(t.id, t.text);
  }

  /** Show the route's lesson now (a fight that has gone on without the moment that teaches it). */
  lesson() {
    this.tip(this.h.faction === "rebel" ? KEEP_TIPS.guardBreak : KEEP_TIPS.lunge);
  }

  /** Remove the enemies (bodies included) and every rule and listener. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.endTutorial();
    for (const off of this.offs) off();
    this.offs = [];
    this.encounter.dispose();
  }
}
