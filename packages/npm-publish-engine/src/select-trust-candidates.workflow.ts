import { Workflow } from '@systemfsoftware/effect-cell-types'
import {
  Count,
  DecisionTypeId,
  HttpUrl,
  PackageName,
  type TrustOnlyUnmatched,
  type TrustWorkspaceEmpty,
} from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
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
    members: Count,
    only: S.Array(PackageName),
    candidates: S.Array(TrustCandidateState),
  },
) {}

export class AllCandidatesSelected extends S.TaggedClass<AllCandidatesSelected>()(
  'AllCandidatesSelected',
  {
    selected: S.NonEmptyArray(TrustCandidateState),
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class OnlyCandidatesSelected extends S.TaggedClass<OnlyCandidatesSelected>()(
  'OnlyCandidatesSelected',
  {
    selected: S.NonEmptyArray(TrustCandidateState),
    excluded: S.Array(PackageName),
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

const WorkspaceEmptyCase = S.TaggedStruct('WorkspaceEmpty', { members: Count })
type WorkspaceEmptyCase = S.Schema.Type<typeof WorkspaceEmptyCase>

const AllSelectedCase = S.TaggedStruct('AllSelected', {
  selected: S.NonEmptyArray(TrustCandidateState),
})
type AllSelectedCase = S.Schema.Type<typeof AllSelectedCase>

const OnlySelectedCase = S.TaggedStruct('OnlySelected', {
  selected: S.NonEmptyArray(TrustCandidateState),
  excluded: S.Array(PackageName),
})
type OnlySelectedCase = S.Schema.Type<typeof OnlySelectedCase>

const OnlyUnmatchedCase = S.TaggedStruct('OnlyUnmatched', {
  only: S.NonEmptyArray(PackageName),
})
type OnlyUnmatchedCase = S.Schema.Type<typeof OnlyUnmatchedCase>

type SelectionCase = WorkspaceEmptyCase | AllSelectedCase | OnlySelectedCase | OnlyUnmatchedCase

const selectionCaseOf = (command: SelectTrustCandidatesCommand): SelectionCase => {
  const candidates = command.candidates
  const first = candidates[0]
  if (first === undefined) return WorkspaceEmptyCase.make({ members: command.members })
  const only = command.only
  const firstOnly = only[0]
  if (firstOnly === undefined) {
    return AllSelectedCase.make({ selected: [first, ...candidates.slice(1)] })
  }
  const selected = candidates.filter((candidate) => only.includes(candidate.name))
  const firstSelected = selected[0]
  if (firstSelected === undefined) {
    return OnlyUnmatchedCase.make({ only: [firstOnly, ...only.slice(1)] })
  }
  return OnlySelectedCase.make({
    selected: [firstSelected, ...selected.slice(1)],
    excluded: only.filter((name) => !candidates.some((candidate) => candidate.name === name)),
  })
}

export const selectTrustCandidates = Workflow.make(
  SelectTrustCandidatesCommand,
  (
    command,
  ): Result.Result<
    AllCandidatesSelected | OnlyCandidatesSelected,
    TrustWorkspaceEmpty | TrustOnlyUnmatched
  > =>
    Match.value(selectionCaseOf(command)).pipe(
      Match.tag(
        'WorkspaceEmpty',
        (empty): Result.Result<never, TrustWorkspaceEmpty> =>
          Result.fail({ _tag: 'TrustWorkspaceEmpty', members: empty.members }),
      ),
      Match.tag('AllSelected', (all) => Result.succeed(AllCandidatesSelected.make({ selected: all.selected }))),
      Match.tag('OnlySelected', (only) =>
        Result.succeed(
          OnlyCandidatesSelected.make({
            selected: only.selected,
            excluded: only.excluded,
          }),
        )),
      Match.tag(
        'OnlyUnmatched',
        (unmatched): Result.Result<never, TrustOnlyUnmatched> =>
          Result.fail({ _tag: 'TrustOnlyUnmatched', only: unmatched.only }),
      ),
      Match.exhaustive,
    ),
)
