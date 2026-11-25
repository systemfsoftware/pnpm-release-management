import { Context, type Effect } from 'effect'
import type { PlannedBump } from './ChangesetsPort.schema.js'
import type { VersionIntentMalformed, VersionPrivatePackage, VersionUnknownPackage } from './Version.schema.js'
import type { ManifestInvalid, ManifestUnreadable } from './Workspace.schema.js'

export type ChangesetsRefusal =
  | VersionIntentMalformed
  | VersionUnknownPackage
  | VersionPrivatePackage
  | ManifestInvalid
  | ManifestUnreadable

export interface ChangesetsPort {
  readonly plan: () => Effect.Effect<PlannedBump, ChangesetsRefusal, never>
  readonly apply: () => Effect.Effect<void, ChangesetsRefusal, never>
}

export const ChangesetsPort: Context.Service<ChangesetsPort, ChangesetsPort> = Context.Service<
  ChangesetsPort,
  ChangesetsPort
>('ChangesetsPort')
