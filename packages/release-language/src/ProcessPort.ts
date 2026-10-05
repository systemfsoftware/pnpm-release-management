import { Context, type Effect } from 'effect'
import type { CommandRefusal, ProcessCompleted, WorkspaceCommand } from './Command.schema.js'

export interface ProcessPort {
  readonly runCommand: (
    command: WorkspaceCommand,
  ) => Effect.Effect<ProcessCompleted, CommandRefusal, never>
}

export const ProcessPort: Context.Service<ProcessPort, ProcessPort> = Context
  .Service<ProcessPort, ProcessPort>('ProcessPort')
