import { Console, Effect, Layer } from 'effect'
import { Reporter } from './Reporter.js'

const annotationPrefix = {
  error: '::error::',
  warning: '::warning::',
}

export const ReporterLive: Layer.Layer<Reporter> = Layer.succeed(Reporter, {
  emit: (text: string) => Console.log(text),
  note: (text: string) => Console.error(text),
  annotateError: (text: string) => Console.error(`${annotationPrefix.error}${text}`),
  annotateWarning: (text: string) => Console.error(`${annotationPrefix.warning}${text}`),
  exitCode: (code: number) =>
    Effect.sync(() => {
      process.exitCode = code
    }),
})
