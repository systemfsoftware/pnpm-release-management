import { Workflow } from '@systemfsoftware/effect-cell-types'
import { DecisionTypeId, PackageName, type TrustRegistryUnreadable } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { TrustCandidateState } from './stage-trust.schema.js'

export class EvaluateTrustStateCommand extends S.TaggedClass<EvaluateTrustStateCommand>()(
  'EvaluateTrustStateCommand',
  {
    candidates: S.Array(TrustCandidateState),
  },
) {}

export class TrustStatesAttested extends S.TaggedClass<TrustStatesAttested>()(
  'TrustStatesAttested',
  {
    owed: S.Array(TrustCandidateState),
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class TrustStatesOwed extends S.TaggedClass<TrustStatesOwed>()(
  'TrustStatesOwed',
  {
    owed: S.Array(TrustCandidateState),
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

const UnreadableCase = S.TaggedStruct('Unreadable', { packages: S.NonEmptyArray(PackageName) })
type UnreadableCase = S.Schema.Type<typeof UnreadableCase>

const AttestedCase = S.TaggedStruct('Attested', { owed: S.Array(TrustCandidateState) })
type AttestedCase = S.Schema.Type<typeof AttestedCase>

const OwedCase = S.TaggedStruct('Owed', { owed: S.Array(TrustCandidateState) })
type OwedCase = S.Schema.Type<typeof OwedCase>

type TrustStateCase = UnreadableCase | AttestedCase | OwedCase

const owesTrustWork = (candidate: TrustCandidateState): boolean =>
  candidate.snapshot.latest === undefined || candidate.snapshot.attested === false

const nonEmptyOf = (
  names: ReadonlyArray<PackageName>,
): readonly [PackageName, ...PackageName[]] | undefined => {
  const first = names[0]
  if (first === undefined) return undefined
  return [first, ...names.slice(1)]
}

const trustStateCaseOf = (command: EvaluateTrustStateCommand): TrustStateCase => {
  const unreadable = nonEmptyOf(
    command.candidates
      .filter((candidate) => candidate.snapshot.reachable === false)
      .map((candidate) => candidate.name),
  )
  if (unreadable !== undefined) return UnreadableCase.make({ packages: unreadable })
  const owed = command.candidates.filter((candidate) => owesTrustWork(candidate))
  if (owed.length === 0) return AttestedCase.make({ owed: [] })
  return OwedCase.make({ owed })
}

export const evaluateTrustState = Workflow.make(
  EvaluateTrustStateCommand,
  (
    command,
  ): Result.Result<TrustStatesAttested | TrustStatesOwed, TrustRegistryUnreadable> =>
    Match.value(trustStateCaseOf(command)).pipe(
      Match.tag(
        'Unreadable',
        (unreadable): Result.Result<never, TrustRegistryUnreadable> =>
          Result.fail({ _tag: 'TrustRegistryUnreadable', packages: unreadable.packages }),
      ),
      Match.tag('Attested', (attested) => Result.succeed(TrustStatesAttested.make({ owed: attested.owed }))),
      Match.tag('Owed', (owed) => Result.succeed(TrustStatesOwed.make({ owed: owed.owed }))),
      Match.exhaustive,
    ),
)
