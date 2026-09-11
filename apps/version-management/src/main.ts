import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { program, Reporter } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { ProcessLive } from '@systemfsoftware/process-adapter'
import {
  ChangelogStore,
  ChangesetStore,
  JsonSurface,
  ProcessPort,
  RelativePath,
  ReleaseConfig,
  ReleaseConfigStore,
  RepoRoot,
  SurfaceStore,
  TargetSuffix,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import {
  bumpCell,
  type BumpInput,
  pinRootManifestCell,
  type PinRootManifestInput,
  syncCell,
  type SyncInput,
} from '@systemfsoftware/version-engine'
import {
  ChangelogStoreLive,
  ChangesetStoreLive,
  CycleStoreLive,
  ReleaseConfigStoreLive,
  SurfaceStoreLive,
  WorkspaceStoreLive,
} from '@systemfsoftware/workspace-adapter'
import { Context, Effect, Layer, Option } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import { Argument, Command, Flag } from 'effect/unstable/cli'
const describeRefusal = (refusal: unknown): string => {
  if (typeof refusal !== 'object' || refusal === null) {
    return 'unknown refusal'
  }
  const entries: Array<readonly [string, unknown]> = Object.entries(refusal)
  const tagEntry = entries.find(([key]) => key === '_tag')
  const tagValue: unknown = tagEntry?.[1]
  if (typeof tagValue !== 'string') {
    return 'unknown refusal'
  }
  const detail = entries
    .filter(([key]) => key !== '_tag')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ')
  if (detail.length === 0) {
    return tagValue
  }
  return `${tagValue}: ${detail}`
}

const failWith = (message: string): Effect.Effect<never, string> => Effect.fail(message)

const releaseContext: Effect.Effect<
  { readonly config: ReleaseConfig },
  string,
  WorkspaceStore | ReleaseConfigStore
> = Effect.gen(function*() {
  const workspace = yield* WorkspaceStore
  const configs = yield* ReleaseConfigStore
  const config = yield* Effect.matchEffect(configs.loadConfig(workspace.root), {
    onFailure: (refusal) => failWith(describeRefusal(refusal)),
    onSuccess: (loaded) => Effect.succeed(loaded),
  })
  return { config }
})

type SurfaceEntry = {
  readonly file: RelativePath
  readonly surface: Extract<ReleaseConfig['versioning'], { strategy: 'surfaces' }>['surfaces'][number]
}

const manifestSurface = (file: RelativePath): typeof JsonSurface.Type => ({
  kind: 'json',
  path: file,
})

const surfaceEntries = (
  versioning: Extract<ReleaseConfig['versioning'], { strategy: 'surfaces' }>,
): ReadonlyArray<SurfaceEntry> => {
  return versioning.surfaces.flatMap((surface): ReadonlyArray<SurfaceEntry> => {
    if (surface.kind === 'json') {
      return [{ file: surface.path, surface }]
    }
    if (surface.kind === 'toml') {
      if (surface.path === undefined) {
        return []
      }
      return [{ file: surface.path, surface }]
    }
    return [{ file: surface.path, surface }]
  })
}

const bump = Command.make('bump', {
  config: Flag.string('config').pipe(Flag.optional),
}, (): Effect.Effect<
  void,
  string,
  Reporter | WorkspaceStore | ReleaseConfigStore | ChangesetStore | SurfaceStore | ChangelogStore | ProcessPort
> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    const { config } = yield* releaseContext
    const versioning = config.versioning
    let input: BumpInput
    if (versioning.strategy === 'pnpm') {
      input = {
        strategy: 'pnpm',
        changelogDir: config.changelogDir,
        manifest: {
          file: RelativePath.make('package.json'),
          surface: manifestSurface(RelativePath.make('package.json')),
        },
        surfaces: [],
      }
    } else {
      input = {
        strategy: 'surfaces',
        changelogDir: config.changelogDir,
        rootChangelog: versioning.changelog,
        manifest: { file: versioning.manifest, surface: manifestSurface(versioning.manifest) },
        surfaces: surfaceEntries(versioning),
      }
    }
    return yield* Effect.matchEffect(Cell.run(bumpCell, input), {
      onFailure: (refusal) => failWith(describeRefusal(refusal)),
      onSuccess: (decision) =>
        Match.value(decision).pipe(
          Match.tag('VersionBumped', () => reporter.emit('versioned packages')),
          Match.tag('VersionConsumed', () => reporter.emit('consumed intents without a version bump')),
          Match.tag('VersionIdle', () => reporter.note('no change intents; nothing to version')),
          Match.exhaustive,
        ),
    })
  }))

const sync = Command.make('sync', {
  subcommand: Argument.string('subcommand').pipe(Argument.optional),
  version: Argument.string('version').pipe(Argument.optional),
  config: Flag.string('config').pipe(Flag.optional),
}, ({ subcommand, version }): Effect.Effect<
  void,
  string,
  Reporter | WorkspaceStore | ReleaseConfigStore | SurfaceStore
> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    const action = Option.getOrUndefined(subcommand)
    const pinned = Option.getOrUndefined(version)
    if (action !== 'check' && action !== 'bump') {
      return yield* failWith(`usage: sync-versions.ts <check|bump> [version]`)
    }
    if (action === 'bump' && pinned === undefined) {
      return yield* failWith(`usage: sync-versions.ts bump <version>`)
    }
    const { config } = yield* releaseContext
    const versioning = config.versioning
    if (versioning.strategy !== 'surfaces') {
      return yield* failWith(`sync-versions only applies to a "surfaces" versioning config`)
    }
    const input: SyncInput = {
      strategy: 'surfaces',
      action,
      version: pinned,
      manifest: { file: versioning.manifest, surface: manifestSurface(versioning.manifest) },
      surfaces: surfaceEntries(versioning),
    }
    return yield* Effect.matchEffect(Cell.run(syncCell, input), {
      onFailure: (refusal) =>
        Match.value(refusal).pipe(
          Match.tag('SyncSurfacesDrifted', (drifted) =>
            Effect.gen(function*() {
              for (const diff of drifted.diffs) {
                yield* reporter.annotateError(
                  `${diff.path} ${diff.found} != ${versioning.manifest} ${drifted.expected}`,
                )
              }
              yield* reporter.note('')
              yield* reporter.note(`Run \`version sync bump <version>\` to bring every surface into line.`)
              return yield* failWith(
                `${drifted.diffs.length} surface(s) drifted from ${versioning.manifest} at ${drifted.expected}`,
              )
            })),
          Match.tag('SyncStrategyMismatch', () =>
            failWith(`sync-versions only applies to a "surfaces" versioning config`)),
          Match.tag('SyncVersionMissing', () =>
            failWith(`usage: sync-versions.ts bump <version>`)),
          Match.tag('SyncActionUnknown', () => failWith(`usage: sync-versions.ts <check|bump> [version]`)),
          Match.orElse((rest) => failWith(describeRefusal(rest))),
        ),
      onSuccess: (decision) =>
        Match.value(decision).pipe(
          Match.tag('SyncAligned', (aligned) =>
            reporter.emit(`sync-versions: ok — ${aligned.version} across the manifest and every surface`)),
          Match.tag('SyncRealigned', (realigned) =>
            reporter.emit(`bumped to ${realigned.version}`)),
          Match.exhaustive,
        ),
    })
  }))

const syncRoot = Command.make('sync-root', {
  manifest: Flag.string('manifest').pipe(Flag.optional),
  version: Flag.string('version').pipe(Flag.optional),
  dryRun: Flag.boolean('dry-run').pipe(Flag.withDefault(false)),
  config: Flag.string('config').pipe(Flag.optional),
}, ({ manifest, version, dryRun }): Effect.Effect<
  void,
  string,
  Reporter | WorkspaceStore | ReleaseConfigStore | SurfaceStore
> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    const { config } = yield* releaseContext
    const distribution = config.distribution
    if (distribution === undefined) {
      return yield* failWith(
        `sync-root-manifest needs a "distribution" block — this repository ships no platform packages`,
      )
    }
    const manifestFlag = Option.getOrUndefined(manifest)
    const versionFlag = Option.getOrUndefined(version)
    const requestedVersion = versionFlag ?? process.env['VERSION']
    const manifestPath = manifestFlag ?? distribution.launcherManifest
    const input: PinRootManifestInput = {
      manifest: RelativePath.make(manifestPath),
      requestedVersion,
      suffixes: distribution.targets.map((target) => TargetSuffix.make(target.suffix)),
      dryRun,
    }
    return yield* Effect.matchEffect(Cell.run(pinRootManifestCell, input), {
      onFailure: (refusal) =>
        Match.value(refusal).pipe(
          Match.tag('PinVersionUnusable', (unusable) =>
            failWith(
              `sync-root-manifest: invalid version ${JSON.stringify(unusable.given)} — pass --version x.y.z`,
            )),
          Match.tag('PinDistributionMissing', () =>
            failWith(
              `sync-root-manifest needs a "distribution" block — this repository ships no platform packages`,
            )),
          Match.orElse((rest) => failWith(describeRefusal(rest))),
        ),
      onSuccess: (decision) =>
        Match.value(decision).pipe(
          Match.tag(
            'WorkspaceVersionAlreadyCurrent',
            (current) => reporter.emit(`unchanged — ${current.pins.length} pin(s) already at ${current.version}`),
          ),
          Match.tag('WorkspaceVersionRepinned', (pinned) => {
            if (dryRun) {
              return reporter.emit(pinned.text)
            }
            return Effect.gen(function*() {
              yield* reporter.note(
                `pinned ${pinned.pins.length} platform package(s) at ${pinned.version} in ${manifestPath}`,
              )
              yield* reporter.emit(`synced ${manifestPath}`)
            })
          }),
          Match.exhaustive,
        ),
    })
  }))

const versionCommand = Command.make('version').pipe(
  Command.withDescription('Version packages and sync version surfaces'),
  Command.withSubcommands([bump, sync, syncRoot]),
)
const boundaryRoot: Effect.Effect<RepoRoot> = Effect.flatMap(
  Effect.sync(() => process.cwd()),
  (cwd) => S.decodeUnknownEffect(RepoRoot)(cwd),
).pipe(Effect.orDie)

const fallbackChangesetDir: Effect.Effect<RelativePath> = S.decodeUnknownEffect(RelativePath)(
  '.changeset',
).pipe(Effect.orDie)

const WorkspaceStoreResolved = Layer.effect(
  WorkspaceStore,
  Effect.gen(function*() {
    const root = yield* boundaryRoot
    const context = yield* Layer.build(WorkspaceStoreLive(root))
    return Context.get(context, WorkspaceStore)
  }),
)
const SurfaceStoreResolved = Layer.effect(
  SurfaceStore,
  Effect.gen(function*() {
    const workspace = yield* WorkspaceStore
    const context = yield* Layer.build(SurfaceStoreLive(workspace.root))
    return Context.get(context, SurfaceStore)
  }),
)

const ChangelogStoreResolved = Layer.effect(
  ChangelogStore,
  Effect.gen(function*() {
    const workspace = yield* WorkspaceStore
    const context = yield* Layer.build(ChangelogStoreLive(workspace.root))
    return Context.get(context, ChangelogStore)
  }),
)

const ChangesetStoreResolved = Layer.effect(
  ChangesetStore,
  Effect.gen(function*() {
    const workspace = yield* WorkspaceStore
    const configs = yield* ReleaseConfigStore
    const changesetDir = yield* Effect.matchEffect(
      Effect.map(configs.loadConfig(workspace.root), (config) => config.changesetDir),
      {
        onFailure: () => fallbackChangesetDir,
        onSuccess: (dir) => Effect.succeed(dir),
      },
    )
    const context = yield* Layer.build(
      ChangesetStoreLive({ root: workspace.root, changesetDir }),
    )
    return Context.get(context, ChangesetStore)
  }),
)

const MainLive = Layer.mergeAll(
  WorkspaceStoreResolved,
  ReleaseConfigStoreLive,
  CycleStoreLive,
  ProcessLive,
  Layer.provide(SurfaceStoreResolved, WorkspaceStoreResolved),
  Layer.provide(ChangelogStoreResolved, WorkspaceStoreResolved),
  Layer.provide(
    ChangesetStoreResolved,
    Layer.mergeAll(WorkspaceStoreResolved, ReleaseConfigStoreLive),
  ),
).pipe(Layer.provide(NodeServices.layer))

NodeRuntime.runMain(Effect.provide(program(versionCommand, '0.0.0'), Layer.mergeAll(MainLive, NodeServices.layer)))
