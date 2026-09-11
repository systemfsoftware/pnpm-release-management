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
import { FileSystem } from 'effect/FileSystem'
import * as Match from 'effect/Match'
import { Path } from 'effect/Path'
import * as S from 'effect/Schema'

const CHANGELOG_SEED = '# Changelog\n'

export const ChangelogStoreLive = (root: RepoRoot): Layer.Layer<ChangelogStore, never, FileSystem | Path> =>
  Layer.effect(
    ChangelogStore,
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path

      const readRootChangelog = (changelogPath: RelativePath): Effect.Effect<ChangelogFile, ChangelogRefusal> =>
        Effect.gen(function*() {
          const text = yield* fs.readFileString(path.join(root, changelogPath)).pipe(
            Effect.catchTag(
              'PlatformError',
              (): Effect.Effect<never, ChangelogRefusal> =>
                Effect.fail({ _tag: 'ChangelogUnreadable', path: changelogPath } as const),
            ),
          )
          return { path: changelogPath, text }
        })

      const appendReleaseSummary = (
        append: RootChangelogAppend,
      ): Effect.Effect<ChangelogFile, ChangelogRefusal> =>
        Effect.gen(function*() {
          const full = path.join(root, append.path)
          const existing = yield* fs.readFileString(full).pipe(
            Effect.catchTag('PlatformError', (error) =>
              Match.value(error.reason).pipe(
                Match.tag('NotFound', () => Effect.succeed(CHANGELOG_SEED)),
                Match.orElse(() => Effect.fail({ _tag: 'ChangelogUnreadable', path: append.path } as const)),
              )),
          )
          const text = `${existing.trimEnd()}\n\n## ${append.version}\n\n${append.summary}\n`
          yield* fs.writeFileString(full, text).pipe(
            Effect.catchTag(
              'PlatformError',
              (error): Effect.Effect<never, ChangelogRefusal> =>
                Effect.fail({ _tag: 'ChangelogUnwritable', path: append.path, reason: error.message } as const),
            ),
          )
          return { path: append.path, text }
        })

      const writeMemberChangelog = (
        entry: MemberChangelogEntry,
      ): Effect.Effect<ChangelogFile, ChangelogRefusal> =>
        Effect.gen(function*() {
          const rel = yield* S.decodeUnknownEffect(RelativePath)(
            `${entry.changelogDir}/${entry.name.replace('/', '!')}@${entry.version}.md`,
          ).pipe(Effect.orDie)
          const text = `# ${entry.name}@${entry.version}\n\n${entry.summary}\n`
          yield* fs.writeFileString(path.join(root, rel), text).pipe(
            Effect.catchTag(
              'PlatformError',
              (error): Effect.Effect<never, ChangelogRefusal> =>
                Effect.fail({ _tag: 'ChangelogUnwritable', path: rel, reason: error.message } as const),
            ),
          )
          return { path: rel, text }
        })

      return { readRootChangelog, appendReleaseSummary, writeMemberChangelog }
    }),
  )
