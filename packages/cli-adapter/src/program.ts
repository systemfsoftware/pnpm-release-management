import type { NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import { Command } from 'effect/unstable/cli'
import { Reporter } from './Reporter.js'

const describeFailure = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message
  }
  if (typeof cause === 'string') {
    return cause
  }
  return 'unknown error'
}

export const program = <Name extends string, Input, ContextInput, E, R>(
  command: Command.Command<Name, Input, ContextInput, E, R>,
  version: string,
): Effect.Effect<void, never, R | Reporter | NodeServices.NodeServices> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    yield* Command.run(command, { version, renderErrors: false }).pipe(
      Effect.catch((failure) =>
        Effect.gen(function*() {
          yield* reporter.annotateError(describeFailure(failure))
          yield* reporter.exitCode(1)
        })
      ),
    )
  })
