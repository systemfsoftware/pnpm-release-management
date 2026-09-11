import { Workflow } from '@systemfsoftware/effect-cell-types'
import {
  Count,
  CycleEntry,
  DecisionTypeId,
  PackageName,
  PackageVersion,
  RelativePath,
  ReleaseId,
  ReleaseTag,
  RepoSlug,
} from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ReleaseCreatedEntry = S.Struct({
  tag: ReleaseTag,
  id: ReleaseId,
})

export type CreatedRelease = S.Schema.Type<typeof ReleaseCreatedEntry>

export class GithubReleaseCreated extends S.TaggedClass<GithubReleaseCreated>()(
  'GithubReleaseCreated',
  { created: S.NonEmptyArray(ReleaseCreatedEntry), skipped: Count },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class GithubReleaseSkipped extends S.TaggedClass<GithubReleaseSkipped>()(
  'GithubReleaseSkipped',
  { tags: S.NonEmptyArray(ReleaseTag) },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class GithubReleaseAsserted extends S.TaggedClass<GithubReleaseAsserted>()(
  'GithubReleaseAsserted',
  { count: S.Finite },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class GithubReleasePreview extends S.TaggedClass<GithubReleasePreview>()(
  'GithubReleasePreview',
  { tags: S.NonEmptyArray(ReleaseTag) },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class GithubReleaseEmpty extends S.TaggedClass<GithubReleaseEmpty>()(
  'GithubReleaseEmpty',
  { cycle: S.Finite },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class ReleaseChangelogMissing extends S.TaggedError<ReleaseChangelogMissing>()(
  'ReleaseChangelogMissing',
  {
    package: PackageName,
    version: PackageVersion,
    changelog: RelativePath,
  },
) {}

export class ReleaseChangelogEmpty extends S.TaggedError<ReleaseChangelogEmpty>()(
  'ReleaseChangelogEmpty',
  {
    package: PackageName,
    version: PackageVersion,
    changelog: RelativePath,
  },
) {}

export type GithubReleaseDecision =
  | GithubReleaseCreated
  | GithubReleaseSkipped
  | GithubReleaseAsserted
  | GithubReleasePreview
  | GithubReleaseEmpty

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
    slug: RepoSlug,
  },
) {}

const BodyAbsentCase = S.TaggedStruct('BodyAbsent', { entry: CycleEntry })
const BodyBlankCase = S.TaggedStruct('BodyBlank', { entry: CycleEntry })
const VacantCase = S.TaggedStruct('Vacant', { cycle: S.Finite })
const AssertingCase = S.TaggedStruct('Asserting', { count: S.Finite })
const PreviewingCase = S.TaggedStruct('Previewing', { tags: S.NonEmptyArray(ReleaseTag) })
const TakenCase = S.TaggedStruct('Taken', { tags: S.NonEmptyArray(ReleaseTag) })
const ReadyCase = S.TaggedStruct('Ready', { tags: S.NonEmptyArray(ReleaseTag) })
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

const tagsOf = (
  items: readonly [ReleaseItem, ...Array<ReleaseItem>],
): readonly [ReleaseTag, ...Array<ReleaseTag>] => {
  const [first, ...rest] = items
  return [first.entry.tag, ...rest.map((item) => item.entry.tag)]
}

const releaseCaseOf = (command: GithubReleaseCommand): ReleaseCase => {
  const [first, ...rest] = command.items
  if (first === undefined) {
    return VacantCase.make({ cycle: command.items.length })
  }
  const missing = command.items.find((item) => item.body === undefined)
  if (missing !== undefined) {
    return BodyAbsentCase.make({ entry: missing.entry })
  }
  const blank = command.items.find(
    (item) => item.body !== undefined && item.body.trim().length === 0,
  )
  if (blank !== undefined) {
    return BodyBlankCase.make({ entry: blank.entry })
  }
  if (command.assert) {
    return AssertingCase.make({ count: command.items.length })
  }
  const tags = tagsOf([first, ...rest])
  if (command.preview) {
    return PreviewingCase.make({ tags })
  }
  const [firstRemaining, ...restRemaining] = command.items.filter(
    (item) => command.existing.includes(item.entry.tag) === false,
  )
  if (firstRemaining === undefined) {
    return TakenCase.make({ tags })
  }
  return ReadyCase.make({
    tags: [firstRemaining.entry.tag, ...restRemaining.map((item) => item.entry.tag)],
  })
}

export const githubRelease = Workflow.make(
  GithubReleaseCommand,
  (
    command,
  ): Result.Result<
    | GithubReleaseCreated
    | GithubReleaseSkipped
    | GithubReleaseAsserted
    | GithubReleasePreview
    | GithubReleaseEmpty,
    ReleaseChangelogMissing | ReleaseChangelogEmpty
  > =>
    Match.value(releaseCaseOf(command)).pipe(
      Match.tag('BodyAbsent', (absent) =>
        Result.fail(
          ReleaseChangelogMissing.make({
            package: absent.entry.name,
            version: absent.entry.version,
            changelog: absent.entry.changelog,
          }),
        )),
      Match.tag('BodyBlank', (blank) =>
        Result.fail(
          ReleaseChangelogEmpty.make({
            package: blank.entry.name,
            version: blank.entry.version,
            changelog: blank.entry.changelog,
          }),
        )),
      Match.tag('Vacant', (vacant) => Result.succeed(GithubReleaseEmpty.make({ cycle: vacant.cycle }))),
      Match.tag('Asserting', (asserting) => Result.succeed(GithubReleaseAsserted.make({ count: asserting.count }))),
      Match.tag(
        'Previewing',
        (previewing) => Result.succeed(GithubReleasePreview.make({ tags: [...previewing.tags] })),
      ),
      Match.tag('Taken', (taken) => Result.succeed(GithubReleaseSkipped.make({ tags: [...taken.tags] }))),
      Match.tag('Ready', (ready) => Result.succeed(GithubReleasePreview.make({ tags: [...ready.tags] }))),
      Match.exhaustive,
    ),
)
