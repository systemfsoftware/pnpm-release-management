import { DenoServices } from '@effect/platform-deno'
import { Effect, Layer } from 'effect'
import { Command } from 'effect/unstable/cli'
import { Reporter } from './Reporter.ts'
import { ReporterLive } from './ReporterLive.ts'

const describeFailure = (error: unknown): string => error instanceof Error ? error.message : String(error)

export const program: <Name extends string, Input, ContextInput, E, R>(
  command: Command.Command<Name, Input, ContextInput, E, R>,
  version: string,
) => Effect.Effect<void, never, Exclude<R, Reporter | DenoServices.DenoServices>> = (
  command,
  version,
) => {
  const live = Layer.mergeAll(DenoServices.layer, ReporterLive)
  const run = Effect.suspend(() => Command.runWith(command, { version, renderErrors: false })(Deno.args))
  const handled = Effect.catch(run, (error) =>
    Effect.gen(function*() {
      const reporter = yield* Reporter
      yield* reporter.annotateError(describeFailure(error))
      yield* reporter.exitCode(1)
    }))
  return Effect.provide(handled, live)
}
