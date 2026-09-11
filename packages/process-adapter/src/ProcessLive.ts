import { NodeServices } from '@effect/platform-node'
import {
  ProcessCompleted,
  ProcessPort,
  type PublishRefusal,
  type WorkspaceCommand,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import { runProcess } from './ProcessRun.js'

const refusal = (command: WorkspaceCommand, reason: string): PublishRefusal => ({
  _tag: 'PublishCommandRefused',
  command,
  reason,
})

const runCommand: ProcessPort['runCommand'] = (command) =>
  Effect.gen(function*() {
    const described = `${command.program} ${command.args.join(' ')}`
    const outcome = yield* runProcess({
      program: command.program,
      args: command.args,
      cwd: command.cwd,
      stdio: 'streamed',
    }).pipe(
      Effect.mapError((fault) => refusal(command, `${described} failed to start: ${fault.reason}`)),
    )
    if (outcome.code !== 0) {
      return yield* Effect.fail(
        refusal(command, `${described} failed (exit ${outcome.code})`),
      )
    }
    return ProcessCompleted.make({ command })
  }).pipe(Effect.provide(NodeServices.layer))

export const ProcessLive: Layer.Layer<ProcessPort, never, never> = Layer.succeed(
  ProcessPort,
  { runCommand },
)
