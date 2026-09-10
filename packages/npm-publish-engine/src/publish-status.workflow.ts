import { Workflow } from '@systemfsoftware/effect-cell-types'
import { PackageName, PackageVersion, StatusClass } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { StatusMode } from './status.schema.ts'

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

const EmptyCase = S.TaggedStruct('Empty', {
  members: S.Int,
})
const UnreadableCase = S.TaggedStruct('Unreadable', {
  packages: S.Array(PackageName),
})
const UnpublishedCase = S.TaggedStruct('Unpublished', {
  packages: S.Array(PackageName),
})
const UnattestedCase = S.TaggedStruct('Unattested', {
  packages: S.Array(PackageName),
})
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

const scoreEvaluation = (
  evaluation: StatusEvaluationState,
): ScoredEvaluation =>
  Match.value(evaluation).pipe(
    Match.when(
      (candidate) => candidate.npmLatest === undefined,
      (candidate) => ({
        name: candidate.name,
        localVersion: candidate.localVersion,
        npmLatest: candidate.npmLatest,
        attested: candidate.attested,
        reachable: candidate.reachable,
        provenanceConfig: candidate.provenanceConfig,
        class: 'unpublished',
      } as const),
    ),
    Match.when(
      (candidate) => candidate.reachable === false,
      (candidate) => ({
        name: candidate.name,
        localVersion: candidate.localVersion,
        npmLatest: candidate.npmLatest,
        attested: candidate.attested,
        reachable: candidate.reachable,
        provenanceConfig: candidate.provenanceConfig,
        class: 'error',
      } as const),
    ),
    Match.when(
      (candidate) => candidate.attested === false,
      (candidate) => ({
        name: candidate.name,
        localVersion: candidate.localVersion,
        npmLatest: candidate.npmLatest,
        attested: candidate.attested,
        reachable: candidate.reachable,
        provenanceConfig: candidate.provenanceConfig,
        class: 'no-oidc',
      } as const),
    ),
    Match.when(
      (candidate) => candidate.localVersion === candidate.npmLatest,
      (candidate) => ({
        name: candidate.name,
        localVersion: candidate.localVersion,
        npmLatest: candidate.npmLatest,
        attested: candidate.attested,
        reachable: candidate.reachable,
        provenanceConfig: candidate.provenanceConfig,
        class: 'ok',
      } as const),
    ),
    Match.orElse((candidate) => ({
      name: candidate.name,
      localVersion: candidate.localVersion,
      npmLatest: candidate.npmLatest,
      attested: candidate.attested,
      reachable: candidate.reachable,
      provenanceConfig: candidate.provenanceConfig,
      class: 'stuck',
    } as const)),
  )

const namesOf = (
  scored: ReadonlyArray<ScoredEvaluation>,
  klass: StatusClass,
): ReadonlyArray<PackageName> =>
  scored.filter((evaluation) => evaluation.class === klass).map((evaluation) => evaluation.name)

const classify = (command: StatusCommand): StatusCase => {
  const scored = command.evaluations.map((evaluation) => scoreEvaluation(evaluation))
  return Match.value({ mode: command.mode, scored }).pipe(
    Match.when(
      ({ scored: evaluations }) => evaluations.length === 0,
      () => ({ _tag: 'Empty', members: 0 } as const),
    ),
    Match.when(
      ({ mode, scored: evaluations }) => mode !== 'report' && namesOf(evaluations, 'error').length > 0,
      ({ scored: evaluations }) => ({
        _tag: 'Unreadable',
        packages: [...namesOf(evaluations, 'error')],
      } as const),
    ),
    Match.when(
      ({ mode, scored: evaluations }) => mode === 'check' && namesOf(evaluations, 'unpublished').length > 0,
      ({ scored: evaluations }) => ({
        _tag: 'Unpublished',
        packages: [...namesOf(evaluations, 'unpublished')],
      } as const),
    ),
    Match.when(
      ({ mode, scored: evaluations }) => mode === 'check' && namesOf(evaluations, 'no-oidc').length > 0,
      ({ scored: evaluations }) => ({
        _tag: 'Unattested',
        packages: [...namesOf(evaluations, 'no-oidc')],
      } as const),
    ),
    Match.when(
      ({ mode, scored: evaluations }) => mode === 'preflight' && namesOf(evaluations, 'unpublished').length > 0,
      ({ scored: evaluations }) => ({
        _tag: 'Unpublished',
        packages: [...namesOf(evaluations, 'unpublished')],
      } as const),
    ),
    Match.when(
      ({ scored: evaluations }) =>
        namesOf(evaluations, 'unpublished').length === 0 &&
        namesOf(evaluations, 'no-oidc').length === 0 &&
        namesOf(evaluations, 'stuck').length === 0 &&
        namesOf(evaluations, 'error').length === 0,
      ({ scored: evaluations }) => ({
        _tag: 'Healthy',
        packages: evaluations.length,
        evaluations: [...evaluations],
      } as const),
    ),
    Match.orElse(({ scored: evaluations }) => ({
      _tag: 'Owed',
      unpublished: namesOf(evaluations, 'unpublished').length,
      untrusted: namesOf(evaluations, 'no-oidc').length,
      stuck: namesOf(evaluations, 'stuck').length,
      evaluations: [...evaluations],
    } as const)),
  )
}

export const publishStatus = Workflow.make(
  StatusCommand,
  (
    command,
  ): Result.Result<PublishStatusWorkflowDecision, PublishStatusWorkflowRefusal> =>
    Match.value(classify(command)).pipe(
      Match.tag('Empty', (empty) => Result.fail(PublishStatusEmpty.make({ members: empty.members }))),
      Match.tag('Unreadable', (unreadable) =>
        Result.fail(PublishStatusUnreadable.make({ packages: [...unreadable.packages] }))),
      Match.tag('Unpublished', (unpublished) =>
        Result.fail(PublishStatusUnpublished.make({ packages: [...unpublished.packages] }))),
      Match.tag('Unattested', (unattested) =>
        Result.fail(PublishStatusUnattested.make({ packages: [...unattested.packages] }))),
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
