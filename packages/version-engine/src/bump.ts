import { Cell } from '@systemfsoftware/effect-cell-types'
import {
  type ChangelogRefusal,
  ChangelogStore,
  ChangesetStore,
  CommandArg,
  CommandName,
  type CommandRefusal,
  type IntentRefusal,
  type MemberRefusal,
  type PackageManifest,
  type PackageName,
  type PackageVersion,
  ProcessPort,
  SurfaceStore,
  VersionCargoPackageMissing,
  type VersionRefusal,
  VersionUnknownPackage,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect, HashSet } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import { deriveBump, rootBulletsOf, summaryForPackage } from './bump-derive.js'
import type { VersionBumped, VersionDecision } from './bump-versions.workflow.js'
import { bumpVersions } from './bump-versions.workflow.js'
import { BumpCommand, type BumpInput } from './bump.schema.js'

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
    const known = HashSet.fromIterable(members.map((member) => member.name))
    for (const target of request.surfaces) {
      if (target.surface.kind !== 'cargo') continue
      const named = target.surface.package
      if (request.strategy === 'pnpm' && named === undefined) {
        return yield* Effect.fail(VersionCargoPackageMissing.make({ path: target.file }))
      }
      if (named !== undefined && !HashSet.has(known, named)) {
        return yield* Effect.fail(VersionUnknownPackage.make({ package: named }))
      }
    }
    const manifestVersion = yield* surfaces.readSurface(
      request.manifest.file,
      request.manifest.surface,
    )
    const derived = deriveBump({
      intents,
      members,
      strategy: request.strategy,
      manifestVersion,
      changelogDir: request.changelogDir,
    })
    return BumpCommand.make({
      strategy: request.strategy,
      intents: [...intents],
      members: [...members],
      manifestVersion,
      changelogDir: request.changelogDir,
      rootChangelog: request.rootChangelog,
      manifest: request.manifest,
      surfaces: [...request.surfaces],
      consolidated: derived.consolidated,
      consolidatedNext: derived.consolidatedNext,
      nexts: derived.nexts,
      moved: derived.moved,
      changelogPaths: derived.changelogPaths,
      packageRanks: derived.packages,
      unknownPackage: derived.unknownPackage,
      malformedPath: derived.malformedPath,
      intentCount: derived.intentCount,
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

const namedVersionOf = (
  manifests: ReadonlyArray<PackageManifest>,
  name: PackageName | undefined,
  fallback: PackageVersion,
): PackageVersion => {
  if (name === undefined) return fallback
  return commandVersionOf(manifests, name, fallback)
}

const writeMemberChangelogs = (
  command: BumpCommand,
  moved: ReadonlyArray<PackageName>,
  versionOf: (name: PackageName) => PackageVersion,
): Effect.Effect<void, ChangelogRefusal, ChangelogStore> =>
  Effect.gen(function*() {
    const changelogs = yield* ChangelogStore
    yield* Effect.forEach(
      moved,
      (name) =>
        changelogs.writeMemberChangelog({
          changelogDir: command.changelogDir,
          name,
          version: versionOf(name),
          summary: summaryForPackage(command.intents, name),
        }),
      { discard: true },
    )
  })

const writeSurfaces = (
  command: BumpCommand,
  bumped: VersionBumped,
): Effect.Effect<void, VersionRefusal | ChangelogRefusal, SurfaceStore | ChangelogStore> =>
  Effect.gen(function*() {
    const surfaces = yield* SurfaceStore
    const changelogs = yield* ChangelogStore
    yield* surfaces.writeSurface(
      command.manifest.file,
      command.manifest.surface,
      bumped.version,
    )
    yield* Effect.forEach(
      command.surfaces,
      (surface) => surfaces.writeSurface(surface.file, surface.surface, bumped.version),
      { discard: true },
    )
    if (command.rootChangelog !== undefined) {
      yield* changelogs.appendReleaseSummary({
        path: command.rootChangelog,
        version: bumped.version,
        summary: rootBulletsOf(command.intents),
      })
    }
    yield* writeMemberChangelogs(command, bumped.moved, () => bumped.version)
  })

const writePnpm = (
  command: BumpCommand,
  bumped: VersionBumped,
): Effect.Effect<
  void,
  ChangelogRefusal | MemberRefusal | CommandRefusal | VersionRefusal,
  ChangelogStore | ProcessPort | WorkspaceStore | SurfaceStore
> =>
  Effect.gen(function*() {
    const process = yield* ProcessPort
    const workspace = yield* WorkspaceStore
    const surfaces = yield* SurfaceStore
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
    yield* Effect.forEach(
      command.surfaces.flatMap((target) => {
        if (target.surface.kind === 'cargo') return [{ target, named: target.surface.package }]
        return []
      }),
      ({ target, named }) =>
        surfaces.writeSurface(
          target.file,
          target.surface,
          namedVersionOf(manifests, named, bumped.version),
        ),
      { discard: true },
    )
    yield* writeMemberChangelogs(
      command,
      bumped.moved,
      (name) => commandVersionOf(manifests, name, bumped.version),
    )
  })

const applyBumped = (
  command: BumpCommand,
  bumped: VersionBumped,
): Effect.Effect<
  void,
  VersionRefusal | ChangelogRefusal | MemberRefusal | CommandRefusal,
  ChangelogStore | SurfaceStore | ProcessPort | WorkspaceStore
> => {
  if (command.strategy === 'surfaces') return writeSurfaces(command, bumped)
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
