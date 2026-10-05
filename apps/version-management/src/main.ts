import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { program, ReporterLive } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { ProcessLive } from '@systemfsoftware/process-adapter'
import { bumpCell, pinRootManifestCell, syncCell } from '@systemfsoftware/version-engine'
import { ReleaseConfigStoreLive } from '@systemfsoftware/workspace-adapter'
import { Effect, Layer, Option, Result } from 'effect'
import { Argument, Command, Flag } from 'effect/unstable/cli'
import { bumpRequestOf, pinRequestOf, storesOf, syncRequestOf, syncWorkspaceOf, workspaceOf } from './boundary.js'
import {
  renderPinDecision,
  renderRefusal,
  renderSyncDecision,
  renderSyncRefusal,
  renderVersionDecision,
} from './render.js'

const configFlag = Flag.string('config').pipe(Flag.optional)

const runBump = (config: Option.Option<string>) =>
  Effect.gen(function*() {
    const workspace = yield* workspaceOf(config)
    const request = bumpRequestOf(workspace.release)
    return yield* Cell.run(Cell.provide(bumpCell, storesOf(workspace)), request)
  })

const runSync = (flags: {
  readonly subcommand: Option.Option<string>
  readonly version: Option.Option<string>
  readonly config: Option.Option<string>
}) =>
  Effect.gen(function*() {
    const workspace = yield* syncWorkspaceOf(flags.config, flags.subcommand)
    const request = syncRequestOf(
      workspace.release,
      workspace.action,
      Option.getOrUndefined(flags.version),
    )
    const outcome = yield* Cell.run(Cell.provide(syncCell, storesOf(workspace)), request).pipe(
      Effect.result,
    )
    return { manifest: request.manifest.file, outcome }
  })

const runPin = (flags: {
  readonly manifest: Option.Option<string>
  readonly version: Option.Option<string>
  readonly dryRun: boolean
  readonly config: Option.Option<string>
}) =>
  Effect.gen(function*() {
    const workspace = yield* workspaceOf(flags.config)
    const request = yield* pinRequestOf(workspace.release, flags)
    const outcome = yield* Cell.run(Cell.provide(pinRootManifestCell, storesOf(workspace)), request)
      .pipe(Effect.result)
    return { request, outcome }
  })

const bump = Command.make('bump', { config: configFlag }, (flags) =>
  Effect.matchEffect(runBump(flags.config), {
    onFailure: renderRefusal,
    onSuccess: renderVersionDecision,
  }))

const sync = Command.make('sync', {
  subcommand: Argument.string('subcommand').pipe(Argument.optional),
  version: Argument.string('version').pipe(Argument.optional),
  config: configFlag,
}, (flags) =>
  Effect.matchEffect(runSync(flags), {
    onFailure: renderRefusal,
    onSuccess: ({ manifest, outcome }) =>
      Result.match(outcome, {
        onFailure: (refusal) => renderSyncRefusal(refusal, manifest),
        onSuccess: renderSyncDecision,
      }),
  }))

const syncRoot = Command.make('sync-root', {
  manifest: Flag.string('manifest').pipe(Flag.optional),
  version: Flag.string('version').pipe(Flag.optional),
  dryRun: Flag.boolean('dry-run').pipe(Flag.withDefault(false)),
  config: configFlag,
}, (flags) =>
  Effect.matchEffect(runPin(flags), {
    onFailure: renderRefusal,
    onSuccess: ({ request, outcome }) =>
      Result.match(outcome, {
        onFailure: renderRefusal,
        onSuccess: (decision) => renderPinDecision(decision, request.manifest, request.dryRun === true),
      }),
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
