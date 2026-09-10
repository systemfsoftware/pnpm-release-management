import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import type { CycleEntry, MemberRefusal, TagRefusal } from '@systemfsoftware/release-language'
import type {
  CreatedRelease,
  GithubReleaseDecision,
  GithubReleaseRefusal,
  PlanRefusal,
  RepoSlug,
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
import { computeCycle, nonEmptyArray } from './cycle.ts'
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
} from './github-release.workflow.ts'

export const GithubReleaseRequest = Wire.wire({
  captured: Wire.mint(S.optional(FsPath)),
  capturedFile: Wire.mint(S.optional(FsPath)),
  assert: Wire.mint(S.Boolean),
  dryRun: Wire.mint(S.Boolean),
  changelogDir: Wire.mint(RelativePath),
})

class RawRelease {
  constructor(
    readonly items: Array<{ readonly entry: CycleEntry; readonly body: string | undefined }>,
    readonly assert: boolean,
    readonly preview: boolean,
    readonly existing: Array<ReleaseTag>,
    readonly slug: RepoSlug,
  ) {}
}

const read = (
  request: S.Schema.Type<typeof GithubReleaseRequest>,
): Effect.Effect<
  RawRelease,
  MemberRefusal | TagRefusal | PlanRefusal | GithubReleaseRefusal,
  WorkspaceStore | GitPort | CycleStore | ForgePort
> =>
  Effect.gen(function*() {
    const capturedPath = request.captured ?? request.capturedFile
    const workspace = yield* WorkspaceStore
    const git = yield* GitPort
    const cycles = yield* CycleStore
    const forge = yield* ForgePort
    let cycle: Array<CycleEntry>
    if (capturedPath === undefined) {
      const members = yield* workspace.listMembers()
      const tags = yield* git.remoteTags(RemoteName.make('origin'))
      cycle = computeCycle(members, tags, request.changelogDir)
    } else {
      cycle = [...(yield* cycles.readCaptured(capturedPath))]
    }
    const items: Array<{ readonly entry: CycleEntry; readonly body: string | undefined }> = []
    for (const entry of cycle) {
      const body = yield* Effect.match(workspace.readFileFromRoot(entry.changelog), {
        onFailure: () => undefined,
        onSuccess: (file) => file.text,
      })
      items.push({ entry, body })
    }
    const slug = yield* git.repoSlug()
    const existing: Array<ReleaseTag> = []
    for (const entry of cycle) {
      const lookup = yield* forge.releaseByTag(slug, entry.tag)
      if (lookup._tag === 'ReleaseFound') {
        existing.push(entry.tag)
      }
    }
    return new RawRelease(items, request.assert, request.dryRun, existing, slug)
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

interface EncodedRelease {
  readonly decision: GithubReleaseDecision
  readonly tags: Array<ReleaseTag>
}

const toLanguage = (
  decision:
    | GithubReleasesCreated
    | GithubReleasesSkipped
    | GithubReleasesAsserted
    | GithubReleasesPreviewed
    | GithubReleasesEmpty,
): GithubReleaseDecision =>
  Match.value(decision).pipe(
    Match.tag('GithubReleasesCreated', (created) =>
      GithubReleaseCreated.make({
        created: nonEmptyArray(
          created.created.map((release) => ({
            tag: ReleaseTag.make(release.tag),
            id: ReleaseId.make(release.id),
          })),
        ),
        skipped: Count.make(created.skipped),
      })),
    Match.tag('GithubReleasesSkipped', (skipped) =>
      GithubReleaseSkipped.make({
        tags: nonEmptyArray(skipped.tags.map((t) => ReleaseTag.make(t))),
      })),
    Match.tag(
      'GithubReleasesAsserted',
      (asserted) => GithubReleaseAsserted.make({ count: Count.make(asserted.count) }),
    ),
    Match.tag('GithubReleasesPreviewed', (previewed) =>
      GithubReleasePreview.make({
        tags: nonEmptyArray(previewed.tags.map((t) => ReleaseTag.make(t))),
      })),
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
): Result.Result<EncodedRelease, GithubReleaseRefusal> =>
  Result.mapError(outcome, toRefusal).pipe(Result.map((decision) => {
    const converted = toLanguage(decision)
    return {
      decision: converted,
      tags: Match.value(converted).pipe(
        Match.tag('GithubReleaseCreated', (created) => created.created.map((r) => r.tag)),
        Match.tag('GithubReleaseSkipped', (skipped) => [...skipped.tags]),
        Match.tag('GithubReleaseAsserted', () => []),
        Match.tag('GithubReleasePreview', (preview) => [...preview.tags]),
        Match.tag('GithubReleaseEmpty', () => []),
        Match.exhaustive,
      ),
    }
  }))

const write = (
  output: Result.Result<EncodedRelease, GithubReleaseRefusal>,
  raw: RawRelease,
): Effect.Effect<GithubReleaseDecision, GithubReleaseRefusal, ForgePort> => {
  if (Result.isFailure(output)) {
    return Effect.fail(output.failure)
  }
  const encoded = output.success
  return Effect.gen(function*() {
    const forge = yield* ForgePort
    return yield* Match.value(encoded.decision).pipe(
      Match.tag('GithubReleasePreview', (preview) =>
        raw.preview
          ? Effect.succeed(preview)
          : Effect.gen(function*() {
            const created: Array<CreatedRelease> = []
            for (const tag of preview.tags) {
              const item = raw.items.find((candidate) => candidate.entry.tag === tag)
              const lookup = yield* forge.releaseByTag(raw.slug, tag)
              if (lookup._tag === 'ReleaseAbsent') {
                created.push({ tag, id: yield* forge.createRelease(raw.slug, tag, item?.body ?? '') })
              }
            }
            const first = created[0]
            if (first === undefined) {
              return GithubReleaseSkipped.make({ tags: nonEmptyArray(preview.tags) })
            }
            yield* forge.promoteLatest(raw.slug, first.id)
            return GithubReleaseCreated.make({
              created: nonEmptyArray(created),
              skipped: Count.make(preview.tags.length - created.length),
            })
          })),
      Match.tag('GithubReleaseCreated', (created) => Effect.succeed(created)),
      Match.tag('GithubReleaseSkipped', (skipped) => Effect.succeed(skipped)),
      Match.tag('GithubReleaseAsserted', (asserted) => Effect.succeed(asserted)),
      Match.tag('GithubReleaseEmpty', (empty) => Effect.succeed(empty)),
      Match.exhaustive,
    )
  })
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
