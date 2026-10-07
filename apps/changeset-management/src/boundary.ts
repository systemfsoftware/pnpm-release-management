import { LedgerLive } from '@systemfsoftware/adoption-adapter'
import { resolveWorkspaceRoot } from '@systemfsoftware/cli-adapter'
import {
  type Gate,
  GitRef,
  type ReleaseConfig,
  ReleaseConfigStore,
  type RepoRoot,
  type TaskName,
} from '@systemfsoftware/release-language'
import { ChangesetStoreLive, WorkspaceStoreLive } from '@systemfsoftware/workspace-adapter'
import { Effect, Layer, Option } from 'effect'
import * as S from 'effect/Schema'
import type { BaseRefInvalid, BaseRefMissing } from './boundary.schema.js'

export interface Workspace {
  readonly root: RepoRoot
  readonly release: ReleaseConfig
}

export const workspaceOf = (config: Option.Option<string>) =>
  Effect.gen(function*() {
    const root = yield* resolveWorkspaceRoot(config)
    const store = yield* ReleaseConfigStore
    const release = yield* store.loadConfig(root)
    return { root, release }
  })

export const storesOf = (workspace: Workspace) =>
  Layer.mergeAll(
    WorkspaceStoreLive(workspace.root),
    ChangesetStoreLive({ root: workspace.root, changesetDir: workspace.release.changesetDir }),
    LedgerLive(workspace.root),
  )

export const taskOf = (gate: Gate): TaskName | undefined => {
  if (gate.strategy === 'turbo') return gate.task
  return undefined
}

export const baseRefOf = (
  positional: Option.Option<string>,
  flag: Option.Option<string>,
): Effect.Effect<GitRef, BaseRefMissing | BaseRefInvalid> =>
  Option.match(Option.orElse(positional, () => flag), {
    onNone: () => Effect.fail<BaseRefMissing>({ _tag: 'BaseRefMissing' }),
    onSome: (given) =>
      S.decodeUnknownEffect(GitRef)(given).pipe(
        Effect.mapError((): BaseRefInvalid => ({ _tag: 'BaseRefInvalid', given })),
      ),
  })
