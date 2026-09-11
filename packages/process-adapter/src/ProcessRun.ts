import { ProcessUnobservable, ProcessUnstartable } from '@systemfsoftware/release-language'
import { Effect, Stream } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { ChildProcess } from 'effect/unstable/process'
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner'

export type ProcessStdio = 'streamed' | 'captured'

export interface ProcessRequest {
  readonly program: string
  readonly args: ReadonlyArray<string>
  readonly cwd: string | undefined
  readonly stdio: ProcessStdio
}

export interface ProcessOutcome {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export type ProcessFault = ProcessUnstartable | ProcessUnobservable

interface Stdio {
  readonly stdin: 'ignore' | 'inherit'
  readonly stdout: 'pipe' | 'inherit'
  readonly stderr: 'pipe' | 'inherit'
}

const STDIO: Record<ProcessStdio, Stdio> = {
  captured: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
  streamed: { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
}

export const runProcess = (
  request: ProcessRequest,
): Effect.Effect<ProcessOutcome, ProcessFault, ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
      const unstartable = (cause: PlatformError): ProcessUnstartable =>
        new ProcessUnstartable({
          program: request.program,
          reason: cause.message,
        })
      const unobservable = (cause: PlatformError): ProcessUnobservable =>
        new ProcessUnobservable({
          program: request.program,
          reason: cause.message,
        })
      const handle = yield* ChildProcess.make(
        request.program,
        [...request.args],
        { cwd: request.cwd, ...STDIO[request.stdio] },
      ).pipe(Effect.mapError(unstartable))
      if (request.stdio === 'streamed') {
        const code = yield* handle.exitCode.pipe(Effect.mapError(unobservable))
        return { code, stdout: '', stderr: '' }
      }
      const [stdout, stderr, code] = yield* Effect.all(
        [
          handle.stdout.pipe(
            Stream.decodeText,
            Stream.mkString,
            Effect.mapError(unobservable),
          ),
          handle.stderr.pipe(
            Stream.decodeText,
            Stream.mkString,
            Effect.mapError(unobservable),
          ),
          handle.exitCode.pipe(Effect.mapError(unobservable)),
        ],
        { concurrency: 3 },
      )
      return { code, stdout, stderr }
    }),
  )
