import { Context, type Effect } from 'effect'
import type { EvidenceRefusal, ReleaseCandidate, ReplayOutcome } from './Gate.schema.js'
import type { RepoRoot } from './Workspace.schema.js'

export interface ReleaseReplayPort {
  readonly replay: (
    root: RepoRoot,
    candidate: ReleaseCandidate,
  ) => Effect.Effect<ReplayOutcome, EvidenceRefusal>
}

export const ReleaseReplayPort: Context.Service<ReleaseReplayPort, ReleaseReplayPort> = Context.Service<
  ReleaseReplayPort,
  ReleaseReplayPort
>('ReleaseReplayPort')
