import { Context, type Effect } from 'effect'
import type { CycleEntry, PlanRefusal } from './Plan.schema.js'
import type { Count, FsPath, PackageName } from './Workspace.schema.js'

export interface CycleStore {
  readonly readCaptured: (
    path: FsPath,
  ) => Effect.Effect<ReadonlyArray<CycleEntry>, PlanRefusal, never>
  readonly writeCaptured: (
    path: FsPath,
    cycle: ReadonlyArray<CycleEntry>,
  ) => Effect.Effect<Count, PlanRefusal, never>
  readonly readDeferred: (
    source?: FsPath,
  ) => Effect.Effect<ReadonlyArray<PackageName>, PlanRefusal, never>
  readonly writeDeferred: (
    path: FsPath,
    deferred: ReadonlyArray<PackageName>,
  ) => Effect.Effect<Count, PlanRefusal, never>
}

export const CycleStore: Context.Service<CycleStore, CycleStore> = Context
  .Service<CycleStore, CycleStore>('CycleStore')
