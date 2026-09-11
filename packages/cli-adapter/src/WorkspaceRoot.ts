import { RepoRoot } from '@systemfsoftware/release-language'
import { Effect, FileSystem, Option, Path } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import { WorkspaceRootNotAbsolute } from './WorkspaceRoot.schema.js'

export const resolveWorkspaceRoot = (
  flag: Option.Option<string>,
): Effect.Effect<RepoRoot, WorkspaceRootNotAbsolute, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const named = path.resolve(Option.getOrUndefined(flag) ?? process.cwd())
    const stat = yield* fs.stat(named).pipe(Effect.option)
    const root = Match.value(stat).pipe(
      Match.tag('None', () => path.dirname(named)),
      Match.tag('Some', (entry) =>
        Match.value(entry.value.type).pipe(
          Match.when('Directory', () => named),
          Match.orElse(() => path.dirname(named)),
        )),
      Match.exhaustive,
    )
    return yield* S.decodeUnknownEffect(RepoRoot)(root).pipe(
      Effect.mapError((): WorkspaceRootNotAbsolute => WorkspaceRootNotAbsolute.make({ given: root })),
    )
  })
