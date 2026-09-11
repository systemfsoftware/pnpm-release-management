import {
  type ChangelogFile,
  type ChangelogRefusal,
  ChangelogStore,
  type MemberChangelogEntry,
  RelativePath,
  type RootChangelogAppend,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as S from 'effect/Schema'

export type FakeChangelogState = {
  readonly rootChangelogs: Map<RelativePath, string>
  readonly memberChangelogs: Map<RelativePath, string>
}

const mustBrand = <C extends S.Constraint>(schema: C, input: unknown) =>
  S.decodeUnknownEffect(schema)(input).pipe(Effect.orDie)

export const makeFakeChangelogStore = (
  roots: ReadonlyMap<RelativePath, string> = new Map(),
): { readonly layer: Layer.Layer<ChangelogStore>; readonly state: FakeChangelogState } => {
  const rootChangelogs = new Map(roots)
  const memberChangelogs = new Map<RelativePath, string>()
  const layer = Layer.succeed(ChangelogStore, {
    readRootChangelog: (path: RelativePath) =>
      Effect.suspend(() => {
        const text = rootChangelogs.get(path)
        if (text === undefined) {
          return Effect.fail({ _tag: 'ChangelogUnreadable', path } as const)
        }
        return Effect.succeed({ path, text })
      }),
    appendReleaseSummary: (append: RootChangelogAppend) =>
      Effect.sync(() => {
        const existing = rootChangelogs.get(append.path) ?? '# Changelog\n'
        const text = `${existing.trimEnd()}\n\n## ${append.version}\n\n${append.summary}\n`
        rootChangelogs.set(append.path, text)
        const file: ChangelogFile = { path: append.path, text }
        return file
      }),
    writeMemberChangelog: (entry: MemberChangelogEntry) =>
      Effect.flatMap(
        mustBrand(RelativePath, `${entry.changelogDir}/${entry.name.replaceAll('/', '!')}@${entry.version}.md`),
        (path): Effect.Effect<ChangelogFile, ChangelogRefusal> => {
          const text = `# ${entry.name}@${entry.version}\n\n${entry.summary}\n`
          memberChangelogs.set(path, text)
          return Effect.succeed({ path, text })
        },
      ),
  })
  return { layer, state: { rootChangelogs, memberChangelogs } }
}
