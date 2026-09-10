import { Context, type Effect } from 'effect'
import type { ConfigRefusal, ReleaseConfig } from './Config.schema.ts'
import type { RepoRoot } from './Workspace.schema.ts'

export interface ReleaseConfigStore {
  readonly loadConfig: (
    root: RepoRoot,
  ) => Effect.Effect<ReleaseConfig, ConfigRefusal, never>
}

export const ReleaseConfigStore: Context.Service<
  ReleaseConfigStore,
  ReleaseConfigStore
> = Context.Service<ReleaseConfigStore, ReleaseConfigStore>(
  'ReleaseConfigStore',
)
