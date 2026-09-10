import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import * as Lang from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import {
  publishStatus,
  type PublishStatusWorkflowDecision,
  type PublishStatusWorkflowRefusal,
  type ScoredEvaluation,
  StatusCommand,
} from './publish-status.workflow.ts'
import { StatusMode, type StatusReport, type StatusRow } from './status.schema.ts'

export const StatusRequest = Wire.wire({
  mode: Wire.mint(StatusMode),
})
export type StatusRequest = S.Schema.Type<typeof StatusRequest>

interface StatusItem {
  readonly member: Lang.Member
  readonly manifest: Lang.PackageManifest
  readonly snapshot: Lang.TrustSnapshot
}

class StatusRaw {
  constructor(
    readonly request: StatusRequest,
    readonly items: ReadonlyArray<StatusItem>,
  ) {}
}

type StatusPlan =
  | {
    readonly _tag: 'Report'
    readonly healthy: boolean
    readonly unpublished: number
    readonly untrusted: number
    readonly stuck: number
    readonly total: number
    readonly evaluations: ReadonlyArray<ScoredEvaluation>
  }
  | { readonly _tag: 'RefusedUnpublished'; readonly packages: ReadonlyArray<Lang.PackageName> }
  | { readonly _tag: 'RefusedUnattested'; readonly packages: ReadonlyArray<Lang.PackageName> }
  | { readonly _tag: 'RefusedUnreadable'; readonly packages: ReadonlyArray<Lang.PackageName> }
  | { readonly _tag: 'Vacant' }

const read = (
  request: StatusRequest,
): Effect.Effect<StatusRaw, Lang.MemberRefusal | Lang.TrustRefusal, Lang.WorkspaceStore | Lang.RegistryPort> =>
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
    return new StatusRaw(request, items)
  })

const decode = (raw: StatusRaw): Result.Result<StatusCommand, never> =>
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

const encode = (
  outcome: Result.Result<PublishStatusWorkflowDecision, PublishStatusWorkflowRefusal>,
): StatusPlan => {
  if (Result.isFailure(outcome)) {
    const refusal = outcome.failure
    if (refusal._tag === 'PublishStatusUnpublished') {
      return { _tag: 'RefusedUnpublished', packages: [...refusal.packages] }
    }
    if (refusal._tag === 'PublishStatusUnattested') {
      return { _tag: 'RefusedUnattested', packages: [...refusal.packages] }
    }
    if (refusal._tag === 'PublishStatusUnreadable') {
      return { _tag: 'RefusedUnreadable', packages: [...refusal.packages] }
    }
    return { _tag: 'Vacant' }
  }
  const decision = outcome.success
  if (decision._tag === 'PublishStatusHealthy') {
    return {
      _tag: 'Report',
      healthy: true,
      unpublished: 0,
      untrusted: 0,
      stuck: 0,
      total: decision.packages,
      evaluations: [...decision.evaluations],
    }
  }
  return {
    _tag: 'Report',
    healthy: false,
    unpublished: decision.unpublished,
    untrusted: decision.untrusted,
    stuck: decision.stuck,
    total: decision.evaluations.length,
    evaluations: [...decision.evaluations],
  }
}

const refusedOf = (
  packages: ReadonlyArray<Lang.PackageName>,
  kind: 'unpublished' | 'unattested' | 'unreadable',
): Effect.Effect<Lang.PublishStatusRefusal, never, never> =>
  Match.value(kind).pipe(
    Match.when('unpublished', () =>
      S.decodeUnknownEffect(Lang.PublishStatusUnpublished)({
        _tag: 'PublishStatusUnpublished',
        packages: [...packages],
      }).pipe(Effect.orDie)),
    Match.when('unattested', () =>
      S.decodeUnknownEffect(Lang.PublishStatusUnattested)({
        _tag: 'PublishStatusUnattested',
        packages: [...packages],
      }).pipe(Effect.orDie)),
    Match.when('unreadable', () =>
      S.decodeUnknownEffect(Lang.PublishStatusUnreadable)({
        _tag: 'PublishStatusUnreadable',
        packages: [...packages],
      }).pipe(Effect.orDie)),
    Match.exhaustive,
  )

const write = (
  plan: StatusPlan,
  _raw: StatusRaw,
): Effect.Effect<StatusReport, Lang.PublishStatusRefusal, never> =>
  Match.value(plan).pipe(
    Match.tag('Vacant', () =>
      Effect.flatMap(
        S.decodeEffect(Lang.PublishStatusEmpty)({ _tag: 'PublishStatusEmpty', members: 0 }).pipe(
          Effect.orDie,
        ),
        (empty): Effect.Effect<StatusReport, Lang.PublishStatusRefusal, never> => Effect.fail(empty),
      )),
    Match.tag('RefusedUnpublished', (refused) =>
      Effect.flatMap(
        refusedOf(refused.packages, 'unpublished'),
        (refusal) => Effect.fail(refusal),
      )),
    Match.tag('RefusedUnattested', (refused) =>
      Effect.flatMap(
        refusedOf(refused.packages, 'unattested'),
        (refusal) => Effect.fail(refusal),
      )),
    Match.tag('RefusedUnreadable', (refused) =>
      Effect.flatMap(
        refusedOf(refused.packages, 'unreadable'),
        (refusal) => Effect.fail(refusal),
      )),
    Match.tag('Report', (report) =>
      Effect.gen(function*() {
        const rows = report.evaluations.map((evaluation): StatusRow => {
          let latest = evaluation.npmLatest ?? '?'
          if (evaluation.class === 'unpublished') {
            latest = '—'
          } else if (evaluation.class === 'error') {
            latest = '?'
          }
          let attested: 'yes' | 'no' = 'no'
          if (evaluation.attested === true) {
            attested = 'yes'
          }
          let provenance: 'yes' | 'no' = 'no'
          if (evaluation.provenanceConfig === true) {
            provenance = 'yes'
          }
          return {
            name: evaluation.name,
            local_version: evaluation.localVersion,
            npm_latest: latest,
            class: evaluation.class,
            attested,
            publishConfig_provenance: provenance,
          }
        })
        const deferred = report.evaluations.filter((evaluation) => evaluation.class === 'unpublished').map((
          evaluation,
        ) => evaluation.name).sort()
        if (report.healthy === true) {
          const decision = yield* S.decodeEffect(Lang.PublishStatusHealthy)({
            _tag: 'PublishStatusHealthy',
            packages: report.total,
          }).pipe(Effect.orDie)
          const healthy: StatusReport = { decision, rows, deferred }
          return healthy
        }
        const decision = yield* S.decodeEffect(Lang.PublishStatusOwed)({
          _tag: 'PublishStatusOwed',
          unpublished: report.unpublished,
          untrusted: report.untrusted,
          stuck: report.stuck,
        }).pipe(Effect.orDie)
        const owed: StatusReport = { decision, rows, deferred }
        return owed
      })),
    Match.exhaustive,
  )

export const publishStatusCell: Cell.Cell<
  StatusRequest,
  StatusReport,
  Lang.MemberRefusal | Lang.TrustRefusal | Lang.PublishStatusRefusal,
  Lang.WorkspaceStore | Lang.RegistryPort
> = Cell.layer({ read, decode, decide: publishStatus, encode, write })
