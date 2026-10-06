/**
 * Engine AI (keep/exit design §3.6, §9; engine-framework §2.19): perception and noise, steering
 * agents on capsules, time-sliced hierarchical brains for humanoids, creatures and the companion.
 * Navigation is direct steering (design §0 #12); the navmesh (`engine/nav`, P2b) can feed goals later.
 */
export { Brain, type BrainState, type BrainTransition } from "./fsm";
export { TimeSlicer, type SliceRun } from "./slicer";
export { NoiseBus, HEARING, BEAST_HEARING, BEAST_ONESHOT, FOOTING, footstepNoise, combatNoise, type Noise, type NoiseKind, type HeardNoise, type Footing } from "./noise";
export {
  Perception,
  Sensor,
  PERCEPTION,
  BEAST,
  sightRate,
  hearRate,
  beastRate,
  inCone,
  levelOf,
  type AwarenessLevel,
  type PerceptionTarget,
  type SensorSpec,
  type SensorChange,
  type SightRay,
} from "./perception";
export { STEER, Crowd, StuckDetector, yawOf, wrapAngle, turnToward, localVelocity, seek, circleVelocity, separation, sidestep, type XZ, type CrowdMember } from "./steering";
export { AgentCore, KinematicAgent, HUMANOID_GAIT, gaitClip, type AgentControl, type ActOptions, type Gait, type GaitClip, type Goal, type Place } from "./agent";
export { AgentMover, type AgentBody, type AgentMoverOptions } from "./AgentMover";
export { Breadcrumbs, FOLLOW, followSpeed, shouldCatchUp, type FollowTarget } from "./breadcrumbs";
export { AI, between } from "./tuning";
export {
  CombatBrain,
  fighterOf,
  companionFighter,
  HUMANOID_CLIPS,
  type FighterSpec,
  type RangedDef,
  type BrainClips,
  type BarkKind,
  type BrainEvent,
  type BrainSystem,
  type CombatBrainOptions,
} from "./CombatBrain";
export { HumanoidBrain, type HumanoidBrainOptions, type Post } from "./HumanoidBrain";
export { CreatureBrain, type CreatureBrainOptions, type SleepClips, type Leash } from "./CreatureBrain";
export { Companion, SPECIALS, type CompanionOptions, type Leader } from "./Companion";
export { AISystem, RagdollBudget, type AISystemOptions, type Thinker } from "./AISystem";
