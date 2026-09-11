import { Context, type Effect } from 'effect'
import type { ProcessCompleted, PublishRefusal, WorkspaceCommand } from './Publish.schema.js'

export interface ProcessPort {
  readonly runCommand: (
    command: WorkspaceCommand,
  ) => Effect.Effect<ProcessCompleted, PublishRefusal, never>
}

export const ProcessPort: Context.Service<ProcessPort, ProcessPort> = Context
  .Service<ProcessPort, ProcessPort>('ProcessPort')
