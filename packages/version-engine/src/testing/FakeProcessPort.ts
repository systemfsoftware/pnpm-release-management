import {
  type ProcessCompleted,
  ProcessPort,
  type PublishRefusal,
  type WorkspaceCommand,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'

export type FakeProcessState = {
  readonly calls: Array<WorkspaceCommand>
}

export const makeFakeProcessPort = (
  handler?: (command: WorkspaceCommand) => Effect.Effect<ProcessCompleted, PublishRefusal>,
): { readonly layer: Layer.Layer<ProcessPort>; readonly state: FakeProcessState } => {
  const calls: Array<WorkspaceCommand> = []
  const layer = Layer.succeed(ProcessPort, {
    runCommand: (command: WorkspaceCommand) => {
      calls.push(command)
      if (handler === undefined) {
        return Effect.succeed({ _tag: 'ProcessCompleted', command } as const)
      }
      return handler(command)
    },
  })
  return { layer, state: { calls } }
}
