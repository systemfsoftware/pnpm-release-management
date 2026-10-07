import { Cell } from '@systemfsoftware/effect-cell-types'
import {
  type ChangelogRefusal,
  ChangelogStore,
  ChangesetStore,
  CommandArg,
  CommandName,
  type CommandRefusal,
  type Intent,
  type IntentRefusal,
  type Member,
  type MemberRefusal,
  type PackageManifest,
  type PackageName,
  type PackageVersion,
  ProcessPort,
  RelativePath,
  SurfaceStore,
  type VersionRefusal,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import {
  derivePnpmBump,
  deriveSurfacesBump,
  type PnpmBumpDerivation,
  rootBulletsOf,
  summaryForPackage,
} from './bump-derive.js'
import type { VersionBumped, VersionDecision } from './bump-versions.workflow.js'
import { bumpVersions } from './bump-versions.workflow.js'
import { BumpCommand, type BumpInput, type SurfacesVersioning } from './bump.schema.js'

export const commandOf = (args: {
  readonly versioning: BumpCommand['versioning']
  readonly intents: ReadonlyArray<Intent>
  readonly members: ReadonlyArray<Member>
  readonly changelogDir: RelativePath
  readonly derived: PnpmBumpDerivation
}): BumpCommand =>
  BumpCommand.make({
    versioning: args.versioning,
    intents: [...args.intents],
    members: [...args.members],
    changelogDir: args.changelogDir,
    consolidated: args.derived.consolidated,
    nexts: args.derived.nexts,
    moved: args.derived.moved,
    changelogPaths: args.derived.changelogPaths,
    packageRanks: args.derived.packages,
    unknownPackage: args.derived.unknownPackage,
    malformedPath: args.derived.malformedPath,
    intentCount: args.derived.intentCount,
  })

const read = (
  request: BumpInput,
): Effect.Effect<
  BumpCommand,
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
    if (request.strategy === 'pnpm') {
      const derived = derivePnpmBump({
        intents,
        members,
        changelogDir: request.changelogDir,
      })
      return commandOf({
        versioning: { strategy: 'pnpm' },
        intents,
        members,
        changelogDir: request.changelogDir,
        derived,
      })
    }
    const manifestVersion = yield* surfaces.readSurface(
      request.manifest.file,
      request.manifest.surface,
    )
    const derived = deriveSurfacesBump({
      intents,
      members,
      changelogDir: request.changelogDir,
      manifestVersion,
    })
    return commandOf({
      versioning: {
        strategy: 'surfaces',
        manifest: request.manifest,
        surfaces: [...request.surfaces],
        rootChangelog: request.rootChangelog,
        consolidatedNext: derived.consolidatedNext,
      },
      intents,
      members,
      changelogDir: request.changelogDir,
      derived,
    })
  })

const commandVersionOf = (
  manifests: ReadonlyArray<PackageManifest>,
  name: PackageName,
  fallback: PackageVersion,
): PackageVersion => {
  const manifest = manifests.find((candidate) => candidate.name === name)
  if (manifest === undefined) return fallback
  return manifest.version
}

const writeMemberChangelogs = (args: {
  readonly changelogDir: RelativePath
  readonly intents: ReadonlyArray<Intent>
  readonly moved: ReadonlyArray<PackageName>
  readonly versionOf: (name: PackageName) => PackageVersion
}): Effect.Effect<void, ChangelogRefusal, ChangelogStore> =>
  Effect.gen(function*() {
    const changelogs = yield* ChangelogStore
    yield* Effect.forEach(
      args.moved,
      (name) =>
        changelogs.writeMemberChangelog({
          changelogDir: args.changelogDir,
          name,
          version: args.versionOf(name),
          summary: summaryForPackage(args.intents, name),
        }),
      { discard: true },
    )
  })

const writeSurfaces = (
  versioning: SurfacesVersioning,
  command: BumpCommand,
  bumped: VersionBumped,
): Effect.Effect<void, VersionRefusal | ChangelogRefusal, SurfaceStore | ChangelogStore> =>
  Effect.gen(function*() {
    const surfaces = yield* SurfaceStore
    const changelogs = yield* ChangelogStore
    yield* surfaces.writeSurface(
      versioning.manifest.file,
      versioning.manifest.surface,
      bumped.version,
    )
    yield* Effect.forEach(
      versioning.surfaces,
      (surface) => surfaces.writeSurface(surface.file, surface.surface, bumped.version),
      { discard: true },
    )
    if (versioning.rootChangelog !== undefined) {
      yield* changelogs.appendReleaseSummary({
        path: versioning.rootChangelog,
        version: bumped.version,
        summary: rootBulletsOf(command.intents),
      })
    }
    yield* writeMemberChangelogs({
      changelogDir: command.changelogDir,
      intents: command.intents,
      moved: bumped.moved,
      versionOf: () => bumped.version,
    })
  })

const writePnpm = (
  command: BumpCommand,
  bumped: VersionBumped,
): Effect.Effect<
  void,
  ChangelogRefusal | MemberRefusal | CommandRefusal,
  ChangelogStore | ProcessPort | WorkspaceStore
> =>
  Effect.gen(function*() {
    const process = yield* ProcessPort
    const workspace = yield* WorkspaceStore
    yield* process.runCommand({
      program: CommandName.make('pnpm'),
      args: [CommandArg.make('version'), CommandArg.make('-r')],
      cwd: workspace.root,
    })
    const members = yield* workspace.listMembers()
    const manifests = yield* Effect.forEach(
      members,
      (member) => workspace.readManifest(member.dir),
    )
    yield* writeMemberChangelogs({
      changelogDir: command.changelogDir,
      intents: command.intents,
      moved: bumped.moved,
      versionOf: (name) => commandVersionOf(manifests, name, bumped.version),
    })
  })

const applyBumped = (
  command: BumpCommand,
  bumped: VersionBumped,
): Effect.Effect<
  void,
  VersionRefusal | ChangelogRefusal | MemberRefusal | CommandRefusal,
  ChangelogStore | SurfaceStore | ProcessPort | WorkspaceStore
> => {
  if (command.versioning.strategy === 'surfaces') {
    return writeSurfaces(command.versioning, command, bumped)
  }
  return writePnpm(command, bumped)
}

const write = (
  output: Result.Result<VersionDecision, VersionRefusal>,
  command: BumpCommand,
): Effect.Effect<
  VersionDecision,
  VersionRefusal | IntentRefusal | MemberRefusal | ChangelogRefusal | CommandRefusal,
  ChangesetStore | WorkspaceStore | SurfaceStore | ChangelogStore | ProcessPort
> => {
  if (Result.isFailure(output)) return Effect.fail(output.failure)
  const decision = output.success
  return Effect.gen(function*() {
    const changesets = yield* ChangesetStore
    yield* Match.value(decision).pipe(
      Match.tag('VersionBumped', (bumped) => applyBumped(command, bumped)),
      Match.tag('VersionConsumed', () => Effect.void),
      Match.tag('VersionIdle', () => Effect.void),
      Match.exhaustive,
    )
    yield* changesets.deleteIntents(command.intents.map((intent) => intent.path))
    return decision
  })
}

export const bumpCell: Cell.Cell<
  BumpInput,
  VersionDecision,
  IntentRefusal | MemberRefusal | VersionRefusal | ChangelogRefusal | CommandRefusal,
  ChangesetStore | WorkspaceStore | SurfaceStore | ChangelogStore | ProcessPort
> = Cell.layer({
  read,
  decide: bumpVersions,
  write,
})
