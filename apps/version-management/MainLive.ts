import { ProcessLive } from '@systemfsoftware/process-adapter'
import {
  ChangelogStore,
  ChangesetStore,
  RelativePath,
  ReleaseConfigStore,
  RepoRoot,
  SurfaceStore,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import {
  ChangelogStoreLive,
  ChangesetStoreLive,
  CycleStoreLive,
  ReleaseConfigStoreLive,
  SurfaceStoreLive,
  WorkspaceStoreLive,
} from '@systemfsoftware/workspace-adapter'
import { Context, Effect, Layer } from 'effect'
import * as S from 'effect/Schema'

const boundaryRoot: Effect.Effect<RepoRoot> = Effect.flatMap(
  Effect.sync(() => Deno.cwd()),
  (cwd) => S.decodeUnknownEffect(RepoRoot)(cwd),
).pipe(Effect.orDie)

const fallbackChangesetDir: Effect.Effect<RelativePath> = S.decodeUnknownEffect(RelativePath)(
  '.changeset',
).pipe(Effect.orDie)

const WorkspaceStoreResolved: Layer.Layer<WorkspaceStore> = Layer.effect(
  WorkspaceStore,
  Effect.gen(function*() {
    const root = yield* boundaryRoot
    const context = yield* Layer.build(WorkspaceStoreLive(root))
    return Context.get(context, WorkspaceStore)
  }),
)

const SurfaceStoreResolved: Layer.Layer<SurfaceStore, never, WorkspaceStore> = Layer.effect(
  SurfaceStore,
  Effect.gen(function*() {
    const workspace = yield* WorkspaceStore
    const context = yield* Layer.build(SurfaceStoreLive(workspace.root))
    return Context.get(context, SurfaceStore)
  }),
)

const ChangelogStoreResolved: Layer.Layer<ChangelogStore, never, WorkspaceStore> = Layer.effect(
  ChangelogStore,
  Effect.gen(function*() {
    const workspace = yield* WorkspaceStore
    const context = yield* Layer.build(ChangelogStoreLive(workspace.root))
    return Context.get(context, ChangelogStore)
  }),
)

const ChangesetStoreResolved: Layer.Layer<
  ChangesetStore,
  never,
  WorkspaceStore | ReleaseConfigStore
> = Layer.effect(
  ChangesetStore,
  Effect.gen(function*() {
    const workspace = yield* WorkspaceStore
    const configs = yield* ReleaseConfigStore
    const changesetDir = yield* Effect.catch(
      Effect.map(configs.loadConfig(workspace.root), (config) => config.changesetDir),
      () => fallbackChangesetDir,
    )
    const context = yield* Layer.build(
      ChangesetStoreLive({ root: workspace.root, changesetDir }),
    )
    return Context.get(context, ChangesetStore)
  }),
)

export const MainLive = Layer.mergeAll(
  WorkspaceStoreResolved,
  ReleaseConfigStoreLive,
  CycleStoreLive,
  ProcessLive,
  Layer.provide(SurfaceStoreResolved, WorkspaceStoreResolved),
  Layer.provide(ChangelogStoreResolved, WorkspaceStoreResolved),
  Layer.provide(
    ChangesetStoreResolved,
    Layer.mergeAll(WorkspaceStoreResolved, ReleaseConfigStoreLive),
  ),
)
