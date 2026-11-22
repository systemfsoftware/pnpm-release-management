import { Context, type Effect } from 'effect'
import type { TaskName } from './Config.schema.js'
import type {
  ChangeRange,
  EvidenceRefusal,
  PathChange,
  RangeCommit,
  TurboComparison,
  WorkspaceMembers,
} from './Gate.schema.js'
import type { CommitSha } from './Tag.schema.js'
import type { GitRef, RelativePath, RepoRoot } from './Workspace.schema.js'

export type ChangeEvidenceRefusal = EvidenceRefusal

export interface ChangeEvidencePort {
  readonly range: (root: RepoRoot, base: GitRef) => Effect.Effect<ChangeRange, ChangeEvidenceRefusal>
  readonly refuseUnderTurbo: (root: RepoRoot, range: ChangeRange) => Effect.Effect<void, ChangeEvidenceRefusal>
  readonly commits: (root: RepoRoot, range: ChangeRange) => Effect.Effect<
    ReadonlyArray<RangeCommit>,
    ChangeEvidenceRefusal
  >
  readonly changes: (
    root: RepoRoot,
    from: CommitSha,
    to: CommitSha,
  ) => Effect.Effect<ReadonlyArray<PathChange>, ChangeEvidenceRefusal>
  readonly filesIn: (
    root: RepoRoot,
    rev: CommitSha,
    dir: RelativePath,
  ) => Effect.Effect<ReadonlyArray<RelativePath>, ChangeEvidenceRefusal>
  readonly fileAt: (
    root: RepoRoot,
    rev: CommitSha,
    path: RelativePath,
  ) => Effect.Effect<string | undefined, ChangeEvidenceRefusal>
  readonly members: (root: RepoRoot, range: ChangeRange) => Effect.Effect<WorkspaceMembers, ChangeEvidenceRefusal>
  readonly turbo: (
    root: RepoRoot,
    range: ChangeRange,
    task: TaskName,
  ) => Effect.Effect<TurboComparison, ChangeEvidenceRefusal>
}

export const ChangeEvidencePort: Context.Service<
  ChangeEvidencePort,
  ChangeEvidencePort
> = Context.Service<ChangeEvidencePort, ChangeEvidencePort>(
  'ChangeEvidencePort',
)
