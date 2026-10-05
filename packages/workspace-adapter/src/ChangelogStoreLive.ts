import {
  type ChangelogFile,
  type ChangelogRefusal,
  ChangelogStore,
  ChangelogUnreadable,
  ChangelogUnwritable,
  type MemberChangelogEntry,
  RelativePath,
  type RepoRoot,
  type RootChangelogAppend,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import { overwriteTextFile, readTextFile } from './StoreFile.js'

const CHANGELOG_SEED = '# Changelog\n'

export const ChangelogStoreLive = (root: RepoRoot): Layer.Layer<ChangelogStore, never, FileSystem | Path> =>
  Layer.effect(
    ChangelogStore,
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path

      const readRootChangelog = (file: RelativePath): Effect.Effect<ChangelogFile, ChangelogRefusal> =>
        Effect.gen(function*() {
          const text = yield* readTextFile(fs, path.join(root, file)).pipe(
            Effect.mapError(() => ChangelogUnreadable.make({ path: file })),
          )
          return { path: file, text }
        })

      const appendReleaseSummary = (append: RootChangelogAppend): Effect.Effect<ChangelogFile, ChangelogRefusal> =>
        Effect.gen(function*() {
          const existing = yield* readTextFile(fs, path.join(root, append.path)).pipe(
            Effect.catchTag('Missing', () => Effect.succeed(CHANGELOG_SEED)),
            Effect.mapError(() => ChangelogUnreadable.make({ path: append.path })),
          )
          const text = `${existing.trimEnd()}\n\n## ${append.version}\n\n${append.summary}\n`
          yield* overwriteTextFile(fs, path.join(root, append.path), text).pipe(
            Effect.mapError((fault) => ChangelogUnwritable.make({ path: append.path, reason: fault.reason })),
          )
          return { path: append.path, text }
        })

      const writeMemberChangelog = (entry: MemberChangelogEntry): Effect.Effect<ChangelogFile, ChangelogRefusal> =>
        Effect.gen(function*() {
          const file = RelativePath.make(`${entry.changelogDir}/${entry.name.replace('/', '!')}@${entry.version}.md`)
          const text = `# ${entry.name}@${entry.version}\n\n${entry.summary}\n`
          yield* overwriteTextFile(fs, path.join(root, file), text).pipe(
            Effect.mapError((fault) => ChangelogUnwritable.make({ path: file, reason: fault.reason })),
          )
          return { path: file, text }
        })

      return { readRootChangelog, appendReleaseSummary, writeMemberChangelog }
    }),
  )
