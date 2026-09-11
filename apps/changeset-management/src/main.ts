import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { gateChangesCell, newIntentCell } from '@systemfsoftware/changeset-engine'
import { program, ReporterLive } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { GitLive } from '@systemfsoftware/git-adapter'
import { ChangeEvidenceLive } from '@systemfsoftware/process-adapter'
import { ReleaseConfigStoreLive } from '@systemfsoftware/workspace-adapter'
import { Effect, Layer, Option } from 'effect'
import { Argument, Command, Flag } from 'effect/unstable/cli'
import { baseRefOf, storesOf, taskOf, workspaceOf } from './boundary.js'
import { renderGate, renderRefusal, renderStaged } from './render.js'

const VERSION = '0.0.0'

const AppLive = Layer.mergeAll(
  ReleaseConfigStoreLive,
  Layer.provide(ChangeEvidenceLive, GitLive),
).pipe(Layer.provide(NodeServices.layer))

const newIntent = Command.make('new', {
  names: Argument.variadic(Argument.string('package')),
  bump: Flag.string('bump').pipe(Flag.withAlias('b'), Flag.optional),
  summary: Flag.string('summary').pipe(Flag.withAlias('s'), Flag.optional),
  slug: Flag.string('slug').pipe(Flag.optional),
  config: Flag.string('config').pipe(Flag.optional),
}, (flags) =>
  Effect.matchEffect(
    Effect.gen(function*() {
      const workspace = yield* workspaceOf(flags.config)
      const intent = yield* Cell.run(Cell.provide(newIntentCell, storesOf(workspace)), {
        packages: flags.names,
        bump: Option.getOrUndefined(flags.bump),
        summary: Option.getOrUndefined(flags.summary),
        slug: Option.getOrUndefined(flags.slug),
      })
      return { root: workspace.root, intent }
    }),
    {
      onFailure: renderRefusal,
      onSuccess: (staged) => renderStaged(staged.root, staged.intent),
    },
  ))

const check = Command.make('check', {
  base: Argument.string('base-sha-or-ref').pipe(Argument.optional),
  baseFlag: Flag.string('base').pipe(Flag.optional),
  skipLiveness: Flag.boolean('skip-liveness').pipe(Flag.withDefault(false)),
  config: Flag.string('config').pipe(Flag.optional),
}, (flags) =>
  Effect.matchEffect(
    Effect.gen(function*() {
      const ref = yield* baseRefOf(flags.base, flags.baseFlag)
      const workspace = yield* workspaceOf(flags.config)
      return yield* Cell.run(Cell.provide(gateChangesCell, storesOf(workspace)), {
        root: workspace.root,
        ref,
        strategy: workspace.release.gate.strategy,
        task: taskOf(workspace.release.gate),
        skipLiveness: flags.skipLiveness,
      })
    }),
    { onFailure: renderRefusal, onSuccess: renderGate },
  ))

const changeset = Command.make('changeset').pipe(
  Command.withDescription('Author and gate the change intents that drive a release'),
  Command.withSubcommands([newIntent, check]),
)

NodeRuntime.runMain(
  Effect.provide(
    program(changeset, VERSION),
    Layer.mergeAll(AppLive, ReporterLive, NodeServices.layer),
  ),
)
