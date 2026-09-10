import { join } from '@std/path'
import {
  type ChangelogFile,
  type ChangelogRefusal,
  ChangelogStore,
  type MemberChangelogEntry,
  RelativePath,
  type RepoRoot,
  type RootChangelogAppend,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as S from 'effect/Schema'

const CHANGELOG_SEED = '# Changelog\n'

export const ChangelogStoreLive = (root: RepoRoot): Layer.Layer<ChangelogStore> => {
  const readRootChangelog = (path: RelativePath): Effect.Effect<ChangelogFile, ChangelogRefusal> =>
    Effect.gen(function*() {
      const text = yield* Effect.tryPromise({
        try: () => Deno.readTextFile(join(root, path)),
        catch: (): ChangelogRefusal => ({ _tag: 'ChangelogUnreadable', path }),
      })
      return { path, text }
    })

  const appendReleaseSummary = (append: RootChangelogAppend): Effect.Effect<ChangelogFile, ChangelogRefusal> =>
    Effect.gen(function*() {
      const full = join(root, append.path)
      const existing = yield* Effect.tryPromise({
        try: () => Deno.readTextFile(full),
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          error instanceof Deno.errors.NotFound
            ? Effect.succeed(CHANGELOG_SEED)
            : Effect.fail({ _tag: 'ChangelogUnreadable', path: append.path } as const)
        ),
      )
      const text = `${existing.trimEnd()}\n\n## ${append.version}\n\n${append.summary}\n`
      yield* Effect.tryPromise({
        try: () => Deno.writeTextFile(full, text),
        catch: (error): ChangelogRefusal => ({
          _tag: 'ChangelogUnwritable',
          path: append.path,
          reason: String(error),
        }),
      })
      return { path: append.path, text }
    })

  const writeMemberChangelog = (entry: MemberChangelogEntry): Effect.Effect<ChangelogFile, ChangelogRefusal> =>
    Effect.gen(function*() {
      const rel = yield* S.decodeUnknownEffect(RelativePath)(
        `${entry.changelogDir}/${entry.name.replace('/', '!')}@${entry.version}.md`,
      ).pipe(Effect.orDie)
      const text = `# ${entry.name}@${entry.version}\n\n${entry.summary}\n`
      yield* Effect.tryPromise({
        try: () => Deno.writeTextFile(join(root, rel), text),
        catch: (error): ChangelogRefusal => ({
          _tag: 'ChangelogUnwritable',
          path: rel,
          reason: String(error),
        }),
      })
      return { path: rel, text }
    })

  return Layer.succeed(ChangelogStore)({ readRootChangelog, appendReleaseSummary, writeMemberChangelog })
}
