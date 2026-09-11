import { Cell } from '@systemfsoftware/effect-cell-types'
import {
  type ChangelogRefusal,
  ChangelogStore,
  ChangesetStore,
  CommandName,
  type Intent,
  type IntentRefusal,
  type Member,
  type MemberRefusal,
  type PackageManifest,
  type PackageName,
  type PackageVersion,
  ProcessPort,
  PublishArg,
  type PublishRefusal,
  type RepoRoot,
  SurfaceStore,
  VersionBumped,
  VersionConsumed,
  type VersionDecision,
  VersionIdle,
  type VersionIntentMalformed,
  type VersionRefusal,
  type VersionUnknownPackage,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { deriveBump, rootBulletsOf, summaryForPackage } from './bump-derive.js'
import {
  bumpVersions,
  type VersionBumped as LocalVersionBumped,
  type VersionConsumed as LocalVersionConsumed,
  type VersionIdle as LocalVersionIdle,
} from './bump-versions.workflow.js'
import { BumpCommand, type BumpInput } from './bump.schema.js'

class RawBump {
  constructor(
    readonly request: BumpInput,
    readonly root: RepoRoot,
    readonly intents: ReadonlyArray<Intent>,
    readonly members: ReadonlyArray<Member>,
    readonly manifestVersion: PackageVersion,
  ) {}
}

const read = (
  request: BumpInput,
): Effect.Effect<
  RawBump,
  IntentRefusal | MemberRefusal | VersionRefusal,
  ChangesetStore | WorkspaceStore | SurfaceStore
> =>
  Effect.gen(function*() {
    const changesets = yield* ChangesetStore
    const workspace = yield* WorkspaceStore
    const surfaces = yield* SurfaceStore
    const paths = yield* changesets.listIntents()
    const intents = yield* Effect.forEach(paths, (path) => changesets.readIntent(path))
    const members = yield* workspace.listMembers()
    const manifestVersion = yield* surfaces.readSurface(
      request.manifest.file,
      request.manifest.surface,
    )
    return new RawBump(request, workspace.root, intents, members, manifestVersion)
  })

const decode = (raw: RawBump) => {
  const { packages, ...derived } = deriveBump({
    intents: raw.intents,
    members: raw.members,
    strategy: raw.request.strategy,
    manifestVersion: raw.manifestVersion,
    changelogDir: raw.request.changelogDir,
  })
  return S.decodeUnknownResult(BumpCommand)({
    _tag: 'BumpCommand',
    strategy: raw.request.strategy,
    intents: [...raw.intents],
    members: [...raw.members],
    manifestVersion: raw.manifestVersion,
    changelogDir: raw.request.changelogDir,
    rootChangelog: raw.request.rootChangelog,
    ...derived,
    packageRanks: packages,
  })
}

const toDecision = (
  decision: LocalVersionBumped | LocalVersionConsumed | LocalVersionIdle,
): VersionDecision =>
  Match.value(decision).pipe(
    Match.tag(
      'VersionBumped',
      (bumped) =>
        VersionBumped.make({
          version: bumped.version,
          moved: [...bumped.moved],
          changelogs: [...bumped.changelogs],
        }),
    ),
    Match.tag(
      'VersionConsumed',
      (consumed) => VersionConsumed.make({ consumed: consumed.consumed }),
    ),
    Match.tag('VersionIdle', (idle) => VersionIdle.make({ pending: idle.pending })),
    Match.exhaustive,
  )

const encode = (
  outcome: Result.Result<
    LocalVersionBumped | LocalVersionConsumed | LocalVersionIdle,
    VersionUnknownPackage | VersionIntentMalformed
  >,
): Result.Result<VersionDecision, VersionUnknownPackage | VersionIntentMalformed> => Result.map(outcome, toDecision)

const commandVersionOf = (
  manifests: ReadonlyArray<PackageManifest>,
  name: PackageName,
  fallback: PackageVersion,
): PackageVersion => {
  const manifest = manifests.find((candidate) => candidate.name === name)
  if (manifest === undefined) return fallback
  return manifest.version
}

const writeMemberChangelogs = (
  request: BumpInput,
  intents: ReadonlyArray<Intent>,
  moved: ReadonlyArray<PackageName>,
  versionOf: (name: PackageName) => PackageVersion,
): Effect.Effect<void, ChangelogRefusal, ChangelogStore> =>
  Effect.gen(function*() {
    const changelogs = yield* ChangelogStore
    yield* Effect.forEach(
      moved,
      (name) =>
        changelogs.writeMemberChangelog({
          changelogDir: request.changelogDir,
          name,
          version: versionOf(name),
          summary: summaryForPackage(intents, name),
        }),
      { discard: true },
    )
  })

const writeSurfaces = (
  raw: RawBump,
  bumped: VersionBumped,
): Effect.Effect<void, VersionRefusal | ChangelogRefusal, SurfaceStore | ChangelogStore> =>
  Effect.gen(function*() {
    const surfaces = yield* SurfaceStore
    const changelogs = yield* ChangelogStore
    yield* surfaces.writeSurface(
      raw.request.manifest.file,
      raw.request.manifest.surface,
      bumped.version,
    )
    yield* Effect.forEach(
      raw.request.surfaces,
      (surface) => surfaces.writeSurface(surface.file, surface.surface, bumped.version),
      { discard: true },
    )
    if (raw.request.rootChangelog !== undefined) {
      yield* changelogs.appendReleaseSummary({
        path: raw.request.rootChangelog,
        version: bumped.version,
        summary: rootBulletsOf(raw.intents),
      })
    }
    yield* writeMemberChangelogs(
      raw.request,
      raw.intents,
      bumped.moved,
      () => bumped.version,
    )
  })

const writePnpm = (
  raw: RawBump,
  bumped: VersionBumped,
): Effect.Effect<
  void,
  ChangelogRefusal | MemberRefusal | PublishRefusal,
  ChangelogStore | ProcessPort | WorkspaceStore
> =>
  Effect.gen(function*() {
    const process = yield* ProcessPort
    const workspace = yield* WorkspaceStore
    yield* process.runCommand({
      program: CommandName.make('pnpm'),
      args: [PublishArg.make('version'), PublishArg.make('-r')],
      cwd: raw.root,
    })
    const members = yield* workspace.listMembers()
    const manifests = yield* Effect.forEach(
      members,
      (member) => workspace.readManifest(member.dir),
    )
    yield* writeMemberChangelogs(
      raw.request,
      raw.intents,
      bumped.moved,
      (name) => commandVersionOf(manifests, name, bumped.version),
    )
  })

const applyBumped = (
  raw: RawBump,
  bumped: VersionBumped,
): Effect.Effect<
  void,
  VersionRefusal | ChangelogRefusal | MemberRefusal | PublishRefusal,
  ChangelogStore | SurfaceStore | ProcessPort | WorkspaceStore
> => {
  if (raw.request.strategy === 'surfaces') return writeSurfaces(raw, bumped)
  return writePnpm(raw, bumped)
}

const write = (
  output: Result.Result<VersionDecision, VersionRefusal>,
  raw: RawBump,
): Effect.Effect<
  VersionDecision,
  VersionRefusal | IntentRefusal | MemberRefusal | ChangelogRefusal | PublishRefusal,
  ChangesetStore | WorkspaceStore | SurfaceStore | ChangelogStore | ProcessPort
> => {
  if (Result.isFailure(output)) return Effect.fail(output.failure)
  const decision = output.success
  return Effect.gen(function*() {
    const changesets = yield* ChangesetStore
    yield* Match.value(decision).pipe(
      Match.tag('VersionBumped', (bumped) => applyBumped(raw, bumped)),
      Match.tag('VersionConsumed', () => Effect.void),
      Match.tag('VersionIdle', () => Effect.void),
      Match.exhaustive,
    )
    yield* changesets.deleteIntents(raw.intents.map((intent) => intent.path))
    return decision
  })
}

export const bumpCell = Cell.layer({
  read,
  decode,
  decide: bumpVersions,
  encode,
  write,
})
