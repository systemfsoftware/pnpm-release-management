import { RepoRoot } from '@systemfsoftware/release-language'
import { Effect, FileSystem, Option, Path } from 'effect'
import * as S from 'effect/Schema'
import { WorkspaceRootNotAbsolute } from './WorkspaceRoot.schema.js'

const decodeRoot = (candidate: string): Effect.Effect<RepoRoot, WorkspaceRootNotAbsolute> =>
  S.decodeUnknownEffect(RepoRoot)(candidate).pipe(
    Effect.mapError((): WorkspaceRootNotAbsolute => WorkspaceRootNotAbsolute.make({ given: candidate })),
  )

export const resolveWorkspaceRoot = (
  flag: Option.Option<string>,
): Effect.Effect<RepoRoot, WorkspaceRootNotAbsolute, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const named = path.resolve(Option.getOrUndefined(flag) ?? process.cwd())
    const entry = yield* fs.stat(named).pipe(Effect.option)
    if (Option.isSome(entry) && entry.value.type === 'Directory') {
      return yield* decodeRoot(named)
    }
    return yield* decodeRoot(path.dirname(named))
  })
