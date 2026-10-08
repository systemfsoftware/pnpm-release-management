import { Count, LegacyRelease, PackageName } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'
import { PlanRelease, PlanSettled, PlanVersion } from './plan-release.workflow.js'

export const PlanPhase = S.Literals(['version', 'release', 'none'])

export type PlanPhase = S.Schema.Type<typeof PlanPhase>

export const PlanDecision = S.Union([PlanVersion, PlanRelease, PlanSettled])

export type PlanDecision = S.Schema.Type<typeof PlanDecision>

export const PlanReport = S.Struct({
  decision: PlanDecision,
  phase: PlanPhase,
  pendingIntents: Count,
  thisCycle: Count,
  deferred: Count,
  unpublished: S.Array(PackageName),
  legacy: S.Array(LegacyRelease),
})

export type PlanReport = S.Schema.Type<typeof PlanReport>
