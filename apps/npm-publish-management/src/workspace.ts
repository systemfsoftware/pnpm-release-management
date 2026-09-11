import { resolveWorkspaceRoot, type WorkspaceRootNotAbsolute } from '@systemfsoftware/cli-adapter'
import {
  type ConfigRefusal,
  GitPort,
  OwnerName,
  type ReleaseConfig,
  ReleaseConfigStore,
  RepoName,
  type RepoRoot,
  type RepoSlug,
} from '@systemfsoftware/release-language'
import { Effect, FileSystem, Option, Path } from 'effect'

export const UNKNOWN_SLUG: RepoSlug = {
  owner: OwnerName.make('unknown'),
  repo: RepoName.make('unknown'),
}

export const slugText = (slug: RepoSlug): string => `${slug.owner}/${slug.repo}`

export const originSlug = (): Effect.Effect<RepoSlug, never, GitPort> =>
  Effect.flatMap(GitPort, (git) => git.repoSlug().pipe(Effect.orElseSucceed(() => UNKNOWN_SLUG)))

export interface Workspace {
  readonly root: RepoRoot
  readonly release: ReleaseConfig
  readonly registry: string
}

export const workspaceOf = (
  config: Option.Option<string>,
  registry: Option.Option<string>,
): Effect.Effect<
  Workspace,
  ConfigRefusal | WorkspaceRootNotAbsolute,
  ReleaseConfigStore | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const root = yield* resolveWorkspaceRoot(config)
    const store = yield* ReleaseConfigStore
    const release = yield* store.loadConfig(root)
    return { root, release, registry: Option.getOrUndefined(registry) ?? release.registry }
  })
