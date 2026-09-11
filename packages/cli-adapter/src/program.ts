import { NodeServices } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { Command } from 'effect/unstable/cli'
import { Reporter } from './Reporter.js'
import { ReporterLive } from './ReporterLive.js'

const describeFailure = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'unknown error'
}

export const program: <Name extends string, Input, ContextInput, E, R>(
  command: Command.Command<Name, Input, ContextInput, E, R>,
  version: string,
) => Effect.Effect<void, never, Exclude<R, Reporter | NodeServices.NodeServices>> = (
  command,
  version,
) => {
  const live = Layer.mergeAll(NodeServices.layer, ReporterLive)
  const run = Effect.suspend(() => Command.run(command, { version, renderErrors: false }))
  const handled = Effect.matchEffect(run, {
    onFailure: (error) =>
      Effect.gen(function*() {
        const reporter = yield* Reporter
        yield* reporter.annotateError(describeFailure(error))
        yield* reporter.exitCode(1)
      }),
    onSuccess: () => Effect.void,
  })
  return Effect.provide(handled, live)
}
