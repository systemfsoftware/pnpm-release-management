import { Workflow } from '@systemfsoftware/effect-cell-types'
import { PackageName, PackageVersion, StatusClass } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { StatusMode } from './status.schema.js'

const PublishStatusDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/npm-publish-engine/PublishStatusDecision',
)
type PublishStatusDecisionTypeId = typeof PublishStatusDecisionTypeId

export const StatusEvaluationState = S.Struct({
  name: PackageName,
  localVersion: PackageVersion,
  npmLatest: S.optional(PackageVersion),
  attested: S.Boolean,
  reachable: S.Boolean,
  provenanceConfig: S.Boolean,
})
export type StatusEvaluationState = S.Schema.Type<typeof StatusEvaluationState>

export class StatusCommand extends S.TaggedClass<StatusCommand>()('StatusCommand', {
  mode: StatusMode,
  evaluations: S.Array(StatusEvaluationState),
}) {}

export const ScoredEvaluation = S.Struct({
  name: PackageName,
  localVersion: PackageVersion,
  npmLatest: S.optional(PackageVersion),
  attested: S.Boolean,
  reachable: S.Boolean,
  provenanceConfig: S.Boolean,
  class: StatusClass,
})
export type ScoredEvaluation = S.Schema.Type<typeof ScoredEvaluation>

export class PublishStatusHealthy extends S.TaggedClass<PublishStatusHealthy>()(
  'PublishStatusHealthy',
  {
    packages: S.Int,
    evaluations: S.Array(ScoredEvaluation),
  },
) {
  readonly [PublishStatusDecisionTypeId] = PublishStatusDecisionTypeId
}

export class PublishStatusOwed extends S.TaggedClass<PublishStatusOwed>()('PublishStatusOwed', {
  unpublished: S.Int,
  untrusted: S.Int,
  stuck: S.Int,
  evaluations: S.Array(ScoredEvaluation),
}) {
  readonly [PublishStatusDecisionTypeId] = PublishStatusDecisionTypeId
}

export type PublishStatusWorkflowDecision = PublishStatusHealthy | PublishStatusOwed

export class PublishStatusUnpublished extends S.TaggedError<PublishStatusUnpublished>()(
  'PublishStatusUnpublished',
  { packages: S.Array(PackageName) },
) {}

export class PublishStatusUnattested extends S.TaggedError<PublishStatusUnattested>()(
  'PublishStatusUnattested',
  { packages: S.Array(PackageName) },
) {}

export class PublishStatusUnreadable extends S.TaggedError<PublishStatusUnreadable>()(
  'PublishStatusUnreadable',
  { packages: S.Array(PackageName) },
) {}

export class PublishStatusEmpty extends S.TaggedError<PublishStatusEmpty>()('PublishStatusEmpty', {
  members: S.Int,
}) {}

export type PublishStatusWorkflowRefusal =
  | PublishStatusUnpublished
  | PublishStatusUnattested
  | PublishStatusUnreadable
  | PublishStatusEmpty

const EmptyCase = S.TaggedStruct('Empty', { members: S.Int })
const UnreadableCase = S.TaggedStruct('Unreadable', { packages: S.Array(PackageName) })
const UnpublishedCase = S.TaggedStruct('Unpublished', { packages: S.Array(PackageName) })
const UnattestedCase = S.TaggedStruct('Unattested', { packages: S.Array(PackageName) })
const HealthyCase = S.TaggedStruct('Healthy', {
  packages: S.Int,
  evaluations: S.Array(ScoredEvaluation),
})
const OwedCase = S.TaggedStruct('Owed', {
  unpublished: S.Int,
  untrusted: S.Int,
  stuck: S.Int,
  evaluations: S.Array(ScoredEvaluation),
})

const StatusCase = S.Union([
  EmptyCase,
  UnreadableCase,
  UnpublishedCase,
  UnattestedCase,
  HealthyCase,
  OwedCase,
])
type StatusCase = S.Schema.Type<typeof StatusCase>

interface StatusTally {
  readonly unpublished: number
  readonly untrusted: number
  readonly stuck: number
  readonly unreadable: number
}

const scoreEvaluation = (evaluation: StatusEvaluationState): ScoredEvaluation =>
  Match.value(evaluation).pipe(
    Match.when(
      (candidate) => candidate.npmLatest === undefined,
      (candidate) => ScoredEvaluation.make({ ...candidate, class: 'unpublished' }),
    ),
    Match.when(
      (candidate) => candidate.reachable === false,
      (candidate) => ScoredEvaluation.make({ ...candidate, class: 'error' }),
    ),
    Match.when(
      (candidate) => candidate.attested === false,
      (candidate) => ScoredEvaluation.make({ ...candidate, class: 'no-oidc' }),
    ),
    Match.when(
      (candidate) => candidate.localVersion === candidate.npmLatest,
      (candidate) => ScoredEvaluation.make({ ...candidate, class: 'ok' }),
    ),
    Match.orElse((candidate) => ScoredEvaluation.make({ ...candidate, class: 'stuck' })),
  )

const namesOf = (
  scored: ReadonlyArray<ScoredEvaluation>,
  klass: StatusClass,
): ReadonlyArray<PackageName> =>
  scored.filter((evaluation) => evaluation.class === klass).map((evaluation) => evaluation.name)

const countOf = (scored: ReadonlyArray<ScoredEvaluation>, klass: StatusClass): number =>
  scored.filter((evaluation) => evaluation.class === klass).length

const tallyOf = (scored: ReadonlyArray<ScoredEvaluation>): StatusTally => ({
  unpublished: countOf(scored, 'unpublished'),
  untrusted: countOf(scored, 'no-oidc'),
  stuck: countOf(scored, 'stuck'),
  unreadable: countOf(scored, 'error'),
})

const owedSumOf = (tally: StatusTally): number => tally.unpublished + tally.untrusted + tally.stuck + tally.unreadable

const settledCaseOf = (scored: ReadonlyArray<ScoredEvaluation>, tally: StatusTally): StatusCase =>
  Match.value(owedSumOf(tally) === 0).pipe(
    Match.when(true, () => HealthyCase.make({ packages: scored.length, evaluations: [...scored] })),
    Match.when(false, () =>
      OwedCase.make({
        unpublished: tally.unpublished,
        untrusted: tally.untrusted,
        stuck: tally.stuck,
        evaluations: [...scored],
      })),
    Match.exhaustive,
  )

const checkAttestedCaseOf = (
  scored: ReadonlyArray<ScoredEvaluation>,
  tally: StatusTally,
): StatusCase =>
  Match.value(tally.untrusted > 0).pipe(
    Match.when(true, () => UnattestedCase.make({ packages: [...namesOf(scored, 'no-oidc')] })),
    Match.when(false, () => settledCaseOf(scored, tally)),
    Match.exhaustive,
  )

const checkUnpublishedCaseOf = (
  scored: ReadonlyArray<ScoredEvaluation>,
  tally: StatusTally,
): StatusCase =>
  Match.value(tally.unpublished > 0).pipe(
    Match.when(true, () => UnpublishedCase.make({ packages: [...namesOf(scored, 'unpublished')] })),
    Match.when(false, () => checkAttestedCaseOf(scored, tally)),
    Match.exhaustive,
  )

const checkCaseOf = (scored: ReadonlyArray<ScoredEvaluation>, tally: StatusTally): StatusCase =>
  Match.value(tally.unreadable > 0).pipe(
    Match.when(true, () => UnreadableCase.make({ packages: [...namesOf(scored, 'error')] })),
    Match.when(false, () => checkUnpublishedCaseOf(scored, tally)),
    Match.exhaustive,
  )

const preflightUnpublishedCaseOf = (
  scored: ReadonlyArray<ScoredEvaluation>,
  tally: StatusTally,
): StatusCase =>
  Match.value(tally.unpublished > 0).pipe(
    Match.when(true, () => UnpublishedCase.make({ packages: [...namesOf(scored, 'unpublished')] })),
    Match.when(false, () => settledCaseOf(scored, tally)),
    Match.exhaustive,
  )

const preflightCaseOf = (
  scored: ReadonlyArray<ScoredEvaluation>,
  tally: StatusTally,
): StatusCase =>
  Match.value(tally.unreadable > 0).pipe(
    Match.when(true, () => UnreadableCase.make({ packages: [...namesOf(scored, 'error')] })),
    Match.when(false, () => preflightUnpublishedCaseOf(scored, tally)),
    Match.exhaustive,
  )

const scoredCaseOf = (command: StatusCommand): StatusCase => {
  const scored = command.evaluations.map((evaluation) => scoreEvaluation(evaluation))
  const tally = tallyOf(scored)
  return Match.value(command.mode).pipe(
    Match.when('report', () => settledCaseOf(scored, tally)),
    Match.when('check', () => checkCaseOf(scored, tally)),
    Match.when('preflight', () => preflightCaseOf(scored, tally)),
    Match.exhaustive,
  )
}

const classify = (command: StatusCommand): StatusCase =>
  Match.value(command.evaluations.length === 0).pipe(
    Match.when(true, () => EmptyCase.make({ members: 0 })),
    Match.when(false, () => scoredCaseOf(command)),
    Match.exhaustive,
  )

export const publishStatus = Workflow.make(
  StatusCommand,
  (command): Result.Result<PublishStatusWorkflowDecision, PublishStatusWorkflowRefusal> =>
    Match.value(classify(command)).pipe(
      Match.tag('Empty', (empty) => Result.fail(PublishStatusEmpty.make({ members: empty.members }))),
      Match.tag(
        'Unreadable',
        (unreadable) => Result.fail(PublishStatusUnreadable.make({ packages: [...unreadable.packages] })),
      ),
      Match.tag(
        'Unpublished',
        (unpublished) => Result.fail(PublishStatusUnpublished.make({ packages: [...unpublished.packages] })),
      ),
      Match.tag(
        'Unattested',
        (unattested) => Result.fail(PublishStatusUnattested.make({ packages: [...unattested.packages] })),
      ),
      Match.tag('Healthy', (healthy) =>
        Result.succeed(
          PublishStatusHealthy.make({
            packages: healthy.packages,
            evaluations: [...healthy.evaluations],
          }),
        )),
      Match.tag('Owed', (owed) =>
        Result.succeed(
          PublishStatusOwed.make({
            unpublished: owed.unpublished,
            untrusted: owed.untrusted,
            stuck: owed.stuck,
            evaluations: [...owed.evaluations],
          }),
        )),
      Match.exhaustive,
    ),
)
