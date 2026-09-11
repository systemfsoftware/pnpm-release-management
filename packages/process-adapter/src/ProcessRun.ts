import { Effect, Match, Stream } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { ChildProcess } from 'effect/unstable/process'
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner'
import {
  CapturedBase,
  type CapturedOutcome,
  type ProcessFault,
  type ProcessOutcome,
  ProcessUnobservable,
  ProcessUnstartable,
  StreamedBase,
  type StreamedOutcome,
} from './Process.schema.js'

export type ProcessStdio = 'streamed' | 'captured'

export interface ProcessRequest {
  readonly program: string
  readonly args: ReadonlyArray<string>
  readonly cwd: string | undefined
  readonly stdio: ProcessStdio
}

const drain = (
  stdio: ProcessStdio,
  source: Stream.Stream<Uint8Array, PlatformError>,
  fault: (cause: PlatformError) => ProcessFault,
): Effect.Effect<string, ProcessFault> =>
  Match.value(stdio).pipe(
    Match.when('streamed', (): Effect.Effect<string, ProcessFault> => Effect.succeed('')),
    Match.when('captured', (): Effect.Effect<string, ProcessFault> =>
      source.pipe(Stream.decodeText, Stream.mkString, Effect.mapError(fault))),
    Match.exhaustive,
  )

export function runProcess(
  request: ProcessRequest & { readonly stdio: 'streamed' },
): Effect.Effect<StreamedOutcome, ProcessFault, ChildProcessSpawner>
export function runProcess(
  request: ProcessRequest & { readonly stdio: 'captured' },
): Effect.Effect<CapturedOutcome, ProcessFault, ChildProcessSpawner>
export function runProcess(
  request: ProcessRequest,
): Effect.Effect<ProcessOutcome, ProcessFault, ChildProcessSpawner> {
  return Effect.scoped(
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
      const command = Match.value(request.stdio).pipe(
        Match.when('streamed', () =>
          ChildProcess.make(request.program, [...request.args], {
            cwd: request.cwd,
            stdin: 'inherit',
            stdout: 'inherit',
            stderr: 'inherit',
          })),
        Match.when('captured', () =>
          ChildProcess.make(request.program, [...request.args], {
            cwd: request.cwd,
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
          })),
        Match.exhaustive,
      )
      const handle = yield* command.pipe(Effect.mapError(unstartable))
      const [stdout, stderr, code] = yield* Effect.all(
        [
          drain(request.stdio, handle.stdout, unobservable),
          drain(request.stdio, handle.stderr, unobservable),
          handle.exitCode.pipe(Effect.mapError(unobservable)),
        ],
        { concurrency: 3 },
      )
      return Match.value(request.stdio).pipe(
        Match.when('streamed', (): ProcessOutcome => StreamedBase.make({ code })),
        Match.when('captured', (): ProcessOutcome => CapturedBase.make({ code, stdout, stderr })),
        Match.exhaustive,
      )
    }),
  )
}
