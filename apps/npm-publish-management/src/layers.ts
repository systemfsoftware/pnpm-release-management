import { NodeServices } from '@effect/platform-node'
import { ProcessLive } from '@systemfsoftware/process-adapter'
import { RegistryConfig, RegistryLive } from '@systemfsoftware/registry-adapter'
import { CycleStore, ProcessPort, RegistryPort, WorkspaceStore } from '@systemfsoftware/release-language'
import { CycleStoreLive, WorkspaceStoreLive } from '@systemfsoftware/workspace-adapter'
import { Layer } from 'effect'
import type { Workspace } from './workspace.js'

export const commandLive = (
  workspace: Workspace,
): Layer.Layer<WorkspaceStore | CycleStore | ProcessPort | RegistryPort, never, never> =>
  Layer.mergeAll(
    WorkspaceStoreLive(workspace.root),
    CycleStoreLive,
    Layer.provideMerge(
      RegistryLive,
      Layer.mergeAll(
        ProcessLive,
        Layer.succeed(RegistryConfig, { baseUrl: workspace.registry, root: workspace.root }),
      ),
    ),
  ).pipe(Layer.provide(NodeServices.layer))
