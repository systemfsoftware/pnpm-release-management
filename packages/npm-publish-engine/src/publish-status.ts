import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import * as Lang from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import {
  publishStatus,
  type PublishStatusWorkflowDecision,
  type PublishStatusWorkflowRefusal,
  type ScoredEvaluation,
  StatusCommand,
} from './publish-status.workflow.js'
import { StatusMode, type StatusReport, type StatusRow } from './status.schema.js'

export const StatusRequest = Wire.wire({
  mode: Wire.mint(StatusMode),
})
export type StatusRequest = S.Schema.Type<typeof StatusRequest>

interface StatusItem {
  readonly member: Lang.Member
  readonly manifest: Lang.PackageManifest
  readonly snapshot: Lang.TrustSnapshot
}

interface StatusRead {
  readonly request: StatusRequest
  readonly items: ReadonlyArray<StatusItem>
}

const read = (
  request: StatusRequest,
): Effect.Effect<
  StatusRead,
  Lang.MemberRefusal | Lang.TrustRefusal,
  Lang.WorkspaceStore | Lang.RegistryPort
> =>
  Effect.gen(function*() {
    const workspace = yield* Lang.WorkspaceStore
    const registry = yield* Lang.RegistryPort
    const members = yield* workspace.listMembers()
    const items = yield* Effect.forEach(members, (member) =>
      Effect.gen(function*() {
        const manifest = yield* workspace.readManifest(member.dir)
        const snapshot = yield* registry.queryPackage(member.name)
        return { member, manifest, snapshot }
      }))
    return { request, items }
  })

const decode = (raw: StatusRead): Result.Result<StatusCommand, never> =>
  Result.succeed(
    new StatusCommand({
      mode: raw.request.mode,
      evaluations: raw.items.map((item) => ({
        name: item.member.name,
        localVersion: item.manifest.version,
        npmLatest: item.snapshot.latest,
        attested: item.snapshot.attested,
        reachable: item.snapshot.reachable,
        provenanceConfig: item.manifest.publishConfig?.provenance === true,
      })),
    }),
  )

const yesNoOf = (value: boolean): 'yes' | 'no' =>
  Match.value(value).pipe(
    Match.when(true, (): 'yes' | 'no' => 'yes'),
    Match.when(false, (): 'yes' | 'no' => 'no'),
    Match.exhaustive,
  )

const rowOf = (evaluation: ScoredEvaluation): StatusRow => ({
  name: evaluation.name,
  local_version: evaluation.localVersion,
  npm_latest: Match.value(evaluation.class).pipe(
    Match.when('unpublished', (): string => '—'),
    Match.when('error', (): string => '?'),
    Match.orElse(() => evaluation.npmLatest ?? '?'),
  ),
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

const nonEmptyOf = <A>(values: ReadonlyArray<A>): readonly [A, ...Array<A>] =>
  Option.getOrThrow(
    Option.map(
      Option.fromNullishOr(values[0]),
      (head): readonly [A, ...Array<A>] => [head, ...values.slice(1)],
    ),
  )

const refusalOf = (refusal: PublishStatusWorkflowRefusal): Lang.PublishStatusRefusal =>
  Match.value(refusal).pipe(
    Match.tag(
      'PublishStatusEmpty',
      (empty) => Lang.PublishStatusEmpty.make({ members: Lang.Count.make(empty.members) }),
    ),
    Match.tag(
      'PublishStatusUnreadable',
      (unreadable) => Lang.PublishStatusUnreadable.make({ packages: nonEmptyOf(unreadable.packages) }),
    ),
    Match.tag(
      'PublishStatusUnpublished',
      (unpublished) => Lang.PublishStatusUnpublished.make({ packages: nonEmptyOf(unpublished.packages) }),
    ),
    Match.tag(
      'PublishStatusUnattested',
      (unattested) => Lang.PublishStatusUnattested.make({ packages: nonEmptyOf(unattested.packages) }),
    ),
    Match.exhaustive,
  )

const reportOf = (decision: PublishStatusWorkflowDecision): StatusReport =>
  Match.value(decision).pipe(
    Match.tag('PublishStatusHealthy', (healthy): StatusReport => ({
      decision: Lang.PublishStatusHealthy.make({ packages: Lang.Count.make(healthy.packages) }),
      rows: healthy.evaluations.map((evaluation) => rowOf(evaluation)),
      deferred: [...deferredOf(healthy.evaluations)],
    })),
    Match.tag('PublishStatusOwed', (owed): StatusReport => ({
      decision: Lang.PublishStatusOwed.make({
        unpublished: Lang.Count.make(owed.unpublished),
        untrusted: Lang.Count.make(owed.untrusted),
        stuck: Lang.Count.make(owed.stuck),
      }),
      rows: owed.evaluations.map((evaluation) => rowOf(evaluation)),
      deferred: [...deferredOf(owed.evaluations)],
    })),
    Match.exhaustive,
  )

const encode = (
  outcome: Result.Result<PublishStatusWorkflowDecision, PublishStatusWorkflowRefusal>,
): Result.Result<StatusReport, Lang.PublishStatusRefusal> =>
  outcome.pipe(
    Result.mapError((refusal) => refusalOf(refusal)),
    Result.map((decision) => reportOf(decision)),
  )

const write = (
  output: Result.Result<StatusReport, Lang.PublishStatusRefusal>,
  _raw: StatusRead,
): Effect.Effect<StatusReport, Lang.PublishStatusRefusal, never> => Effect.fromResult(output)

export const publishStatusCell: Cell.Cell<
  StatusRequest,
  StatusReport,
  Lang.MemberRefusal | Lang.TrustRefusal | Lang.PublishStatusRefusal,
  Lang.WorkspaceStore | Lang.RegistryPort
> = Cell.layer({
  read,
  decode,
  decide: publishStatus,
  encode,
  write,
})
