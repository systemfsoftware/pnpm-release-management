import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import type {
  CreatedRelease,
  CycleEntry,
  GithubReleaseDecision,
  GithubReleaseRefusal,
  MemberRefusal,
  PlanRefusal,
  RepoSlug,
  TagRefusal,
} from '@systemfsoftware/release-language'
import {
  Count,
  CycleStore,
  ForgePort,
  FsPath,
  GithubReleaseAsserted,
  GithubReleaseCreated,
  GithubReleaseEmpty,
  GithubReleasePreview,
  GithubReleaseSkipped,
  GitPort,
  PackageName,
  PackageVersion,
  RelativePath,
  ReleaseChangelogEmpty,
  ReleaseChangelogMissing,
  ReleaseId,
  ReleaseTag,
  RemoteName,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { cycleOf } from './cycle.js'
import {
  type ChangelogFileEmpty,
  type ChangelogFileMissing,
  githubRelease,
  GithubReleaseCommand,
  type GithubReleasesAsserted,
  type GithubReleasesCreated,
  type GithubReleasesEmpty,
  type GithubReleasesPreviewed,
  type GithubReleasesSkipped,
  type ReleaseItem,
} from './github-release.workflow.js'

export const GithubReleaseRequest = Wire.wire({
  captured: Wire.mint(S.optional(FsPath)),
  capturedFile: Wire.mint(S.optional(FsPath)),
  assert: Wire.mint(S.Boolean),
  dryRun: Wire.mint(S.Boolean),
  changelogDir: Wire.mint(RelativePath),
})

interface RawRelease {
  readonly items: ReadonlyArray<ReleaseItem>
  readonly assert: boolean
  readonly preview: boolean
  readonly existing: ReadonlyArray<ReleaseTag>
  readonly slug: RepoSlug
}

const readCycle = (
  cycles: CycleStore,
  workspace: WorkspaceStore,
  git: GitPort,
  capturedPath: FsPath | undefined,
  changelogDir: RelativePath,
): Effect.Effect<ReadonlyArray<CycleEntry>, PlanRefusal | MemberRefusal | TagRefusal, never> => {
  if (capturedPath !== undefined) {
    return cycles.readCaptured(capturedPath)
  }
  return Effect.gen(function*() {
    const members = yield* workspace.listMembers()
    const tags = yield* git.remoteTags(RemoteName.make('origin'))
    return cycleOf(members, tags, changelogDir)
  })
}

const read = (
  request: S.Schema.Type<typeof GithubReleaseRequest>,
): Effect.Effect<
  RawRelease,
  MemberRefusal | TagRefusal | PlanRefusal | GithubReleaseRefusal,
  WorkspaceStore | GitPort | CycleStore | ForgePort
> =>
  Effect.gen(function*() {
    const workspace = yield* WorkspaceStore
    const git = yield* GitPort
    const cycles = yield* CycleStore
    const forge = yield* ForgePort
    const cycle = yield* readCycle(
      cycles,
      workspace,
      git,
      request.captured ?? request.capturedFile,
      request.changelogDir,
    )
    const slug = yield* git.repoSlug()
    const items = yield* Effect.forEach(cycle, (entry) =>
      Effect.map(
        Effect.match(workspace.readFileFromRoot(entry.changelog), {
          onFailure: () => undefined,
          onSuccess: (file) => file.text,
        }),
        (body) => ({ entry, body }),
      ))
    const released = yield* Effect.forEach(cycle, (entry) =>
      Effect.map(
        forge.releaseByTag(slug, entry.tag),
        (lookup) =>
          Match.value(lookup).pipe(
            Match.tag('ReleaseFound', () => entry.tag),
            Match.tag('ReleaseAbsent', () => undefined),
            Match.exhaustive,
          ),
      ))
    return {
      items,
      assert: request.assert,
      preview: request.dryRun,
      existing: released.filter((tag): tag is ReleaseTag => tag !== undefined),
      slug,
    }
  })

const decode = (raw: RawRelease): Result.Result<GithubReleaseCommand, never> =>
  Result.succeed(
    GithubReleaseCommand.make({
      items: raw.items.map((item) => ({ entry: item.entry, body: item.body })),
      assert: raw.assert,
      preview: raw.preview,
      existing: [...raw.existing],
    }),
  )

const createdReleaseOf = (entry: {
  readonly tag: string
  readonly id: number
}): CreatedRelease => ({
  tag: ReleaseTag.make(entry.tag),
  id: ReleaseId.make(entry.id),
})

const releaseTagsOf = (
  tags: readonly [string, ...Array<string>],
): readonly [ReleaseTag, ...Array<ReleaseTag>] => {
  const [first, ...rest] = tags
  return [ReleaseTag.make(first), ...rest.map((tag) => ReleaseTag.make(tag))]
}

const toDecision = (
  decision:
    | GithubReleasesCreated
    | GithubReleasesSkipped
    | GithubReleasesAsserted
    | GithubReleasesPreviewed
    | GithubReleasesEmpty,
): GithubReleaseDecision =>
  Match.value(decision).pipe(
    Match.tag('GithubReleasesCreated', (created) => {
      const [first, ...rest] = created.created
      return GithubReleaseCreated.make({
        created: [createdReleaseOf(first), ...rest.map(createdReleaseOf)],
        skipped: Count.make(created.skipped),
      })
    }),
    Match.tag('GithubReleasesSkipped', (skipped) => GithubReleaseSkipped.make({ tags: releaseTagsOf(skipped.tags) })),
    Match.tag(
      'GithubReleasesAsserted',
      (asserted) => GithubReleaseAsserted.make({ count: Count.make(asserted.count) }),
    ),
    Match.tag(
      'GithubReleasesPreviewed',
      (previewed) => GithubReleasePreview.make({ tags: releaseTagsOf(previewed.tags) }),
    ),
    Match.tag('GithubReleasesEmpty', (empty) => GithubReleaseEmpty.make({ cycle: Count.make(empty.cycle) })),
    Match.exhaustive,
  )

const toRefusal = (bad: ChangelogFileMissing | ChangelogFileEmpty): GithubReleaseRefusal =>
  Match.value(bad).pipe(
    Match.tag('ChangelogFileMissing', (missing) =>
      ReleaseChangelogMissing.make({
        package: PackageName.make(missing.package),
        version: PackageVersion.make(missing.version),
        changelog: RelativePath.make(missing.changelog),
      })),
    Match.tag('ChangelogFileEmpty', (empty) =>
      ReleaseChangelogEmpty.make({
        package: PackageName.make(empty.package),
        version: PackageVersion.make(empty.version),
        changelog: RelativePath.make(empty.changelog),
      })),
    Match.exhaustive,
  )

const encode = (
  outcome: Result.Result<
    | GithubReleasesCreated
    | GithubReleasesSkipped
    | GithubReleasesAsserted
    | GithubReleasesPreviewed
    | GithubReleasesEmpty,
    ChangelogFileMissing | ChangelogFileEmpty
  >,
): Result.Result<GithubReleaseDecision, GithubReleaseRefusal> =>
  Result.mapError(outcome, toRefusal).pipe(Result.map(toDecision))

const bodyOf = (raw: RawRelease, tag: ReleaseTag): string => {
  const item = raw.items.find((candidate) => candidate.entry.tag === tag)
  if (item === undefined) {
    return ''
  }
  if (item.body === undefined) {
    return ''
  }
  return item.body
}

const createMissing = (
  forge: ForgePort,
  raw: RawRelease,
  tag: ReleaseTag,
): Effect.Effect<CreatedRelease | undefined, GithubReleaseRefusal, never> =>
  Effect.flatMap(forge.releaseByTag(raw.slug, tag), (lookup) =>
    Match.value(lookup).pipe(
      Match.tag('ReleaseFound', () => Effect.succeed(undefined)),
      Match.tag('ReleaseAbsent', () =>
        Effect.map(
          forge.createRelease(raw.slug, tag, bodyOf(raw, tag)),
          (id) => ({ tag, id }),
        )),
      Match.exhaustive,
    ))

const publishPreview = (
  preview: GithubReleasePreview,
  raw: RawRelease,
): Effect.Effect<GithubReleaseDecision, GithubReleaseRefusal, ForgePort> => {
  if (raw.preview) {
    return Effect.succeed(preview)
  }
  return Effect.gen(function*() {
    const forge = yield* ForgePort
    const created = yield* Effect.forEach(preview.tags, (tag) => createMissing(forge, raw, tag))
    const published = created.filter((entry): entry is CreatedRelease => entry !== undefined)
    const [first, ...rest] = published
    if (first === undefined) {
      return GithubReleaseSkipped.make({ tags: preview.tags })
    }
    yield* forge.promoteLatest(raw.slug, first.id)
    return GithubReleaseCreated.make({
      created: [first, ...rest],
      skipped: Count.make(preview.tags.length - published.length),
    })
  })
}

const write = (
  output: Result.Result<GithubReleaseDecision, GithubReleaseRefusal>,
  raw: RawRelease,
): Effect.Effect<GithubReleaseDecision, GithubReleaseRefusal, ForgePort> => {
  if (Result.isFailure(output)) {
    return Effect.fail(output.failure)
  }
  return Match.value(output.success).pipe(
    Match.tag('GithubReleasePreview', (preview) => publishPreview(preview, raw)),
    Match.tag('GithubReleaseCreated', (created) => Effect.succeed(created)),
    Match.tag('GithubReleaseSkipped', (skipped) => Effect.succeed(skipped)),
    Match.tag('GithubReleaseAsserted', (asserted) => Effect.succeed(asserted)),
    Match.tag('GithubReleaseEmpty', (empty) => Effect.succeed(empty)),
    Match.exhaustive,
  )
}

export const githubReleaseCell: Cell.Cell<
  S.Schema.Type<typeof GithubReleaseRequest>,
  GithubReleaseDecision,
  MemberRefusal | TagRefusal | PlanRefusal | GithubReleaseRefusal,
  WorkspaceStore | GitPort | CycleStore | ForgePort
> = Cell.layer({
  read,
  decode,
  decide: githubRelease,
  encode,
  write,
})
