import { Context, type Effect } from 'effect'
import type { TaskName } from './Config.schema.js'
import type { ChangeEvidence, EvidenceRefusal, GateRefusal } from './Gate.schema.js'
import type { GitRef, RepoRoot } from './Workspace.schema.js'

export type ChangeEvidenceRefusal = GateRefusal | EvidenceRefusal

export interface ChangeEvidencePort {
  readonly pathsEvidence: (
    root: RepoRoot,
    ref: GitRef,
  ) => Effect.Effect<ChangeEvidence, ChangeEvidenceRefusal, never>
  readonly turboEvidence: (
    root: RepoRoot,
    ref: GitRef,
    task: TaskName,
  ) => Effect.Effect<ChangeEvidence, ChangeEvidenceRefusal, never>
}

export const ChangeEvidencePort: Context.Service<
  ChangeEvidencePort,
  ChangeEvidencePort
> = Context.Service<ChangeEvidencePort, ChangeEvidencePort>(
  'ChangeEvidencePort',
)
