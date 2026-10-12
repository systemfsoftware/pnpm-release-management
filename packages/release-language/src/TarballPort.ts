import { Context, type Effect } from 'effect'
import type { TarballDigest, TarballRefusal, TarballUnreadable } from './Integrity.schema.js'
import type { FsPath } from './Workspace.schema.js'

export interface TarballPort {
  readonly read: (
    dir: FsPath,
  ) => Effect.Effect<ReadonlyArray<TarballDigest>, TarballRefusal, never>
  readonly digest: (
    source: FsPath,
    bytes: Uint8Array,
  ) => Effect.Effect<TarballDigest, TarballUnreadable, never>
  readonly sha256: (bytes: Uint8Array) => string
}

export const TarballPort: Context.Service<TarballPort, TarballPort> = Context.Service<
  TarballPort,
  TarballPort
>('TarballPort')
