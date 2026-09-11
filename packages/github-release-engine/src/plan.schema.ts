import { Count, PackageName } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'
import { PlanPublish, PlanSettled, PlanVersion } from './plan-release.workflow.js'

export const PlanPhase = S.Literals(['version', 'publish', 'none'])

export type PlanPhase = S.Schema.Type<typeof PlanPhase>

export const PlanDecision = S.Union([PlanVersion, PlanPublish, PlanSettled])

export type PlanDecision = S.Schema.Type<typeof PlanDecision>

export const PlanReport = S.Struct({
  decision: PlanDecision,
  phase: PlanPhase,
  pendingIntents: Count,
  thisCycle: Count,
  deferred: Count,
  unpublished: S.Array(PackageName),
})

export type PlanReport = S.Schema.Type<typeof PlanReport>
