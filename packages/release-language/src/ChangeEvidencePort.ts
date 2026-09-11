import { Context, type Effect } from 'effect'
import type { TaskName } from './Config.schema.js'
import type { ChangeEvidence, GateRefusal } from './Gate.schema.js'
import type { GitRef, RepoRoot } from './Workspace.schema.js'

export interface ChangeEvidencePort {
  readonly pathsEvidence: (
    root: RepoRoot,
    ref: GitRef,
  ) => Effect.Effect<ChangeEvidence, GateRefusal, never>
  readonly turboEvidence: (
    root: RepoRoot,
    ref: GitRef,
    task: TaskName,
  ) => Effect.Effect<ChangeEvidence, GateRefusal, never>
}

export const ChangeEvidencePort: Context.Service<
  ChangeEvidencePort,
  ChangeEvidencePort
> = Context.Service<ChangeEvidencePort, ChangeEvidencePort>(
  'ChangeEvidencePort',
)
