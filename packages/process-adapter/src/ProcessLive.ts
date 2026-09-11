import { NodeServices } from '@effect/platform-node'
import {
  ProcessCompleted,
  ProcessPort,
  PublishCommandRefused,
  type PublishRefusal,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import { runProcess } from './ProcessRun.js'

const runCommand: ProcessPort['runCommand'] = (command) =>
  Effect.gen(function*() {
    const described = `${command.program} ${command.args.join(' ')}`
    const refused = (reason: string): PublishRefusal => PublishCommandRefused.make({ command, reason })
    const outcome = yield* runProcess({
      program: command.program,
      args: command.args,
      cwd: command.cwd,
      stdio: 'streamed',
    }).pipe(
      Effect.mapError((fault) => refused(`${described} failed to start: ${fault.reason}`)),
    )
    if (outcome.code !== 0) {
      return yield* Effect.fail(refused(`${described} failed (exit ${outcome.code})`))
    }
    return ProcessCompleted.make({ command })
  }).pipe(Effect.provide(NodeServices.layer))

export const ProcessLive: Layer.Layer<ProcessPort, never, never> = Layer.succeed(
  ProcessPort,
  { runCommand },
)
