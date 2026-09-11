import { Workflow } from '@systemfsoftware/effect-cell-types'
import { HttpUrl, PackageName } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { TrustCandidateState } from './stage-trust.schema.js'

export class TrustCommand extends S.TaggedClass<TrustCommand>()('TrustCommand', {
  only: S.Array(PackageName),
  dryRun: S.Boolean,
  registry: HttpUrl,
  workflowFile: S.NonEmptyString,
  slug: S.String,
  launcherReady: S.Boolean,
  candidates: S.Array(TrustCandidateState),
}) {}

export class SelectTrustCandidatesCommand extends S.TaggedClass<SelectTrustCandidatesCommand>()(
  'SelectTrustCandidatesCommand',
  {
    only: S.Array(PackageName),
    candidates: S.Array(TrustCandidateState),
  },
) {}

const SelectTrustCandidatesTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/npm-publish-engine/SelectTrustCandidatesDecision',
)
type SelectTrustCandidatesTypeId = typeof SelectTrustCandidatesTypeId

export class AllCandidatesSelected extends S.TaggedClass<AllCandidatesSelected>()(
  'AllCandidatesSelected',
  {
    selected: S.NonEmptyArray(TrustCandidateState),
  },
) {
  readonly [SelectTrustCandidatesTypeId] = SelectTrustCandidatesTypeId
}

export class OnlyCandidatesSelected extends S.TaggedClass<OnlyCandidatesSelected>()(
  'OnlyCandidatesSelected',
  {
    selected: S.NonEmptyArray(TrustCandidateState),
    excluded: S.Array(PackageName),
  },
) {
  readonly [SelectTrustCandidatesTypeId] = SelectTrustCandidatesTypeId
}

export class TrustWorkspaceEmpty extends S.TaggedError<TrustWorkspaceEmpty>()(
  'TrustWorkspaceEmpty',
  { members: S.Int },
) {}

export class TrustOnlyUnmatched extends S.TaggedError<TrustOnlyUnmatched>()(
  'TrustOnlyUnmatched',
  { only: S.Array(PackageName) },
) {}

const WorkspaceEmptyCase = S.TaggedStruct('WorkspaceEmpty', { members: S.Int })
const AllSelectedCase = S.TaggedStruct('AllSelected', {
  selected: S.Array(TrustCandidateState),
})
const OnlySelectedCase = S.TaggedStruct('OnlySelected', {
  selected: S.Array(TrustCandidateState),
  excluded: S.Array(PackageName),
})
const OnlyUnmatchedCase = S.TaggedStruct('OnlyUnmatched', {
  only: S.Array(PackageName),
})
const SelectionCase = S.Union([
  WorkspaceEmptyCase,
  AllSelectedCase,
  OnlySelectedCase,
  OnlyUnmatchedCase,
])
type SelectionCase = S.Schema.Type<typeof SelectionCase>

const nonEmptyOf = <T>(
  values: ReadonlyArray<T>,
): Option.Option<readonly [T, ...T[]]> =>
  Option.map(
    Option.fromNullishOr(values[0]),
    (head): readonly [T, ...T[]] => [head, ...values.slice(1)],
  )

const selectedByOnly = (
  command: SelectTrustCandidatesCommand,
): ReadonlyArray<TrustCandidateState> => command.candidates.filter((candidate) => command.only.includes(candidate.name))

const unmatchedOnly = (
  command: SelectTrustCandidatesCommand,
): ReadonlyArray<PackageName> =>
  command.only.filter((name) => !command.candidates.some((candidate) => candidate.name === name))

const unmatchedCaseOf = (command: SelectTrustCandidatesCommand): SelectionCase =>
  Match.value(Option.fromNullishOr(command.only[0])).pipe(
    Match.tag('None', () => AllSelectedCase.make({ selected: [...command.candidates] })),
    Match.tag('Some', () => OnlyUnmatchedCase.make({ only: [...command.only] })),
    Match.exhaustive,
  )

const selectedCaseOf = (command: SelectTrustCandidatesCommand): SelectionCase =>
  Match.value(Option.fromNullishOr(selectedByOnly(command)[0])).pipe(
    Match.tag('None', () => unmatchedCaseOf(command)),
    Match.tag('Some', () =>
      OnlySelectedCase.make({
        selected: [...selectedByOnly(command)],
        excluded: [...unmatchedOnly(command)],
      })),
    Match.exhaustive,
  )

const classify = (command: SelectTrustCandidatesCommand): SelectionCase =>
  Match.value(Option.fromNullishOr(command.candidates[0])).pipe(
    Match.tag('None', () => WorkspaceEmptyCase.make({ members: 0 })),
    Match.tag('Some', () => selectedCaseOf(command)),
    Match.exhaustive,
  )

export const selectTrustCandidates = Workflow.make(
  SelectTrustCandidatesCommand,
  (
    command,
  ): Result.Result<
    AllCandidatesSelected | OnlyCandidatesSelected,
    TrustWorkspaceEmpty | TrustOnlyUnmatched
  > =>
    Match.value(classify(command)).pipe(
      Match.tag('WorkspaceEmpty', (empty) => Result.fail(TrustWorkspaceEmpty.make({ members: empty.members }))),
      Match.tag('AllSelected', (all) =>
        Result.succeed(
          AllCandidatesSelected.make({
            selected: Option.getOrThrow(nonEmptyOf(all.selected)),
          }),
        )),
      Match.tag('OnlySelected', (only) =>
        Result.succeed(
          OnlyCandidatesSelected.make({
            selected: Option.getOrThrow(nonEmptyOf(only.selected)),
            excluded: [...only.excluded],
          }),
        )),
      Match.tag('OnlyUnmatched', (unmatched) => Result.fail(TrustOnlyUnmatched.make({ only: [...unmatched.only] }))),
      Match.exhaustive,
    ),
)
