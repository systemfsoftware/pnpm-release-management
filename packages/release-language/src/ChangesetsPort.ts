import { Context, type Effect } from 'effect'
import type { PlannedBump } from './ChangesetsPort.schema.js'
import type { VersionRefusal } from './Version.schema.js'

export interface ChangesetsPort {
  readonly plan: () => Effect.Effect<PlannedBump, VersionRefusal, never>
  readonly apply: () => Effect.Effect<void, VersionRefusal, never>
}

export const ChangesetsPort: Context.Service<ChangesetsPort, ChangesetsPort> = Context.Service<
  ChangesetsPort,
  ChangesetsPort
>('ChangesetsPort')
