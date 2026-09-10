import { Context, type Effect } from 'effect'
import type { ChangelogFile, ChangelogRefusal, MemberChangelogEntry, RootChangelogAppend } from './Version.schema.ts'
import type { RelativePath } from './Workspace.schema.ts'

export interface ChangelogStore {
  readonly readRootChangelog: (
    path: RelativePath,
  ) => Effect.Effect<ChangelogFile, ChangelogRefusal, never>
  readonly appendReleaseSummary: (
    append: RootChangelogAppend,
  ) => Effect.Effect<ChangelogFile, ChangelogRefusal, never>
  readonly writeMemberChangelog: (
    entry: MemberChangelogEntry,
  ) => Effect.Effect<ChangelogFile, ChangelogRefusal, never>
}

export const ChangelogStore: Context.Service<ChangelogStore, ChangelogStore> = Context.Service<
  ChangelogStore,
  ChangelogStore
>('ChangelogStore')
