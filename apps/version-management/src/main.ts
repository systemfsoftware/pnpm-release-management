import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { program, Reporter, ReporterLive } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { ProcessLive } from '@systemfsoftware/process-adapter'
import { RelativePath, ReleaseConfigStore, RepoRoot } from '@systemfsoftware/release-language'
import {
  bumpCell,
  BumpInput,
  pinRootManifestCell,
  PinRootManifestInput,
  syncCell,
  SyncInput,
} from '@systemfsoftware/version-engine'
import {
  ChangelogStoreLive,
  ChangesetStoreLive,
  ReleaseConfigStoreLive,
  SurfaceStoreLive,
  WorkspaceStoreLive,
} from '@systemfsoftware/workspace-adapter'
import { Effect, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import { Path } from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Argument, Command, Flag } from 'effect/unstable/cli'
import type { Directive } from './directive.schema.js'
import { ManifestPathRefused, SyncActionMissing, WorkspaceRootRefused } from './refusal.schema.js'
import {
  renderPinDecision,
  renderRefusal,
  renderSyncDecision,
  renderSyncRefusal,
  renderVersionDecision,
} from './render.js'
import { bumpRequestOf, pinRequestOf, syncRequestOf } from './request.js'

const configFlag = Flag.string('config').pipe(Flag.optional)

const storesLive = (root: RepoRoot, changesetDir: RelativePath) =>
  Layer.mergeAll(
    WorkspaceStoreLive(root),
    SurfaceStoreLive(root),
    ChangelogStoreLive(root),
    ChangesetStoreLive({ root, changesetDir }),
  )

const rootOf = (
  given: Option.Option<string>,
): Effect.Effect<RepoRoot, WorkspaceRootRefused, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const target = path.resolve(Option.getOrUndefined(given) ?? '.')
    const info = yield* fs.stat(target).pipe(
      Effect.mapError((error): WorkspaceRootRefused => ({
        _tag: 'WorkspaceRootRefused',
        given: target,
        reason: error.message,
      })),
    )
    let root = path.dirname(target)
    if (info.type === 'Directory') root = target
    return yield* S.decodeUnknownEffect(RepoRoot)(root).pipe(
      Effect.mapError((error): WorkspaceRootRefused => ({
        _tag: 'WorkspaceRootRefused',
        given: root,
        reason: error.message,
      })),
    )
  })

const deliver = (directives: ReadonlyArray<Directive>): Effect.Effect<void, never, Reporter> =>
  Effect.flatMap(Reporter, (reporter) =>
    Effect.forEach(
      directives,
      (directive) =>
        Match.value(directive).pipe(
          Match.tag('Say', (spoken) => reporter.emit(spoken.line)),
          Match.tag('Note', (noted) => reporter.note(noted.line)),
          Match.tag('Fail', (failed) => reporter.annotateError(failed.line)),
          Match.tag('Exit', (exit) => reporter.exitCode(exit.code)),
          Match.exhaustive,
        ),
      { discard: true },
    ))

const runBump = (configPath: Option.Option<string>) =>
  Effect.gen(function*() {
    const root = yield* rootOf(configPath)
    const configs = yield* ReleaseConfigStore
    const config = yield* configs.loadConfig(root)
    const request = yield* S.decodeUnknownEffect(BumpInput)(bumpRequestOf(config))
    return yield* Cell.run(Cell.provide(bumpCell, storesLive(root, config.changesetDir)), request)
  })

const runSync = (flags: {
  readonly subcommand: Option.Option<string>
  readonly version: Option.Option<string>
  readonly config: Option.Option<string>
}) =>
  Effect.gen(function*() {
    const root = yield* rootOf(flags.config)
    const action = Option.getOrUndefined(flags.subcommand)
    if (action === undefined) {
      return yield* Effect.fail<SyncActionMissing>({ _tag: 'SyncActionMissing' })
    }
    const configs = yield* ReleaseConfigStore
    const config = yield* configs.loadConfig(root)
    const request = yield* S.decodeUnknownEffect(SyncInput)(
      syncRequestOf(config, action, Option.getOrUndefined(flags.version)),
    )
    const outcome = yield* Cell.run(
      Cell.provide(syncCell, storesLive(root, config.changesetDir)),
      request,
    ).pipe(Effect.result)
    return { manifest: request.manifest.file, outcome }
  })

const runPin = (flags: {
  readonly manifest: Option.Option<string>
  readonly version: Option.Option<string>
  readonly dryRun: boolean
  readonly config: Option.Option<string>
}) =>
  Effect.gen(function*() {
    const root = yield* rootOf(flags.config)
    const configs = yield* ReleaseConfigStore
    const config = yield* configs.loadConfig(root)
    const requestedPath = Option.getOrUndefined(flags.manifest)
    let manifest: string | undefined
    if (requestedPath !== undefined) {
      manifest = yield* S.decodeUnknownEffect(RelativePath)(requestedPath).pipe(
        Effect.mapError((): ManifestPathRefused => ({
          _tag: 'ManifestPathRefused',
          given: requestedPath,
        })),
      )
    }
    const fromEnvironment = yield* Effect.sync(() => process.env['VERSION'])
    const request = yield* S.decodeUnknownEffect(PinRootManifestInput)(
      pinRequestOf(config, {
        manifest,
        version: Option.getOrUndefined(flags.version) ?? fromEnvironment,
        dryRun: flags.dryRun,
      }),
    )
    const outcome = yield* Cell.run(
      Cell.provide(pinRootManifestCell, storesLive(root, config.changesetDir)),
      request,
    ).pipe(Effect.result)
    return { request, outcome }
  })

const bump = Command.make('bump', { config: configFlag }, (flags) =>
  Effect.matchEffect(runBump(flags.config), {
    onFailure: (refusal) => deliver(renderRefusal(refusal)),
    onSuccess: (decision) => deliver(renderVersionDecision(decision)),
  }))

const sync = Command.make('sync', {
  subcommand: Argument.string('subcommand').pipe(Argument.optional),
  version: Argument.string('version').pipe(Argument.optional),
  config: configFlag,
}, (flags) =>
  Effect.matchEffect(runSync(flags), {
    onFailure: (refusal) => deliver(renderRefusal(refusal)),
    onSuccess: ({ manifest, outcome }) =>
      deliver(
        Result.match(outcome, {
          onFailure: (refusal) => renderSyncRefusal(refusal, manifest),
          onSuccess: (decision) => renderSyncDecision(decision),
        }),
      ),
  }))

const syncRoot = Command.make('sync-root', {
  manifest: Flag.string('manifest').pipe(Flag.optional),
  version: Flag.string('version').pipe(Flag.optional),
  dryRun: Flag.boolean('dry-run').pipe(Flag.withDefault(false)),
  config: configFlag,
}, (flags) =>
  Effect.matchEffect(runPin(flags), {
    onFailure: (refusal) => deliver(renderRefusal(refusal)),
    onSuccess: ({ request, outcome }) =>
      deliver(
        Result.match(outcome, {
          onFailure: (refusal) => renderRefusal(refusal),
          onSuccess: (decision) => renderPinDecision(decision, request.manifest, request.dryRun === true),
        }),
      ),
  }))

const versionCommand = Command.make('version').pipe(
  Command.withDescription('Version packages and sync version surfaces'),
  Command.withSubcommands([bump, sync, syncRoot]),
)

const edgeLive = Layer.mergeAll(
  ReleaseConfigStoreLive,
  ProcessLive,
  ReporterLive,
  NodeServices.layer,
).pipe(Layer.provide(NodeServices.layer))

NodeRuntime.runMain(Effect.provide(program(versionCommand, '0.0.0'), edgeLive))
