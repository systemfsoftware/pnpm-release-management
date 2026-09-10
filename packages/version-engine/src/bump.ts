import { Cell } from '@systemfsoftware/effect-cell-types'
import {
  type Bump,
  type ChangelogRefusal,
  ChangelogStore,
  ChangesetStore,
  CommandName,
  type Intent,
  type IntentRefusal,
  type Member,
  type MemberRefusal,
  type PackageName,
  type PackageVersion,
  ProcessPort,
  PublishArg,
  type PublishRefusal,
  type RelativePath,
  type RepoRoot,
  SurfaceStore,
  VersionDecision,
  type VersionRefusal,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { deriveBump } from './bump-derive.ts'
import { bumpVersions } from './bump-versions.workflow.ts'
import type {
  VersionBumped as LocalVersionBumped,
  VersionConsumed as LocalVersionConsumed,
  VersionIdle as LocalVersionIdle,
} from './bump-versions.workflow.ts'
import { BumpCommand, type BumpInput } from './bump.schema.ts'

type BumpRaw = {
  readonly input: BumpInput
  readonly root: RepoRoot
  readonly intents: ReadonlyArray<Intent>
  readonly members: ReadonlyArray<Member>
  readonly manifestVersion: PackageVersion
  readonly derived: {
    readonly unknownPackage: PackageName | undefined
    readonly malformedPath: RelativePath | undefined
    readonly consolidated: Bump
    readonly consolidatedNext: string
    readonly nexts: ReadonlyArray<{ readonly name: PackageName; readonly next: string }>
    readonly moved: ReadonlyArray<PackageName>
    readonly changelogPaths: ReadonlyArray<{ readonly name: PackageName; readonly path: string }>
    readonly packageRanks: ReadonlyArray<{
      readonly name: PackageName
      readonly rank: Bump
      readonly summaries: ReadonlyArray<string>
    }>
    readonly intentCount: number
    readonly fallbackSummary: string
    readonly rootBullets: string
  }
}

const mustBrand = <C extends S.Constraint>(schema: C, input: unknown) =>
  S.decodeUnknownEffect(schema)(input).pipe(Effect.orDie)

const read = (
  input: BumpInput,
): Effect.Effect<
  BumpRaw,
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
    const manifestVersion = yield* surfaces.readSurface(input.manifest.file, input.manifest.surface)
    const derived = deriveBump({
      intents,
      members,
      strategy: input.strategy,
      manifestVersion,
      changelogDir: input.changelogDir,
    })
    return {
      input,
      root: workspace.root,
      intents,
      members,
      manifestVersion,
      derived: {
        unknownPackage: derived.unknownPackage,
        malformedPath: derived.malformedPath,
        consolidated: derived.consolidated,
        consolidatedNext: derived.consolidatedNext,
        nexts: derived.nexts,
        moved: derived.moved,
        changelogPaths: derived.changelogPaths,
        packageRanks: derived.packages,
        intentCount: derived.intentCount,
        fallbackSummary: derived.fallbackSummary,
        rootBullets: derived.rootBullets,
      },
    }
  })

const decode = (raw: BumpRaw) =>
  S.decodeUnknownResult(BumpCommand)({
    _tag: 'BumpCommand',
    strategy: raw.input.strategy,
    intents: raw.intents,
    members: raw.members,
    manifestVersion: raw.manifestVersion,
    changelogDir: raw.input.changelogDir,
    rootChangelog: raw.input.rootChangelog,
    consolidated: raw.derived.consolidated,
    consolidatedNext: raw.derived.consolidatedNext,
    nexts: raw.derived.nexts,
    moved: raw.derived.moved,
    changelogPaths: raw.derived.changelogPaths,
    packageRanks: raw.derived.packageRanks,
    unknownPackage: raw.derived.unknownPackage,
    malformedPath: raw.derived.malformedPath,
    intentCount: raw.derived.intentCount,
  })
type LocalVersionDecision =
  | LocalVersionBumped
  | LocalVersionConsumed
  | LocalVersionIdle

const encode = (
  outcome: Result.Result<LocalVersionDecision, VersionRefusal>,
): Result.Result<LocalVersionDecision, VersionRefusal> => outcome

const summaryFor = (
  raw: BumpRaw,
  name: PackageName,
): string => {
  const found = raw.derived.packageRanks.find((entry) => entry.name === name)
  const own = found?.summaries ?? []
  return own.length > 0 ? own.join(' ') : raw.derived.fallbackSummary
}
const write = (
  output: Result.Result<LocalVersionDecision, VersionRefusal>,
  raw: BumpRaw,
): Effect.Effect<
  VersionDecision,
  VersionRefusal | IntentRefusal | MemberRefusal | ChangelogRefusal | PublishRefusal,
  ChangesetStore | WorkspaceStore | SurfaceStore | ChangelogStore | ProcessPort
> => {
  if (Result.isFailure(output)) return Effect.fail(output.failure)
  return Effect.flatMap(
    S.decodeUnknownEffect(VersionDecision)(output.success).pipe(Effect.orDie),
    (decision) =>
      Effect.gen(function*() {
        const changesets = yield* ChangesetStore
        yield* Match.value(decision).pipe(
          Match.tag('VersionBumped', (bumped) =>
            raw.input.strategy === 'surfaces'
              ? Effect.gen(function*() {
                const surfaces = yield* SurfaceStore
                const changelogs = yield* ChangelogStore
                yield* surfaces.writeSurface(raw.input.manifest.file, raw.input.manifest.surface, bumped.version)
                yield* Effect.forEach(
                  raw.input.surfaces,
                  (surface) => surfaces.writeSurface(surface.file, surface.surface, bumped.version),
                  { discard: true },
                )
                if (raw.input.rootChangelog !== undefined) {
                  yield* changelogs.appendReleaseSummary({
                    path: raw.input.rootChangelog,
                    version: bumped.version,
                    summary: raw.derived.rootBullets,
                  })
                }
                yield* Effect.forEach(
                  bumped.moved,
                  (name) =>
                    changelogs.writeMemberChangelog({
                      changelogDir: raw.input.changelogDir,
                      name,
                      version: bumped.version,
                      summary: summaryFor(raw, name),
                    }),
                  { discard: true },
                )
              })
              : Effect.gen(function*() {
                const process = yield* ProcessPort
                const changelogs = yield* ChangelogStore
                const workspace = yield* WorkspaceStore
                const program = yield* mustBrand(CommandName, 'pnpm')
                const args = yield* Effect.forEach(
                  ['version', '-r'],
                  (arg) => mustBrand(PublishArg, arg),
                )
                yield* process.runCommand({ program, args, cwd: workspace.root })
                const members = yield* workspace.listMembers()
                const manifests = yield* Effect.forEach(
                  members,
                  (member) => workspace.readManifest(member.dir),
                )
                const actualByName = new Map(manifests.map((manifest) => [manifest.name, manifest.version]))
                yield* Effect.forEach(
                  bumped.moved,
                  (name) =>
                    changelogs.writeMemberChangelog({
                      changelogDir: raw.input.changelogDir,
                      name,
                      version: actualByName.get(name) ?? bumped.version,
                      summary: summaryFor(raw, name),
                    }),
                  { discard: true },
                )
              })),
          Match.tag('VersionConsumed', () => Effect.void),
          Match.tag('VersionIdle', () => Effect.void),
          Match.exhaustive,
        )
        yield* changesets.deleteIntents(raw.intents.map((intent) => intent.path))
        return decision
      }),
  )
}

export const bumpCell = Cell.layer({
  read,
  decode,
  decide: bumpVersions,
  encode,
  write,
})
