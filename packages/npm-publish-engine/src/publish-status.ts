import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import * as Lang from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import {
  publishStatus,
  type PublishStatusWorkflowDecision,
  type ScoredEvaluation,
  StatusCommand,
  StatusMode,
} from './publish-status.workflow.js'
import { type PublishStatusRefusal, type StatusReport, type StatusRow } from './status.schema.js'

export const StatusRequest = Wire.wire({
  mode: Wire.mint(StatusMode),
})
export type StatusRequest = S.Schema.Type<typeof StatusRequest>

const read = (
  request: StatusRequest,
): Effect.Effect<
  StatusCommand,
  Lang.MemberRefusal | Lang.TrustRefusal,
  Lang.WorkspaceStore | Lang.RegistryPort
> =>
  Effect.gen(function*() {
    const workspace = yield* Lang.WorkspaceStore
    const registry = yield* Lang.RegistryPort
    const members = yield* workspace.listMembers()
    const evaluations = yield* Effect.forEach(members, (member) =>
      Effect.gen(function*() {
        const manifest = yield* workspace.readManifest(member.dir)
        const snapshot = yield* registry.queryPackage(member.name)
        return {
          name: member.name,
          localVersion: manifest.version,
          npmLatest: snapshot.latest,
          attested: snapshot.attested,
          reachable: snapshot.reachable,
          provenanceConfig: manifest.publishConfig?.provenance === true,
        }
      }))
    return new StatusCommand({ mode: request.mode, evaluations })
  })

const yesNoOf = (value: boolean): 'yes' | 'no' => {
  if (value) return 'yes'
  return 'no'
}

const npmLatestOf = (evaluation: ScoredEvaluation): string => {
  if (evaluation.class === 'unpublished') return '—'
  if (evaluation.class === 'error') return '?'
  return evaluation.npmLatest ?? '?'
}

const rowOf = (evaluation: ScoredEvaluation): StatusRow => ({
  name: evaluation.name,
  local_version: evaluation.localVersion,
  npm_latest: npmLatestOf(evaluation),
  class: evaluation.class,
  attested: yesNoOf(evaluation.attested),
  publishConfig_provenance: yesNoOf(evaluation.provenanceConfig),
})

const deferredOf = (
  evaluations: ReadonlyArray<ScoredEvaluation>,
): ReadonlyArray<Lang.PackageName> =>
  evaluations
    .filter((evaluation) => evaluation.class === 'unpublished')
    .map((evaluation) => evaluation.name)
    .sort()

const reportOf = (decision: PublishStatusWorkflowDecision): StatusReport => ({
  decision,
  rows: decision.evaluations.map(rowOf),
  deferred: deferredOf(decision.evaluations),
})

const write = (
  outcome: Result.Result<PublishStatusWorkflowDecision, PublishStatusRefusal>,
): Effect.Effect<StatusReport, PublishStatusRefusal> => Effect.fromResult(Result.map(outcome, reportOf))

export const publishStatusCell: Cell.Cell<
  StatusRequest,
  StatusReport,
  Lang.MemberRefusal | Lang.TrustRefusal | PublishStatusRefusal,
  Lang.WorkspaceStore | Lang.RegistryPort
> = Cell.layer({
  read,
  decide: publishStatus,
  write,
})
