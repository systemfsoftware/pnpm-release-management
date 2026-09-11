import { Workflow } from '@systemfsoftware/effect-cell-types'
import { PackageName } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { TrustCandidateState } from './stage-trust.schema.js'

export class EvaluateTrustStateCommand extends S.TaggedClass<EvaluateTrustStateCommand>()(
  'EvaluateTrustStateCommand',
  {
    candidates: S.Array(TrustCandidateState),
  },
) {}

const EvaluateTrustStateTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/npm-publish-engine/EvaluateTrustStateDecision',
)
type EvaluateTrustStateTypeId = typeof EvaluateTrustStateTypeId

export class TrustStatesAttested extends S.TaggedClass<TrustStatesAttested>()(
  'TrustStatesAttested',
  {
    owed: S.Array(TrustCandidateState),
  },
) {
  readonly [EvaluateTrustStateTypeId] = EvaluateTrustStateTypeId
}

export class TrustStatesOwed extends S.TaggedClass<TrustStatesOwed>()(
  'TrustStatesOwed',
  {
    owed: S.Array(TrustCandidateState),
  },
) {
  readonly [EvaluateTrustStateTypeId] = EvaluateTrustStateTypeId
}

export class TrustRegistryUnreadable extends S.TaggedError<TrustRegistryUnreadable>()(
  'TrustRegistryUnreadable',
  { packages: S.Array(PackageName) },
) {}

const UnreadableCase = S.TaggedStruct('Unreadable', { packages: S.Array(PackageName) })
const AttestedCase = S.TaggedStruct('Attested', { owed: S.Array(TrustCandidateState) })
const OwedCase = S.TaggedStruct('Owed', { owed: S.Array(TrustCandidateState) })
const TrustStateCase = S.Union([UnreadableCase, AttestedCase, OwedCase])
type TrustStateCase = S.Schema.Type<typeof TrustStateCase>

const owesTrustWork = (candidate: TrustCandidateState): boolean =>
  Match.value(Option.fromNullishOr(candidate.snapshot.latest)).pipe(
    Match.tag('None', () => true),
    Match.tag('Some', () => candidate.snapshot.attested === false),
    Match.exhaustive,
  )

const owesIn = (
  command: EvaluateTrustStateCommand,
): ReadonlyArray<TrustCandidateState> => command.candidates.filter((candidate) => owesTrustWork(candidate))

const unreadableIn = (
  command: EvaluateTrustStateCommand,
): ReadonlyArray<TrustCandidateState> =>
  command.candidates.filter((candidate) => candidate.snapshot.reachable === false)

const owedCaseOf = (command: EvaluateTrustStateCommand): TrustStateCase =>
  Match.value(Option.fromNullishOr(owesIn(command)[0])).pipe(
    Match.tag('None', () => AttestedCase.make({ owed: [] })),
    Match.tag('Some', () => OwedCase.make({ owed: [...owesIn(command)] })),
    Match.exhaustive,
  )

const classify = (command: EvaluateTrustStateCommand): TrustStateCase =>
  Match.value(Option.fromNullishOr(unreadableIn(command)[0])).pipe(
    Match.tag('None', () => owedCaseOf(command)),
    Match.tag('Some', () =>
      UnreadableCase.make({
        packages: unreadableIn(command).map((candidate) => candidate.name),
      })),
    Match.exhaustive,
  )

export const evaluateTrustState = Workflow.make(
  EvaluateTrustStateCommand,
  (
    command,
  ): Result.Result<TrustStatesAttested | TrustStatesOwed, TrustRegistryUnreadable> =>
    Match.value(classify(command)).pipe(
      Match.tag(
        'Unreadable',
        (unreadable) => Result.fail(TrustRegistryUnreadable.make({ packages: [...unreadable.packages] })),
      ),
      Match.tag('Attested', (attested) => Result.succeed(TrustStatesAttested.make({ owed: [...attested.owed] }))),
      Match.tag('Owed', (owed) => Result.succeed(TrustStatesOwed.make({ owed: [...owed.owed] }))),
      Match.exhaustive,
    ),
)
