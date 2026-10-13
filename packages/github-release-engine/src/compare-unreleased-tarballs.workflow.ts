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

const ComparisonRefusal = S.Union([TagIntegrityMismatch, IntegrityFilesEmpty, IntegrityNothingToVerify])
export type ComparisonRefusal = S.Schema.Type<typeof ComparisonRefusal>

const NoTargets = S.TaggedStruct('NoTargets', {})
const AwaitingTarballs = S.TaggedStruct('AwaitingTarballs', { packages: S.NonEmptyArray(PackageName) })
const TarballsCompared = S.TaggedStruct('TarballsCompared', {
  packages: S.NonEmptyArray(PackageName),
  count: Count,
})
const TarballsRefused = S.TaggedStruct('TarballsRefused', {
  packages: S.NonEmptyArray(PackageName),
  refusal: ComparisonRefusal,
})
const UnreleasedTargets = S.Union([NoTargets, AwaitingTarballs, TarballsCompared, TarballsRefused])
export type UnreleasedTargets = S.Schema.Type<typeof UnreleasedTargets>

export class UnreleasedTarballsCommand extends S.TaggedClass<UnreleasedTarballsCommand>()(
  'UnreleasedTarballsCommand',
  { targets: UnreleasedTargets },
) {}

export const compareUnreleasedTarballs = Workflow.make(
  UnreleasedTarballsCommand,
  (
    command,
  ): Result.Result<UnreleasedVacant | UnreleasedListed | UnreleasedMatched, ComparisonRefusal> =>
    Match.value(command.targets).pipe(
      Match.tagsExhaustive({
        NoTargets: () => Result.succeed(UnreleasedVacant.make({})),
        AwaitingTarballs: (awaiting) => Result.succeed(UnreleasedListed.make({ packages: awaiting.packages })),
        TarballsCompared: (compared) => Result.succeed(UnreleasedMatched.make({ packages: compared.packages })),
        TarballsRefused: (refused) => Result.fail(refused.refusal),
      }),
    ),
)
