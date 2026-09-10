import { Context, type Effect } from 'effect'
import type { PublishRefusal } from './Publish.schema.ts'
import type { TrustRefusal, TrustSnapshot } from './Trust.schema.ts'
import type { PackageName, PackageVersion } from './Workspace.schema.ts'

export interface RegistryPort {
  readonly queryPackage: (
    name: PackageName,
  ) => Effect.Effect<TrustSnapshot, TrustRefusal, never>
  readonly isVersionPublished: (
    name: PackageName,
    version: PackageVersion,
  ) => Effect.Effect<boolean, TrustRefusal, never>
  readonly publishMember: (
    name: PackageName,
    version: PackageVersion,
    provenance: boolean,
  ) => Effect.Effect<void, PublishRefusal, never>
}

export const RegistryPort: Context.Service<RegistryPort, RegistryPort> = Context.Service<RegistryPort, RegistryPort>(
  'RegistryPort',
)
