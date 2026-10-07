import { Context, type Effect } from 'effect'
import type { TarballDigest, TarballRefusal } from './Integrity.schema.js'
import type { FsPath } from './Workspace.schema.js'

export interface TarballPort {
  readonly read: (
    dir: FsPath,
  ) => Effect.Effect<ReadonlyArray<TarballDigest>, TarballRefusal, never>
}

export const TarballPort: Context.Service<TarballPort, TarballPort> = Context.Service<
  TarballPort,
  TarballPort
>('TarballPort')
