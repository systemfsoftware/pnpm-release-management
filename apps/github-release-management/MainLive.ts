import { parse as parseJsonc } from '@std/jsonc'
import { join } from '@std/path'
import { GitLive } from '@systemfsoftware/git-adapter'
import { ForgeConfig, ForgeLive } from '@systemfsoftware/github-adapter'
import { ProcessLive } from '@systemfsoftware/process-adapter'
import type {
  ChangelogStore,
  ChangesetStore,
  CycleStore,
  ForgePort,
  GitPort,
  ProcessPort,
  ReleaseConfigStore,
  SurfaceStore,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { RelativePath, RepoRoot } from '@systemfsoftware/release-language'
import {
  ChangelogStoreLive,
  ChangesetStoreLive,
  CycleStoreLive,
  ReleaseConfigStoreLive,
  SurfaceStoreLive,
  WorkspaceStoreLive,
} from '@systemfsoftware/workspace-adapter'
import { Effect, Layer } from 'effect'
import * as S from 'effect/Schema'

const Wiring = S.Struct({ changesetDir: RelativePath })

const FALLBACK_CHANGESET_DIR = '.changeset'

const wired = Effect.gen(function*() {
  const root = yield* S.decodeUnknownEffect(RepoRoot)(Deno.cwd()).pipe(Effect.orDie)
  const text = yield* Effect.promise(() => Deno.readTextFile(join(root, 'release.jsonc')).catch(() => null))
  if (text === null) {
    const changesetDir = yield* S.decodeUnknownEffect(RelativePath)(FALLBACK_CHANGESET_DIR).pipe(
      Effect.orDie,
    )
    return { root, changesetDir }
  }
  const decoded = yield* S.decodeUnknownEffect(Wiring)(parseJsonc(text)).pipe(Effect.orDie)
  return { root, changesetDir: decoded.changesetDir }
})

export const MainLive: Layer.Layer<
  | ChangesetStore
  | ChangelogStore
  | CycleStore
  | ForgePort
  | GitPort
  | ProcessPort
  | ReleaseConfigStore
  | SurfaceStore
  | WorkspaceStore
> = Layer.unwrap(
  Effect.map(wired, ({ root, changesetDir }) => {
    const forge = Layer.provide(
      ForgeLive,
      Layer.succeed(ForgeConfig, {
        token: Deno.env.get('GITHUB_TOKEN'),
        baseUrl: Deno.env.get('GITHUB_API_URL'),
      }),
    )
    return Layer.mergeAll(
      forge,
      GitLive,
      ProcessLive,
      CycleStoreLive,
      ReleaseConfigStoreLive,
      WorkspaceStoreLive(root),
      ChangesetStoreLive({ root, changesetDir }),
      SurfaceStoreLive(root),
      ChangelogStoreLive(root),
    )
  }),
)
