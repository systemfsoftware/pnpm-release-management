import { Workflow } from '@systemfsoftware/effect-cell-types'
import {
  Count,
  DecisionTypeId,
  IntegrityFilesEmpty,
  IntegrityNothingToVerify,
  PackageName,
  TagIntegrityMismatch,
} from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class UnreleasedVacant extends S.TaggedClass<UnreleasedVacant>()('UnreleasedVacant', {}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class UnreleasedListed extends S.TaggedClass<UnreleasedListed>()('UnreleasedListed', {
  packages: S.NonEmptyArray(PackageName),
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class UnreleasedMatched extends S.TaggedClass<UnreleasedMatched>()('UnreleasedMatched', {
  packages: S.NonEmptyArray(PackageName),
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class TarballsCompared extends S.TaggedClass<TarballsCompared>()('TarballsCompared', {
  count: Count,
}) {}

const ComparisonRefusal = S.Union([TagIntegrityMismatch, IntegrityFilesEmpty, IntegrityNothingToVerify])
type ComparisonRefusal = S.Schema.Type<typeof ComparisonRefusal>

export class UnreleasedTarballsCommand extends S.TaggedClass<UnreleasedTarballsCommand>()(
  'UnreleasedTarballsCommand',
  {
    packages: S.Array(PackageName),
    comparison: S.optional(S.Union([TarballsCompared, ComparisonRefusal])),
  },
) {}

const VacantCase = S.TaggedStruct('Vacant', {})
const ListedCase = S.TaggedStruct('Listed', { packages: S.NonEmptyArray(PackageName) })
const MatchedCase = S.TaggedStruct('Matched', { packages: S.NonEmptyArray(PackageName) })
const RefusedCase = S.TaggedStruct('Refused', { refusal: ComparisonRefusal })
const UnreleasedCase = S.Union([VacantCase, ListedCase, MatchedCase, RefusedCase])
type UnreleasedCase = S.Schema.Type<typeof UnreleasedCase>

const unreleasedCaseOf = (command: UnreleasedTarballsCommand): UnreleasedCase => {
  const [first, ...rest] = command.packages
  if (first === undefined) {
    return VacantCase.make({})
  }
  const comparison = command.comparison
  if (comparison === undefined) {
    return ListedCase.make({ packages: [first, ...rest] })
  }
  if (S.is(TarballsCompared)(comparison)) {
    return MatchedCase.make({ packages: [first, ...rest] })
  }
  return RefusedCase.make({ refusal: comparison })
}

export const compareUnreleasedTarballs = Workflow.make(
  UnreleasedTarballsCommand,
  (
    command,
  ): Result.Result<UnreleasedVacant | UnreleasedListed | UnreleasedMatched, ComparisonRefusal> =>
    Match.value(unreleasedCaseOf(command)).pipe(
      Match.tag('Vacant', () => Result.succeed(UnreleasedVacant.make({}))),
      Match.tag('Listed', (listed) => Result.succeed(UnreleasedListed.make({ packages: listed.packages }))),
      Match.tag('Matched', (matched) => Result.succeed(UnreleasedMatched.make({ packages: matched.packages }))),
      Match.tag('Refused', (refused) => Result.fail(refused.refusal)),
      Match.exhaustive,
    ),
)
