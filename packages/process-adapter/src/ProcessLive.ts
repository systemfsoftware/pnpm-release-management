import {
  type ProcessCompleted,
  ProcessPort,
  type PublishRefusal,
  type WorkspaceCommand,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'

const describeCause = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

const runCommand: ProcessPort['runCommand'] = (
  command: WorkspaceCommand,
): Effect.Effect<ProcessCompleted, PublishRefusal> =>
  Effect.gen(function*() {
    const out = yield* Effect.tryPromise({
      try: () =>
        new Deno.Command(command.program, {
          args: [...command.args],
          cwd: command.cwd,
          stdin: 'inherit',
          stdout: 'inherit',
          stderr: 'inherit',
        }).output(),
      catch: (cause): PublishRefusal => ({
        _tag: 'PublishCommandRefused',
        command,
        reason: `${command.program} ${command.args.join(' ')} failed to start: ${describeCause(cause)}`,
      }),
    })
    if (out.success) {
      const done: ProcessCompleted = { _tag: 'ProcessCompleted', command }
      return done
    }
    const refused: PublishRefusal = {
      _tag: 'PublishCommandRefused',
      command,
      reason: `${command.program} ${command.args.join(' ')} failed (exit ${out.code})`,
    }
    return yield* Effect.fail(refused)
  })

export const ProcessLive: Layer.Layer<ProcessPort, never, never> = Layer.succeed(
  ProcessPort,
  { runCommand },
)
