import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { program, Reporter, ReporterLive } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { GitLive } from '@systemfsoftware/git-adapter'
import { publishPackagesCell, publishStatusCell, stageNpmTrustCell } from '@systemfsoftware/npm-publish-engine'
import { ProcessLive } from '@systemfsoftware/process-adapter'
import { RegistryConfig, RegistryLive } from '@systemfsoftware/registry-adapter'
import {
  CycleStore,
  type GitPort,
  ProcessPort,
  RegistryPort,
  ReleaseConfigStore,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { CycleStoreLive, ReleaseConfigStoreLive, WorkspaceStoreLive } from '@systemfsoftware/workspace-adapter'
import { Effect, Layer, Option } from 'effect'
import { Command, Flag } from 'effect/unstable/cli'
import {
  jobsOf,
  originSlug,
  publishRequestOf,
  statusModeOf,
  statusOutputModeOf,
  statusTargetsOf,
  trustRequestOf,
  type Workspace,
  workspaceOf,
} from './boundary.js'
import { announcePublish, announceStatus, announceTrust, refusePublish, refuseStatus, refuseTrust } from './render.js'

const VERSION = '0.0.0'

const rootLive: Layer.Layer<ReleaseConfigStore | GitPort | Reporter | NodeServices.NodeServices, never, never> = Layer
  .mergeAll(ReleaseConfigStoreLive, GitLive, ReporterLive).pipe(Layer.provideMerge(NodeServices.layer))

const commandLive = (
  workspace: Workspace,
): Layer.Layer<WorkspaceStore | CycleStore | ProcessPort | RegistryPort, never, never> =>
  Layer.mergeAll(
    WorkspaceStoreLive(workspace.root),
    CycleStoreLive,
    Layer.provideMerge(
      RegistryLive,
      Layer.mergeAll(
        ProcessLive,
        Layer.succeed(RegistryConfig, { baseUrl: workspace.registry, root: workspace.root }),
      ),
    ),
  ).pipe(Layer.provide(NodeServices.layer))

const publish = Command.make(
  'publish',
  {
    dryRun: Flag.boolean('dry-run').pipe(Flag.withDefault(false)),
    unpublished: Flag.boolean('unpublished').pipe(Flag.withDefault(false)),
    noProvenance: Flag.boolean('no-provenance').pipe(Flag.withDefault(false)),
    captured: Flag.string('captured').pipe(Flag.optional),
    capturedFile: Flag.string('captured-file').pipe(Flag.optional),
    filters: Flag.string('filters').pipe(Flag.optional),
    registry: Flag.string('registry').pipe(Flag.optional),
    config: Flag.string('config').pipe(Flag.optional),
  },
  (flags) =>
    Effect.matchEffect(
      Effect.gen(function*() {
        const workspace = yield* workspaceOf(flags.config, flags.registry)
        const request = yield* publishRequestOf(workspace, flags)
        const decision = yield* Cell.run(Cell.provide(publishPackagesCell, commandLive(workspace)), request)
        yield* announcePublish(decision)
      }),
      { onFailure: refusePublish, onSuccess: () => Effect.void },
    ),
)

const status = Command.make(
  'status',
  {
    json: Flag.boolean('json').pipe(Flag.withDefault(false)),
    preflight: Flag.boolean('preflight').pipe(Flag.withDefault(false)),
    check: Flag.boolean('check').pipe(Flag.withDefault(false)),
    emitFilters: Flag.string('emit-filters').pipe(Flag.optional),
    emitDeferred: Flag.string('emit-deferred').pipe(Flag.optional),
    registry: Flag.string('registry').pipe(Flag.optional),
    config: Flag.string('config').pipe(Flag.optional),
  },
  (flags) => {
    const mode = statusModeOf(flags.preflight, flags.check)
    return Effect.matchEffect(
      Effect.gen(function*() {
        const workspace = yield* workspaceOf(flags.config, flags.registry)
        const targets = yield* statusTargetsOf(flags.emitFilters, flags.emitDeferred)
        const report = yield* Cell.run(Cell.provide(publishStatusCell, commandLive(workspace)), { mode })
        yield* announceStatus({
          report,
          targets,
          registry: workspace.registry,
          check: flags.check,
          output: statusOutputModeOf({
            json: flags.json,
            preflight: flags.preflight,
            emit: Option.isSome(targets.filters) || Option.isSome(targets.deferred),
          }),
        })
      }),
      {
        onFailure: (refusal) => refuseStatus(refusal, mode),
        onSuccess: () => Effect.void,
      },
    )
  },
)

const trust = Command.make(
  'trust',
  {
    dryRun: Flag.boolean('dry-run').pipe(Flag.withDefault(false)),
    only: Flag.string('only').pipe(Flag.withAlias('o'), Flag.optional),
    jobs: Flag.string('jobs').pipe(Flag.optional),
    file: Flag.string('file').pipe(Flag.optional),
    registry: Flag.string('registry').pipe(Flag.optional),
    config: Flag.string('config').pipe(Flag.optional),
  },
  (flags) =>
    Effect.matchEffect(
      Effect.gen(function*() {
        const workspace = yield* workspaceOf(flags.config, flags.registry)
        const slug = yield* originSlug()
        const request = yield* trustRequestOf(workspace, slug, flags)
        const decision = yield* Cell.run(Cell.provide(stageNpmTrustCell, commandLive(workspace)), request)
        yield* announceTrust(decision, jobsOf(flags.jobs))
      }),
      { onFailure: refuseTrust, onSuccess: () => Effect.void },
    ),
)

const npm = Command.make('npm').pipe(
  Command.withDescription('Publish packages to npm and manage trusted publishing'),
  Command.withSubcommands([publish, status, trust]),
)

NodeRuntime.runMain(Effect.provide(program(npm, VERSION), rootLive))
