import { NodeServices } from '@effect/platform-node'
import {
  type ProcessCompleted,
  ProcessPort,
  type PublishRefusal,
  type WorkspaceCommand,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import { ChildProcess } from 'effect/unstable/process'

const describeCause = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message
  }
  if (typeof cause === 'string') {
    return cause
  }
  return 'unknown error'
}

const startRefusal = (command: WorkspaceCommand, cause: unknown): PublishRefusal => ({
  _tag: 'PublishCommandRefused',
  command,
  reason: `${command.program} ${command.args.join(' ')} failed to start: ${describeCause(cause)}`,
})

const runCommand: ProcessPort['runCommand'] = (command: WorkspaceCommand) =>
  Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* ChildProcess.make(command.program, [...command.args], {
        cwd: command.cwd,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      }).pipe(Effect.mapError((cause) => startRefusal(command, cause)))
      const code = yield* handle.exitCode.pipe(Effect.mapError((cause) => startRefusal(command, cause)))
      if (code === 0) {
        const done: ProcessCompleted = { _tag: 'ProcessCompleted', command }
        return done
      }
      const refused: PublishRefusal = {
        _tag: 'PublishCommandRefused',
        command,
        reason: `${command.program} ${command.args.join(' ')} failed (exit ${code})`,
      }
      return yield* Effect.fail(refused)
    }),
  ).pipe(Effect.provide(NodeServices.layer))

export const ProcessLive: Layer.Layer<ProcessPort, never, never> = Layer.succeed(
  ProcessPort,
  { runCommand },
)
