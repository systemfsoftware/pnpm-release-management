import { Workflow } from '@systemfsoftware/effect-cell-types'
import { CycleEntry, ReleaseTag } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const GithubReleasesDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/GithubReleasesDecision',
)
type GithubReleasesDecisionTypeId = typeof GithubReleasesDecisionTypeId

const ReleaseCreatedEntry = S.Struct({
  tag: S.String,
  id: S.Finite,
})

export class GithubReleasesCreated extends S.TaggedClass<GithubReleasesCreated>()(
  'GithubReleasesCreated',
  { created: S.NonEmptyArray(ReleaseCreatedEntry), skipped: S.Finite },
) {
  readonly [GithubReleasesDecisionTypeId] = GithubReleasesDecisionTypeId
}

export class GithubReleasesSkipped extends S.TaggedClass<GithubReleasesSkipped>()(
  'GithubReleasesSkipped',
  { tags: S.NonEmptyArray(S.String) },
) {
  readonly [GithubReleasesDecisionTypeId] = GithubReleasesDecisionTypeId
}

export class GithubReleasesAsserted extends S.TaggedClass<GithubReleasesAsserted>()(
  'GithubReleasesAsserted',
  { count: S.Finite },
) {
  readonly [GithubReleasesDecisionTypeId] = GithubReleasesDecisionTypeId
}

export class GithubReleasesPreviewed extends S.TaggedClass<GithubReleasesPreviewed>()(
  'GithubReleasesPreviewed',
  { tags: S.NonEmptyArray(S.String) },
) {
  readonly [GithubReleasesDecisionTypeId] = GithubReleasesDecisionTypeId
}

export class GithubReleasesEmpty extends S.TaggedClass<GithubReleasesEmpty>()(
  'GithubReleasesEmpty',
  { cycle: S.Finite },
) {
  readonly [GithubReleasesDecisionTypeId] = GithubReleasesDecisionTypeId
}

export class ChangelogFileMissing extends S.TaggedError<ChangelogFileMissing>()(
  'ChangelogFileMissing',
  {
    package: S.String,
    version: S.String,
    changelog: S.String,
  },
) {}

export class ChangelogFileEmpty extends S.TaggedError<ChangelogFileEmpty>()(
  'ChangelogFileEmpty',
  {
    package: S.String,
    version: S.String,
    changelog: S.String,
  },
) {}

const ReleaseItemSchema = S.Struct({
  entry: CycleEntry,
  body: S.optional(S.String),
})

export type ReleaseItem = S.Schema.Type<typeof ReleaseItemSchema>

export class GithubReleaseCommand extends S.TaggedClass<GithubReleaseCommand>()(
  'GithubReleaseCommand',
  {
    items: S.Array(ReleaseItemSchema),
    assert: S.Boolean,
    preview: S.Boolean,
    existing: S.Array(ReleaseTag),
  },
) {}

const BodyAbsentCase = S.TaggedStruct('ReleaseBodyAbsent', { entry: CycleEntry })
const BodyBlankCase = S.TaggedStruct('ReleaseBodyBlank', { entry: CycleEntry })
const VacantCase = S.TaggedStruct('ReleaseVacant', {})
const AssertingCase = S.TaggedStruct('ReleaseAsserting', {})
const PreviewingCase = S.TaggedStruct('ReleasePreviewing', { tags: S.NonEmptyArray(S.String) })
const TakenCase = S.TaggedStruct('ReleaseTaken', { tags: S.NonEmptyArray(S.String) })
const ReadyCase = S.TaggedStruct('ReleaseReady', { tags: S.NonEmptyArray(S.String) })
const ReleaseCase = S.Union([
  BodyAbsentCase,
  BodyBlankCase,
  VacantCase,
  AssertingCase,
  PreviewingCase,
  TakenCase,
  ReadyCase,
])
type ReleaseCase = S.Schema.Type<typeof ReleaseCase>

const nonEmptyOf = <A>(
  values: ReadonlyArray<A>,
): Option.Option<readonly [A, ...Array<A>]> =>
  Option.map(
    Option.fromNullishOr(values[0]),
    (head): readonly [A, ...Array<A>] => [head, ...values.slice(1)],
  )

const isBlankBody = (body: string | undefined): boolean =>
  Match.value(Option.fromNullishOr(body)).pipe(
    Match.tag('Some', (text) => text.value.trim().length === 0),
    Match.tag('None', () => false),
    Match.exhaustive,
  )

const tagsOf = (
  items: readonly [ReleaseItem, ...Array<ReleaseItem>],
): readonly [string, ...Array<string>] => {
  const [first, ...rest] = items
  return [first.entry.tag, ...rest.map((item) => item.entry.tag)]
}

const remainingCaseOf = (
  command: GithubReleaseCommand,
  items: readonly [ReleaseItem, ...Array<ReleaseItem>],
): ReleaseCase => {
  const remaining = command.items.filter(
    (item) => command.existing.includes(item.entry.tag) === false,
  )
  return Match.value(nonEmptyOf(remaining)).pipe(
    Match.tag('Some', (ready) => ReadyCase.make({ tags: tagsOf(ready.value) })),
    Match.tag('None', () => TakenCase.make({ tags: tagsOf(items) })),
    Match.exhaustive,
  )
}

const previewCaseOf = (
  command: GithubReleaseCommand,
  items: readonly [ReleaseItem, ...Array<ReleaseItem>],
): ReleaseCase =>
  Match.value(command.preview).pipe(
    Match.when(true, () => PreviewingCase.make({ tags: tagsOf(items) })),
    Match.when(false, () => remainingCaseOf(command, items)),
    Match.exhaustive,
  )

const assertingCaseOf = (
  command: GithubReleaseCommand,
  items: readonly [ReleaseItem, ...Array<ReleaseItem>],
): ReleaseCase =>
  Match.value(command.assert).pipe(
    Match.when(true, () => AssertingCase.make({})),
    Match.when(false, () => previewCaseOf(command, items)),
    Match.exhaustive,
  )

const blankCaseOf = (
  command: GithubReleaseCommand,
  items: readonly [ReleaseItem, ...Array<ReleaseItem>],
): ReleaseCase =>
  Match.value(Option.fromNullishOr(command.items.find((item) => isBlankBody(item.body)))).pipe(
    Match.tag('Some', (blank) => BodyBlankCase.make({ entry: blank.value.entry })),
    Match.tag('None', () => assertingCaseOf(command, items)),
    Match.exhaustive,
  )

const itemCaseOf = (
  command: GithubReleaseCommand,
  items: readonly [ReleaseItem, ...Array<ReleaseItem>],
): ReleaseCase =>
  Match.value(Option.fromNullishOr(command.items.find((item) => item.body === undefined))).pipe(
    Match.tag('Some', (missing) => BodyAbsentCase.make({ entry: missing.value.entry })),
    Match.tag('None', () => blankCaseOf(command, items)),
    Match.exhaustive,
  )

const classify = (command: GithubReleaseCommand): ReleaseCase =>
  Match.value(nonEmptyOf(command.items)).pipe(
    Match.tag('Some', (items) => itemCaseOf(command, items.value)),
    Match.tag('None', () => VacantCase.make({})),
    Match.exhaustive,
  )

export const githubRelease = Workflow.make(
  GithubReleaseCommand,
  (
    command,
  ): Result.Result<
    | GithubReleasesCreated
    | GithubReleasesSkipped
    | GithubReleasesAsserted
    | GithubReleasesPreviewed
    | GithubReleasesEmpty,
    ChangelogFileMissing | ChangelogFileEmpty
  > =>
    Match.value(classify(command)).pipe(
      Match.tag('ReleaseBodyAbsent', (bad) =>
        Result.fail(
          ChangelogFileMissing.make({
            package: bad.entry.name,
            version: bad.entry.version,
            changelog: bad.entry.changelog,
          }),
        )),
      Match.tag('ReleaseBodyBlank', (bad) =>
        Result.fail(
          ChangelogFileEmpty.make({
            package: bad.entry.name,
            version: bad.entry.version,
            changelog: bad.entry.changelog,
          }),
        )),
      Match.tag('ReleaseVacant', () => Result.succeed(GithubReleasesEmpty.make({ cycle: 0 }))),
      Match.tag('ReleaseAsserting', () => Result.succeed(GithubReleasesAsserted.make({ count: command.items.length }))),
      Match.tag('ReleasePreviewing', (previewing) =>
        Result.succeed(GithubReleasesPreviewed.make({ tags: [...previewing.tags] }))),
      Match.tag('ReleaseTaken', (taken) =>
        Result.succeed(GithubReleasesSkipped.make({ tags: [...taken.tags] }))),
      Match.tag('ReleaseReady', (ready) => Result.succeed(GithubReleasesPreviewed.make({ tags: [...ready.tags] }))),
      Match.exhaustive,
    ),
)
