import { ProcessLive } from '@systemfsoftware/process-adapter'
import { RegistryConfig, RegistryLive } from '@systemfsoftware/registry-adapter'
import {
  type CycleStore,
  type ProcessPort,
  type RegistryPort,
  type RepoRoot,
  type WorkspaceStore,
} from '@systemfsoftware/release-language'
import { CycleStoreLive, WorkspaceStoreLive } from '@systemfsoftware/workspace-adapter'
import { Layer } from 'effect'

export interface MainLiveOptions {
  readonly root: RepoRoot
  readonly baseUrl: string
}

export const makeMainLive = (
  options: MainLiveOptions,
): Layer.Layer<RegistryPort | ProcessPort | WorkspaceStore | CycleStore, never, never> =>
  Layer.mergeAll(
    WorkspaceStoreLive(options.root),
    CycleStoreLive,
    ProcessLive,
    Layer.provide(
      RegistryLive,
      Layer.mergeAll(
        Layer.succeed(RegistryConfig, { baseUrl: options.baseUrl, root: options.root }),
        ProcessLive,
      ),
    ),
  )
