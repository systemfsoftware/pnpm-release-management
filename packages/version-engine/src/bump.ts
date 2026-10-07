import { Cell } from '@systemfsoftware/effect-cell-types'
import {
  type ChangelogRefusal,
  ChangelogStore,
  ChangesetsPort,
  ChangesetStore,
  type IntentRefusal,
  type MemberRefusal,
  type PackageName,
  type PackageVersion,
  type PlannedRelease,
  RelativePath,
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
  ChangesetStore | WorkspaceStore | SurfaceStore | ChangesetsPort
> =>
  Effect.gen(function*() {
    const workspace = yield* WorkspaceStore
    const surfaces = yield* SurfaceStore
    const members = yield* workspace.listMembers()
    const known = HashSet.fromIterable(members.map((member) => member.name))
    for (const target of request.surfaces) {
      if (target.surface.kind !== 'cargo') continue
      const named = target.surface.package
      if (request.strategy === 'changesets' && named === undefined) {
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

    if (request.strategy === 'changesets') {
      const port = yield* ChangesetsPort
      const planned = yield* port.plan()
      const moved = planned.releases.map((release) => release.name)
      const changelogPaths = planned.releases.map((release) => ({
        name: release.name,
        path: RelativePath.make(
          `${request.changelogDir}/${release.name.replaceAll('/', '!')}@${release.newVersion}.md`,
        ),
      }))
      return BumpCommand.make({
        strategy: request.strategy,
        intents: [],
        members: [...members],
        manifestVersion,
        changelogDir: request.changelogDir,
        rootChangelog: request.rootChangelog,
        manifest: request.manifest,
        surfaces: [...request.surfaces],
        consolidated: 'none',
        consolidatedNext: manifestVersion,
        moved,
        changelogPaths,
        unknownPackage: undefined,
        malformedPath: undefined,
        intentCount: planned.changesets,
        planned: [...planned.releases],
      })
    }

    const changesets = yield* ChangesetStore
    const paths = yield* changesets.listIntents()
    const intents = yield* Effect.forEach(paths, (path) => changesets.readIntent(path))
    const derived = deriveBump({
      intents,
      members,
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
      moved: derived.moved,
      changelogPaths: derived.changelogPaths,
      unknownPackage: derived.unknownPackage,
      malformedPath: derived.malformedPath,
      intentCount: derived.intentCount,
      planned: [],
    })
  })

const plannedSummaryOf = (
  planned: ReadonlyArray<PlannedRelease>,
  name: PackageName,
): string => {
  const release = planned.find((candidate) => candidate.name === name)
  if (release === undefined) return ''
  return release.summary
}

const writeMemberChangelogs = (
  command: BumpCommand,
  moved: ReadonlyArray<PackageName>,
  versionOf: (name: PackageName) => PackageVersion,
  summaryOf: (name: PackageName) => string,
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
          summary: summaryOf(name),
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
    yield* writeMemberChangelogs(
      command,
      bumped.moved,
      () => bumped.version,
      (name) => summaryForPackage(command.intents, name),
    )
  })

const writeChangesets = (
  command: BumpCommand,
  bumped: VersionBumped,
): Effect.Effect<void, VersionRefusal | ChangelogRefusal, SurfaceStore | ChangelogStore> =>
  Effect.gen(function*() {
    const surfaces = yield* SurfaceStore
    const versionOf = (name: PackageName): PackageVersion => {
      const release = command.planned.find((candidate) => candidate.name === name)
      if (release !== undefined) return release.newVersion
      const member = command.members.find((candidate) => candidate.name === name)
      if (member !== undefined) return member.manifest.version
      return bumped.version
    }
    const namedVersionOf = (named: PackageName | undefined): PackageVersion => {
      if (named === undefined) return bumped.version
      return versionOf(named)
    }
    yield* Effect.forEach(
      command.surfaces.flatMap((target) => {
        if (target.surface.kind === 'cargo') return [{ target, named: target.surface.package }]
        return []
      }),
      ({ target, named }) => surfaces.writeSurface(target.file, target.surface, namedVersionOf(named)),
      { discard: true },
    )
    yield* writeMemberChangelogs(
      command,
      bumped.moved,
      (name) => versionOf(name),
      (name) => plannedSummaryOf(command.planned, name),
    )
  })

const write = (
  output: Result.Result<VersionDecision, VersionRefusal>,
  command: BumpCommand,
): Effect.Effect<
  VersionDecision,
  VersionRefusal | IntentRefusal | MemberRefusal | ChangelogRefusal,
  ChangesetStore | WorkspaceStore | SurfaceStore | ChangelogStore | ChangesetsPort
> => {
  if (Result.isFailure(output)) return Effect.fail(output.failure)
  const decision = output.success
  if (command.strategy === 'changesets') {
    return Effect.gen(function*() {
      const port = yield* ChangesetsPort
      yield* port.apply()
      yield* Match.value(decision).pipe(
        Match.tag('VersionBumped', (bumped) => writeChangesets(command, bumped)),
        Match.tag('VersionConsumed', () => Effect.void),
        Match.tag('VersionIdle', () => Effect.void),
        Match.exhaustive,
      )
      return decision
    })
  }
  return Effect.gen(function*() {
    const changesets = yield* ChangesetStore
    yield* Match.value(decision).pipe(
      Match.tag('VersionBumped', (bumped) => writeSurfaces(command, bumped)),
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
  IntentRefusal | MemberRefusal | VersionRefusal | ChangelogRefusal,
  ChangesetStore | WorkspaceStore | SurfaceStore | ChangelogStore | ChangesetsPort
> = Cell.layer({
  read,
  decide: bumpVersions,
  write,
})
