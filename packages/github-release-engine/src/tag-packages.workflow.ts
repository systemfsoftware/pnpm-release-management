import { Workflow } from '@systemfsoftware/effect-cell-types'
import { CycleEntry, FsPath } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const TagPackagesDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/TagPackagesDecision',
)
type TagPackagesDecisionTypeId = typeof TagPackagesDecisionTypeId

export class TagPackagesPreviewed extends S.TaggedClass<TagPackagesPreviewed>()(
  'TagPackagesPreviewed',
  { tags: S.Array(S.String) },
) {
  readonly [TagPackagesDecisionTypeId] = TagPackagesDecisionTypeId
}

export class TagPackagesUpToDate extends S.TaggedClass<TagPackagesUpToDate>()(
  'TagPackagesUpToDate',
  { tags: S.Finite },
) {
  readonly [TagPackagesDecisionTypeId] = TagPackagesDecisionTypeId
}

export class TagPackagesPushed extends S.TaggedClass<TagPackagesPushed>()(
  'TagPackagesPushed',
  { tags: S.NonEmptyArray(S.String) },
) {
  readonly [TagPackagesDecisionTypeId] = TagPackagesDecisionTypeId
}

export class CapturedListMalformed extends S.TaggedError<CapturedListMalformed>()(
  'CapturedListMalformed',
  { path: FsPath },
) {}

export class ExcludedListMalformed extends S.TaggedError<ExcludedListMalformed>()(
  'ExcludedListMalformed',
  { path: FsPath },
) {}

const nonEmpty = <A>(list: ReadonlyArray<A>): [A, ...Array<A>] => {
  const [first, ...rest] = list
  if (first === undefined) {
    throw new Error('nonEmpty: empty list')
  }
  return [first, ...rest]
}

const tagsOf = (cycle: ReadonlyArray<CycleEntry>): Array<string> => cycle.map((entry) => entry.tag)

const TagCase = S.Union([
  S.TaggedStruct('TagCapturedBad', { path: FsPath }),
  S.TaggedStruct('TagExcludedBad', { path: FsPath }),
  S.TaggedStruct('TagPreviewing', {}),
  S.TaggedStruct('TagVacant', {}),
  S.TaggedStruct('TagReady', {}),
])

type TagCase = S.Schema.Type<typeof TagCase>

export class TagCommand extends S.TaggedClass<TagCommand>()('TagCommand', {
  cycle: S.Array(CycleEntry),
  preview: S.Boolean,
  capturedIssue: S.optional(FsPath),
  excludedIssue: S.optional(FsPath),
}) {}

const classify = (command: TagCommand): TagCase => {
  if (command.capturedIssue !== undefined) {
    return { _tag: 'TagCapturedBad', path: command.capturedIssue }
  }
  if (command.excludedIssue !== undefined) {
    return { _tag: 'TagExcludedBad', path: command.excludedIssue }
  }
  if (command.preview) {
    return { _tag: 'TagPreviewing' }
  }
  if (command.cycle.length === 0) {
    return { _tag: 'TagVacant' }
  }
  return { _tag: 'TagReady' }
}

export const tagPackages = Workflow.make(
  TagCommand,
  (
    command,
  ): Result.Result<
    TagPackagesPreviewed | TagPackagesUpToDate | TagPackagesPushed,
    CapturedListMalformed | ExcludedListMalformed
  > =>
    Match.value(classify(command)).pipe(
      Match.tag('TagCapturedBad', (bad) => Result.fail(CapturedListMalformed.make({ path: bad.path }))),
      Match.tag('TagExcludedBad', (bad) => Result.fail(ExcludedListMalformed.make({ path: bad.path }))),
      Match.tag(
        'TagPreviewing',
        () => Result.succeed(TagPackagesPreviewed.make({ tags: tagsOf(command.cycle) })),
      ),
      Match.tag('TagVacant', () => Result.succeed(TagPackagesUpToDate.make({ tags: 0 }))),
      Match.tag(
        'TagReady',
        () =>
          Result.succeed(
            TagPackagesPushed.make({
              tags: nonEmpty(tagsOf(command.cycle)),
            }),
          ),
      ),
      Match.exhaustive,
    ),
)
