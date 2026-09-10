import { Effect, Layer } from 'effect'
import { Reporter } from './Reporter.ts'

const writeStdout = (line: string): Effect.Effect<void> =>
  Effect.sync(() => {
    Deno.stdout.writeSync(new TextEncoder().encode(line))
  })

const writeStderr = (line: string): Effect.Effect<void> =>
  Effect.sync(() => {
    Deno.stderr.writeSync(new TextEncoder().encode(line))
  })

export const ReporterLive: Layer.Layer<Reporter> = Layer.succeed(Reporter, {
  emit: (text: string) => writeStdout(`${text}\n`),
  note: (text: string) => writeStderr(`${text}\n`),
  annotateError: (text: string) => writeStderr(`::error::${text}\n`),
  annotateWarning: (text: string) => writeStderr(`::warning::${text}\n`),
  exitCode: (code: number) =>
    Effect.sync(() => {
      Deno.exitCode = code
    }),
})
