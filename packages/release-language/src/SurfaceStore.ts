import { Context, type Effect } from 'effect'
import type { VersionSurface } from './Config.schema.js'
import type { SurfaceWrite } from './Sync.schema.js'
import type { VersionRefusal } from './Version.schema.js'
import type { PackageVersion, RelativePath, RootFile } from './Workspace.schema.js'

export interface SurfaceStore {
  readonly readSurface: (
    file: RelativePath,
    surface: VersionSurface,
  ) => Effect.Effect<PackageVersion, VersionRefusal, never>
  readonly writeSurface: (
    file: RelativePath,
    surface: VersionSurface,
    version: PackageVersion,
  ) => Effect.Effect<SurfaceWrite, VersionRefusal, never>
  readonly writeRootManifest: (
    path: RelativePath,
    text: string,
  ) => Effect.Effect<RootFile, VersionRefusal, never>
}

export const SurfaceStore: Context.Service<SurfaceStore, SurfaceStore> = Context.Service<SurfaceStore, SurfaceStore>(
  'SurfaceStore',
)
