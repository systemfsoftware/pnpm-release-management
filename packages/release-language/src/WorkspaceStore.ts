import { Context, type Effect } from 'effect'
import type {
  ChangelogStorage,
  Member,
  MemberRefusal,
  PackageManifest,
  RelativePath,
  RepoRoot,
  RootFile,
} from './Workspace.schema.js'

export interface WorkspaceStore {
  readonly root: RepoRoot
  readonly listMembers: () => Effect.Effect<
    ReadonlyArray<Member>,
    MemberRefusal,
    never
  >
  readonly readManifest: (
    dir: RelativePath,
  ) => Effect.Effect<PackageManifest, MemberRefusal, never>
  readonly readFileFromRoot: (
    path: RelativePath,
  ) => Effect.Effect<RootFile, MemberRefusal, never>
  readonly changelogStorage: () => Effect.Effect<ChangelogStorage, MemberRefusal, never>
}

export const WorkspaceStore: Context.Service<WorkspaceStore, WorkspaceStore> = Context.Service<
  WorkspaceStore,
  WorkspaceStore
>('WorkspaceStore')
