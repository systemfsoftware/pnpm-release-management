import { Workflow } from '@systemfsoftware/effect-cell-types'
import { DecisionTypeId, PackageName, PackageVersion, StatusClass } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type {
  PublishStatusEmpty,
  PublishStatusRefusal,
  PublishStatusUnattested,
  PublishStatusUnpublished,
  PublishStatusUnreadable,
} from './status.schema.js'

export const StatusMode = S.Literals(['report', 'check', 'preflight'])
export type StatusMode = S.Schema.Type<typeof StatusMode>

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
  readonly [DecisionTypeId] = DecisionTypeId
}

export class PublishStatusOwed extends S.TaggedClass<PublishStatusOwed>()('PublishStatusOwed', {
  unpublished: S.Int,
  untrusted: S.Int,
  stuck: S.Int,
  evaluations: S.Array(ScoredEvaluation),
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export type PublishStatusWorkflowDecision = PublishStatusHealthy | PublishStatusOwed

const EmptyCase = S.TaggedStruct('Empty', { members: S.Int })
type EmptyCase = S.Schema.Type<typeof EmptyCase>

const UnreadableCase = S.TaggedStruct('Unreadable', { packages: S.NonEmptyArray(PackageName) })
type UnreadableCase = S.Schema.Type<typeof UnreadableCase>

const UnpublishedCase = S.TaggedStruct('Unpublished', { packages: S.NonEmptyArray(PackageName) })
type UnpublishedCase = S.Schema.Type<typeof UnpublishedCase>

const UnattestedCase = S.TaggedStruct('Unattested', { packages: S.NonEmptyArray(PackageName) })
type UnattestedCase = S.Schema.Type<typeof UnattestedCase>

const HealthyCase = S.TaggedStruct('Healthy', {
  packages: S.Int,
  evaluations: S.Array(ScoredEvaluation),
})
type HealthyCase = S.Schema.Type<typeof HealthyCase>

const OwedCase = S.TaggedStruct('Owed', {
  unpublished: S.Int,
  untrusted: S.Int,
  stuck: S.Int,
  evaluations: S.Array(ScoredEvaluation),
})
type OwedCase = S.Schema.Type<typeof OwedCase>

type StatusCase =
  | EmptyCase
  | UnreadableCase
  | UnpublishedCase
  | UnattestedCase
  | HealthyCase
  | OwedCase

const scoreOf = (evaluation: StatusEvaluationState): StatusClass => {
  if (evaluation.npmLatest === undefined) return 'unpublished'
  if (evaluation.reachable === false) return 'error'
  if (evaluation.attested === false) return 'no-oidc'
  if (evaluation.localVersion === evaluation.npmLatest) return 'ok'
  return 'stuck'
}

const namesOf = (
  scored: ReadonlyArray<ScoredEvaluation>,
  klass: StatusClass,
): ReadonlyArray<PackageName> =>
  scored.filter((evaluation) => evaluation.class === klass).map((evaluation) => evaluation.name)

const countOf = (scored: ReadonlyArray<ScoredEvaluation>, klass: StatusClass): number =>
  scored.filter((evaluation) => evaluation.class === klass).length

const nonEmptyOf = (
  names: ReadonlyArray<PackageName>,
): readonly [PackageName, ...PackageName[]] | undefined => {
  const first = names[0]
  if (first === undefined) return undefined
  return [first, ...names.slice(1)]
}

const statusCaseOf = (command: StatusCommand): StatusCase => {
  if (command.evaluations.length === 0) return EmptyCase.make({ members: 0 })
  const scored = command.evaluations.map((evaluation) => ({
    ...evaluation,
    class: scoreOf(evaluation),
  }))
  const unreadable = nonEmptyOf(namesOf(scored, 'error'))
  if (command.mode !== 'report' && unreadable !== undefined) {
    return UnreadableCase.make({ packages: unreadable })
  }
  const unpublished = nonEmptyOf(namesOf(scored, 'unpublished'))
  if (command.mode !== 'report' && unpublished !== undefined) {
    return UnpublishedCase.make({ packages: unpublished })
  }
  const unattested = nonEmptyOf(namesOf(scored, 'no-oidc'))
  if (command.mode === 'check' && unattested !== undefined) {
    return UnattestedCase.make({ packages: unattested })
  }
  const owed = countOf(scored, 'unpublished') + countOf(scored, 'no-oidc') +
    countOf(scored, 'stuck') + countOf(scored, 'error')
  if (owed === 0) return HealthyCase.make({ packages: scored.length, evaluations: scored })
  return OwedCase.make({
    unpublished: countOf(scored, 'unpublished'),
    untrusted: countOf(scored, 'no-oidc'),
    stuck: countOf(scored, 'stuck'),
    evaluations: scored,
  })
}

export const publishStatus = Workflow.make(
  StatusCommand,
  (command): Result.Result<PublishStatusWorkflowDecision, PublishStatusRefusal> =>
    Match.value(statusCaseOf(command)).pipe(
      Match.tag(
        'Empty',
        (empty): Result.Result<never, PublishStatusEmpty> =>
          Result.fail({ _tag: 'PublishStatusEmpty', members: empty.members }),
      ),
      Match.tag(
        'Unreadable',
        (unreadable): Result.Result<never, PublishStatusUnreadable> =>
          Result.fail({ _tag: 'PublishStatusUnreadable', packages: unreadable.packages }),
      ),
      Match.tag(
        'Unpublished',
        (unpublished): Result.Result<never, PublishStatusUnpublished> =>
          Result.fail({ _tag: 'PublishStatusUnpublished', packages: unpublished.packages }),
      ),
      Match.tag(
        'Unattested',
        (unattested): Result.Result<never, PublishStatusUnattested> =>
          Result.fail({ _tag: 'PublishStatusUnattested', packages: unattested.packages }),
      ),
      Match.tag('Healthy', (healthy) =>
        Result.succeed(
          PublishStatusHealthy.make({
            packages: healthy.packages,
            evaluations: healthy.evaluations,
          }),
        )),
      Match.tag('Owed', (owed) =>
        Result.succeed(
          PublishStatusOwed.make({
            unpublished: owed.unpublished,
            untrusted: owed.untrusted,
            stuck: owed.stuck,
            evaluations: owed.evaluations,
          }),
        )),
      Match.exhaustive,
    ),
)
