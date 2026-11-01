import { Context, type Effect } from 'effect'
import type { RegistryDownloadFailed, RegistryMetadata, RegistryRefusal } from './Registry.schema.js'
import type { HttpUrl, PackageName, PackageVersion } from './Workspace.schema.js'

export interface RegistryPort {
  readonly metadata: (
    registry: HttpUrl,
    name: PackageName,
    version: PackageVersion,
  ) => Effect.Effect<RegistryMetadata, RegistryRefusal, never>
  readonly download: (
    url: HttpUrl,
  ) => Effect.Effect<Uint8Array, RegistryDownloadFailed, never>
}

export const RegistryPort: Context.Service<RegistryPort, RegistryPort> = Context.Service<
  RegistryPort,
  RegistryPort
>('RegistryPort')
