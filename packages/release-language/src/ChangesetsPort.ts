import { Context, type Effect } from 'effect'
import type { PlannedBump } from './ChangesetsPort.schema.js'
import type { VersionIntentMalformed, VersionUnknownPackage } from './Version.schema.js'

export type ChangesetsRefusal = VersionIntentMalformed | VersionUnknownPackage

export interface ChangesetsPort {
  readonly plan: () => Effect.Effect<PlannedBump, ChangesetsRefusal, never>
  readonly apply: () => Effect.Effect<void, ChangesetsRefusal, never>
}

export const ChangesetsPort: Context.Service<ChangesetsPort, ChangesetsPort> = Context.Service<
  ChangesetsPort,
  ChangesetsPort
>('ChangesetsPort')
