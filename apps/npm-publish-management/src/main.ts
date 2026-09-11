import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { program, Reporter, ReporterLive } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { GitLive } from '@systemfsoftware/git-adapter'
import { publishPackagesCell, publishStatusCell, stageNpmTrustCell } from '@systemfsoftware/npm-publish-engine'
import { type GitPort, ReleaseConfigStore } from '@systemfsoftware/release-language'
import { ReleaseConfigStoreLive } from '@systemfsoftware/workspace-adapter'
import { Effect, Layer, Option } from 'effect'
import { Command, Flag } from 'effect/unstable/cli'
import { commandLive } from './layers.js'
import { announcePublish, announceStatus, announceTrust, refusePublish, refuseStatus, refuseTrust } from './report.js'
import {
  jobsOf,
  publishRequestOf,
  statusModeOf,
  statusOutputModeOf,
  statusRequestOf,
  statusTargetsOf,
  trustRequestOf,
} from './request.js'
import { originSlug, workspaceOf } from './workspace.js'

const VERSION = '0.0.0'

const rootLive: Layer.Layer<ReleaseConfigStore | GitPort | Reporter | NodeServices.NodeServices, never, never> = Layer
  .mergeAll(ReleaseConfigStoreLive, GitLive, ReporterLive).pipe(Layer.provideMerge(NodeServices.layer))

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
  (flags) => {
    const run = Effect.flatMap(
      workspaceOf(flags.config, flags.registry),
      (workspace) =>
        Effect.flatMap(publishRequestOf(workspace, flags), (request) =>
          Effect.flatMap(
            Cell.run(Cell.provide(publishPackagesCell, commandLive(workspace)), request),
            announcePublish,
          )),
    )
    return Effect.matchEffect(run, { onFailure: refusePublish, onSuccess: () => Effect.void })
  },
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
    const run = Effect.flatMap(
      workspaceOf(flags.config, flags.registry),
      (workspace) =>
        Effect.flatMap(
          statusTargetsOf(flags.emitFilters, flags.emitDeferred),
          (targets) =>
            Effect.flatMap(statusRequestOf(mode), (request) =>
              Effect.flatMap(
                Cell.run(Cell.provide(publishStatusCell, commandLive(workspace)), request),
                (report) =>
                  announceStatus({
                    report,
                    targets,
                    registry: workspace.registry,
                    check: flags.check,
                    output: statusOutputModeOf({
                      json: flags.json,
                      preflight: flags.preflight,
                      emit: Option.isSome(targets.filters) || Option.isSome(targets.deferred),
                    }),
                  }),
              )),
        ),
    )
    return Effect.matchEffect(run, {
      onFailure: (refusal) => refuseStatus(refusal, mode),
      onSuccess: () => Effect.void,
    })
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
  (flags) => {
    const run = Effect.flatMap(
      workspaceOf(flags.config, flags.registry),
      (workspace) =>
        Effect.flatMap(
          originSlug(),
          (slug) =>
            Effect.flatMap(trustRequestOf(workspace, slug, flags), (request) =>
              Effect.flatMap(
                Cell.run(Cell.provide(stageNpmTrustCell, commandLive(workspace)), request),
                (decision) => announceTrust(decision, jobsOf(flags.jobs)),
              )),
        ),
    )
    return Effect.matchEffect(run, { onFailure: refuseTrust, onSuccess: () => Effect.void })
  },
)

const npm = Command.make('npm').pipe(
  Command.withDescription('Publish packages to npm and manage trusted publishing'),
  Command.withSubcommands([publish, status, trust]),
)

NodeRuntime.runMain(Effect.provide(program(npm, VERSION), rootLive))
