import { Workflow } from '@systemfsoftware/effect-cell-types'
import { CycleEntry, ReleaseTag } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const GithubReleasesDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/GithubReleasesDecision',
)
type GithubReleasesDecisionTypeId = typeof GithubReleasesDecisionTypeId

const ReleaseCreatedEntry = S.Struct({
  tag: S.String,
  id: S.Number,
})

export class GithubReleasesCreated extends S.TaggedClass<GithubReleasesCreated>()(
  'GithubReleasesCreated',
  { created: S.NonEmptyArray(ReleaseCreatedEntry), skipped: S.Number },
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
  { count: S.Number },
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
  { cycle: S.Number },
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

const ReleaseItem = S.Struct({
  entry: CycleEntry,
  body: S.optional(S.String),
})

type ReleaseItem = S.Schema.Type<typeof ReleaseItem>

export class GithubReleaseCommand extends S.TaggedClass<GithubReleaseCommand>()(
  'GithubReleaseCommand',
  {
    items: S.Array(ReleaseItem),
    assert: S.Boolean,
    preview: S.Boolean,
    existing: S.Array(ReleaseTag),
  },
) {}

const GithubReleaseCase = S.Union([
  S.TaggedStruct('ReleaseBodyAbsent', { entry: CycleEntry }),
  S.TaggedStruct('ReleaseBodyBlank', { entry: CycleEntry }),
  S.TaggedStruct('ReleaseVacant', {}),
  S.TaggedStruct('ReleaseAsserting', {}),
  S.TaggedStruct('ReleasePreviewing', {}),
  S.TaggedStruct('ReleaseTaken', { tags: S.Array(S.String) }),
  S.TaggedStruct('ReleaseReady', { tags: S.Array(S.String) }),
])

type GithubReleaseCase = S.Schema.Type<typeof GithubReleaseCase>

const nonEmpty = <A>(list: ReadonlyArray<A>): [A, ...Array<A>] => {
  const [first, ...rest] = list
  if (first === undefined) {
    throw new Error('nonEmpty: empty list')
  }
  return [first, ...rest]
}

const tagsOf = (items: ReadonlyArray<ReleaseItem>): Array<string> => items.map((item) => item.entry.tag)

const classify = (command: GithubReleaseCommand): GithubReleaseCase => {
  if (command.items.length === 0) {
    return { _tag: 'ReleaseVacant' }
  }
  const missing = command.items.find((item) => item.body === undefined)
  if (missing !== undefined) {
    return { _tag: 'ReleaseBodyAbsent', entry: missing.entry }
  }
  const blank = command.items.find((item) => (item.body ?? '').trim().length === 0)
  if (blank !== undefined) {
    return { _tag: 'ReleaseBodyBlank', entry: blank.entry }
  }
  if (command.assert) {
    return { _tag: 'ReleaseAsserting' }
  }
  if (command.preview) {
    return { _tag: 'ReleasePreviewing' }
  }
  const remaining = command.items.filter((item) => !command.existing.includes(item.entry.tag))
  if (remaining.length === 0) {
    return { _tag: 'ReleaseTaken', tags: tagsOf(command.items) }
  }
  return { _tag: 'ReleaseReady', tags: tagsOf(remaining) }
}

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
          new ChangelogFileMissing({
            package: bad.entry.name,
            version: bad.entry.version,
            changelog: bad.entry.changelog,
          }),
        )),
      Match.tag('ReleaseBodyBlank', (bad) =>
        Result.fail(
          new ChangelogFileEmpty({
            package: bad.entry.name,
            version: bad.entry.version,
            changelog: bad.entry.changelog,
          }),
        )),
      Match.tag('ReleaseVacant', () => Result.succeed(new GithubReleasesEmpty({ cycle: 0 }))),
      Match.tag(
        'ReleaseAsserting',
        () => Result.succeed(new GithubReleasesAsserted({ count: command.items.length })),
      ),
      Match.tag('ReleasePreviewing', () => {
        const tags = nonEmpty(tagsOf(command.items))
        return Result.succeed(new GithubReleasesPreviewed({ tags }))
      }),
      Match.tag('ReleaseTaken', (taken) => {
        const tags = nonEmpty([...taken.tags])
        return Result.succeed(new GithubReleasesSkipped({ tags }))
      }),
      Match.tag('ReleaseReady', (ready) => {
        const tags = nonEmpty([...ready.tags])
        return Result.succeed(new GithubReleasesPreviewed({ tags }))
      }),
      Match.exhaustive,
    ),
)
