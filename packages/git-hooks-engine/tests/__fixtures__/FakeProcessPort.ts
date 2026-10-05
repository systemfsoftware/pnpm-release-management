import { ProcessPort } from '@systemfsoftware/release-language'
import type { CommandRefusal, ProcessCompleted, WorkspaceCommand } from '@systemfsoftware/release-language'
import { Layer } from 'effect'
import type { Effect } from 'effect'

export const makeFakeProcessPort = (
  behavior: (command: WorkspaceCommand) => Effect.Effect<ProcessCompleted, CommandRefusal>,
): {
  readonly layer: Layer.Layer<ProcessPort>
  readonly commands: ReadonlyArray<WorkspaceCommand>
} => {
  const commands: Array<WorkspaceCommand> = []
  return {
    layer: Layer.succeed(ProcessPort, {
      runCommand: (command) => {
        commands.push(command)
        return behavior(command)
      },
    }),
    commands,
  }
}
