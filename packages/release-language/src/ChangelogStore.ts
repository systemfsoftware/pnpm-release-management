import { Context, type Effect } from 'effect'
import type { ChangelogFile, ChangelogRefusal, MemberChangelogEntry, RootChangelogAppend } from './Version.schema.js'
import type { RelativePath } from './Workspace.schema.js'

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
