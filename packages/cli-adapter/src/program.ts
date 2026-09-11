import { NodeServices } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { Command } from 'effect/unstable/cli'
import { Reporter } from './Reporter.js'
import { ReporterLive } from './ReporterLive.js'

const describeFailure = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message
  }
  if (typeof cause === 'string') {
    return cause
  }
  return 'unknown error'
}

export const program: <Name extends string, Input, ContextInput, E, R>(
  command: Command.Command<Name, Input, ContextInput, E, R>,
  version: string,
) => Effect.Effect<void, never, Exclude<R, Reporter | NodeServices.NodeServices>> = (
  command,
  version,
) =>
  Effect.provide(
    Effect.suspend(() => Command.run(command, { version, renderErrors: false })).pipe(
      Effect.matchEffect({
        onFailure: (cause) =>
          Effect.flatMap(Reporter, (reporter) =>
            Effect.andThen(reporter.annotateError(describeFailure(cause)), () => reporter.exitCode(1))),
        onSuccess: () =>
          Effect.void,
      }),
    ),
    Layer.mergeAll(NodeServices.layer, ReporterLive),
  )
