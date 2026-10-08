import {
  type ChangelogFile,
  type ChangelogRefusal,
  ChangelogStore,
  ChangelogUnreadable,
  ChangelogUnwritable,
  type MemberChangelogEntry,
  parkedChangelogOf,
  type RelativePath,
  type RepoRoot,
  type RootChangelogAppend,
  withVersionSection,
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

      const memberChangelogTextOf = (entry: MemberChangelogEntry): Effect.Effect<string, ChangelogRefusal> => {
        if (entry.storage === 'registry') {
          return Effect.succeed(parkedChangelogOf(entry.name, entry.version, entry.summary))
        }
        return readTextFile(fs, path.join(root, entry.path)).pipe(
          Effect.map((existing): string | undefined => existing),
          Effect.catchTag('Missing', () => Effect.succeed(undefined)),
          Effect.mapError(() => ChangelogUnreadable.make({ path: entry.path })),
          Effect.map((existing) => withVersionSection(existing, entry.name, entry.version, entry.summary)),
        )
      }

      const writeMemberChangelog = (entry: MemberChangelogEntry): Effect.Effect<ChangelogFile, ChangelogRefusal> =>
        Effect.gen(function*() {
          const text = yield* memberChangelogTextOf(entry)
          yield* overwriteTextFile(fs, path.join(root, entry.path), text).pipe(
            Effect.mapError((fault) => ChangelogUnwritable.make({ path: entry.path, reason: fault.reason })),
          )
          return { path: entry.path, text }
        })

      return { readRootChangelog, appendReleaseSummary, writeMemberChangelog }
    }),
  )
