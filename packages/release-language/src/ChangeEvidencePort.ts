import { Context, Effect } from 'effect'
import { type Gate, TaskName } from './Config.schema.js'
import type { ChangeEvidence, ChangeEvidenceRefusal } from './Gate.schema.js'
import type { GitRef, RepoRoot } from './Workspace.schema.js'

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

export const taskOf = (gate: Gate): TaskName | undefined => {
  if (gate.strategy === 'turbo') return gate.task
  return undefined
}

export const evidenceOf = (
  root: RepoRoot,
  ref: GitRef,
  strategy: Gate['strategy'],
  task: TaskName | undefined,
): Effect.Effect<ChangeEvidence, ChangeEvidenceRefusal, ChangeEvidencePort> =>
  Effect.flatMap(ChangeEvidencePort, (port) => {
    if (strategy === 'turbo') {
      return port.turboEvidence(root, ref, task ?? TaskName.make('build'))
    }
    return port.pathsEvidence(root, ref)
  })
