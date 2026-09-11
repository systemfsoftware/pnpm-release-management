import { Count, PackageName, PlanDecision } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const PlanPhase = S.Literals(['version', 'publish', 'none'])

export type PlanPhase = S.Schema.Type<typeof PlanPhase>

export const PlanReport = S.Struct({
  decision: PlanDecision,
  phase: PlanPhase,
  pendingIntents: Count,
  thisCycle: Count,
  deferred: Count,
  unpublished: S.Array(PackageName),
})

export type PlanReport = S.Schema.Type<typeof PlanReport>
