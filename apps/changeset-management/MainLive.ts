import { Cell } from '@systemfsoftware/effect-cell-types'
import { GitLive } from '@systemfsoftware/git-adapter'
import { ChangeEvidenceLive } from '@systemfsoftware/process-adapter'
import type { ChangesetStore, RelativePath, RepoRoot, WorkspaceStore } from '@systemfsoftware/release-language'
import { ChangesetStoreLive, ReleaseConfigStoreLive, WorkspaceStoreLive } from '@systemfsoftware/workspace-adapter'
import { Layer } from 'effect'

export const MainLive = Layer.mergeAll(
  ReleaseConfigStoreLive,
  Layer.provide(ChangeEvidenceLive, GitLive),
)

export interface StoreOptions {
  readonly root: RepoRoot
  readonly changesetDir: RelativePath
}

export const provideStores = <I, A, E, R>(
  cell: Cell.Cell<I, A, E, R>,
  options: StoreOptions,
): Cell.Cell<I, A, E, Exclude<R, WorkspaceStore | ChangesetStore>> =>
  Cell.provide(
    cell,
    Layer.mergeAll(
      WorkspaceStoreLive(options.root),
      ChangesetStoreLive({ root: options.root, changesetDir: options.changesetDir }),
    ),
  )
