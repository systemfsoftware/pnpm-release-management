import { Workflow } from '@systemfsoftware/effect-cell-types'
import { CycleEntry, FsPath } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
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

export class TagCommand extends S.TaggedClass<TagCommand>()('TagCommand', {
  cycle: S.Array(CycleEntry),
  preview: S.Boolean,
  capturedIssue: S.optional(FsPath),
  excludedIssue: S.optional(FsPath),
}) {}

const CapturedBadCase = S.TaggedStruct('TagCapturedBad', { path: FsPath })
const ExcludedBadCase = S.TaggedStruct('TagExcludedBad', { path: FsPath })
const PreviewingCase = S.TaggedStruct('TagPreviewing', { tags: S.Array(S.String) })
const VacantCase = S.TaggedStruct('TagVacant', {})
const ReadyCase = S.TaggedStruct('TagReady', { tags: S.NonEmptyArray(S.String) })
const TagCase = S.Union([CapturedBadCase, ExcludedBadCase, PreviewingCase, VacantCase, ReadyCase])
type TagCase = S.Schema.Type<typeof TagCase>

const nonEmptyOf = <A>(
  values: ReadonlyArray<A>,
): Option.Option<readonly [A, ...Array<A>]> =>
  Option.map(
    Option.fromNullishOr(values[0]),
    (head): readonly [A, ...Array<A>] => [head, ...values.slice(1)],
  )

const readyTagsOf = (
  cycle: readonly [CycleEntry, ...Array<CycleEntry>],
): readonly [string, ...Array<string>] => {
  const [first, ...rest] = cycle
  return [first.tag, ...rest.map((entry) => entry.tag)]
}

const cycleCaseOf = (command: TagCommand): TagCase =>
  Match.value(nonEmptyOf(command.cycle)).pipe(
    Match.tag('Some', (cycle) => ReadyCase.make({ tags: readyTagsOf(cycle.value) })),
    Match.tag('None', () => VacantCase.make({})),
    Match.exhaustive,
  )

const previewCaseOf = (command: TagCommand): TagCase =>
  Match.value(command.preview).pipe(
    Match.when(true, () => PreviewingCase.make({ tags: command.cycle.map((entry) => entry.tag) })),
    Match.when(false, () => cycleCaseOf(command)),
    Match.exhaustive,
  )

const excludedCaseOf = (command: TagCommand): TagCase =>
  Match.value(Option.fromNullishOr(command.excludedIssue)).pipe(
    Match.tag('Some', (excluded) => ExcludedBadCase.make({ path: excluded.value })),
    Match.tag('None', () => previewCaseOf(command)),
    Match.exhaustive,
  )

const classify = (command: TagCommand): TagCase =>
  Match.value(Option.fromNullishOr(command.capturedIssue)).pipe(
    Match.tag('Some', (captured) => CapturedBadCase.make({ path: captured.value })),
    Match.tag('None', () => excludedCaseOf(command)),
    Match.exhaustive,
  )

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
      Match.tag('TagPreviewing', (previewing) =>
        Result.succeed(TagPackagesPreviewed.make({ tags: [...previewing.tags] }))),
      Match.tag('TagVacant', () =>
        Result.succeed(TagPackagesUpToDate.make({ tags: 0 }))),
      Match.tag('TagReady', (ready) => Result.succeed(TagPackagesPushed.make({ tags: [...ready.tags] }))),
      Match.exhaustive,
    ),
)
