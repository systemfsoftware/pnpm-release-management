import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import * as Lang from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { assessLauncherReadiness, AssessLauncherReadinessCommand } from './assess-launcher-readiness.workflow.js'
import {
  assessStagedPublish,
  AssessStagedPublishCommand,
  type StagedItemOutcome,
} from './assess-staged-publish.workflow.js'
import { evaluateTrustState, EvaluateTrustStateCommand } from './evaluate-trust-state.workflow.js'
import { planStagedWork, PlanStagedWorkCommand } from './plan-staged-work.workflow.js'
import { selectTrustCandidates, SelectTrustCandidatesCommand } from './select-trust-candidates.workflow.js'
import { splitDryRun, SplitDryRunCommand, type TrustComplete, type TrustIdle } from './split-dry-run.workflow.js'
import { TrustItemUnstaged } from './stage-trust.schema.js'
import type { TrustCandidateState, TrustWorkItem, TrustWorkStep } from './stage-trust.schema.js'

export const TrustRequest = Wire.wire({
  only: Wire.mint(S.Array(Lang.PackageName)),
  dryRun: Wire.mint(S.Boolean),
  registry: Wire.mint(Lang.HttpUrl),
  workflowFile: Wire.mint(S.optional(S.NonEmptyString)),
  slug: Wire.mint(S.NonEmptyString),
  jobs: Wire.mint(S.optional(S.Int.pipe(S.check(S.isGreaterThan(0))))),
  launcherManifest: Wire.mint(S.optional(Lang.RelativePath)),
})
export type TrustRequest = S.Schema.Type<typeof TrustRequest>

interface TrustFlow {
  readonly request: TrustRequest
  readonly candidates: ReadonlyArray<TrustCandidateState>
  readonly launcherReadable: boolean
  readonly selected: ReadonlyArray<TrustCandidateState>
  readonly owed: ReadonlyArray<TrustCandidateState>
  readonly debuts: ReadonlyArray<Lang.PackageName>
  readonly items: ReadonlyArray<TrustWorkItem>
  readonly outcomes: ReadonlyArray<StagedItemOutcome>
  readonly packages: number
}

interface StagedRun {
  readonly flow: TrustFlow
  readonly decision: TrustIdle | TrustComplete
}

interface StagedPublishRead {
  readonly command: AssessStagedPublishCommand
  readonly decision: TrustIdle | TrustComplete
}

interface WorkFrame {
  readonly workflowFile: string
  readonly slug: string
}

type StepRunner = (
  item: TrustWorkItem,
  frame: WorkFrame,
) => Effect.Effect<void, TrustItemUnstaged, Lang.RegistryPort | Lang.ProcessPort>

const defaultWorkflowFile = 'release.yml'
const defaultJobs = 4

const launcherReadableOf = (
  workspace: Lang.WorkspaceStore,
  request: TrustRequest,
): Effect.Effect<boolean, never, never> =>
  Option.match(Option.fromNullishOr(request.launcherManifest), {
    onNone: () => Effect.succeed(false),
    onSome: (path) => workspace.readFileFromRoot(path).pipe(Effect.as(true), Effect.orElseSucceed(() => false)),
  })

const gatherOf = (
  request: TrustRequest,
): Effect.Effect<
  TrustFlow,
  Lang.MemberRefusal | Lang.TrustRefusal,
  Lang.WorkspaceStore | Lang.RegistryPort
> =>
  Effect.gen(function*() {
    const workspace = yield* Lang.WorkspaceStore
    const registry = yield* Lang.RegistryPort
    const members = yield* workspace.listMembers()
    const candidates = yield* Effect.forEach(members, (member) =>
      Effect.gen(function*() {
        const manifest = yield* workspace.readManifest(member.dir)
        const snapshot = yield* registry.queryPackage(member.name)
        return {
          name: member.name,
          version: manifest.version,
          hasBuild: typeof manifest.scripts?.['build'] === 'string',
          snapshot,
        }
      }))
    const launcherReadable = yield* launcherReadableOf(workspace, request)
    return {
      request,
      candidates,
      launcherReadable,
      selected: [],
      owed: [],
      debuts: [],
      items: [],
      outcomes: [],
      packages: 0,
    }
  })

const runParts = (
  item: TrustWorkItem,
  program: string,
  args: ReadonlyArray<string>,
): Effect.Effect<void, TrustItemUnstaged, Lang.ProcessPort> =>
  Effect.gen(function*() {
    const process = yield* Lang.ProcessPort
    yield* process.runCommand({
      program: Lang.CommandName.make(program),
      args: args.map((arg) => Lang.PublishArg.make(arg)),
    }).pipe(
      Effect.mapError(() => TrustItemUnstaged.make({ name: item.name })),
    )
  })

const stepRunners: Record<TrustWorkStep, StepRunner> = {
  build: (item) => runParts(item, 'pnpm', ['--filter', item.name, 'build']),
  publish: (item) =>
    Effect.flatMap(Lang.RegistryPort, (registry) =>
      registry.publishMember(item.name, item.version, false).pipe(
        Effect.mapError(() => TrustItemUnstaged.make({ name: item.name })),
      )),
  'trust-github': (item, frame) =>
    runParts(item, 'npm', [
      'trust',
      'github',
      item.name,
      '--repo',
      frame.slug,
      '--file',
      frame.workflowFile,
      '--allow-publish',
      '--yes',
    ]),
  'trust-list': (item) => runParts(item, 'npm', ['trust', 'list', item.name]),
}

const attemptOf = (
  item: TrustWorkItem,
  frame: WorkFrame,
): Effect.Effect<ReadonlyArray<void>, TrustItemUnstaged, Lang.RegistryPort | Lang.ProcessPort> =>
  Effect.forEach(item.steps, (step) => stepRunners[step](item, frame))

const stageOf = (
  items: ReadonlyArray<TrustWorkItem>,
  flow: TrustFlow,
): Effect.Effect<ReadonlyArray<StagedItemOutcome>, never, Lang.RegistryPort | Lang.ProcessPort> =>
  Effect.forEach(
    items,
    (item) =>
      Effect.match(
        attemptOf(item, {
          slug: flow.request.slug,
          workflowFile: flow.request.workflowFile ?? defaultWorkflowFile,
        }),
        {
          onFailure: (): StagedItemOutcome => ({ name: item.name, staged: false }),
          onSuccess: (): StagedItemOutcome => ({ name: item.name, staged: true }),
        },
      ),
    { concurrency: flow.request.jobs ?? defaultJobs },
  )

const selectionCell = Cell.layer({
  read: gatherOf,
  decode: (flow: TrustFlow): Result.Result<SelectTrustCandidatesCommand, never> =>
    Result.succeed(
      new SelectTrustCandidatesCommand({
        members: Lang.Count.make(flow.candidates.length),
        candidates: [...flow.candidates],
        only: [...flow.request.only],
      }),
    ),
  decide: selectTrustCandidates,
  encode: (outcome) => outcome,
  write: (outcome, flow) =>
    Effect.map(Effect.fromResult(outcome), (selection) => ({
      ...flow,
      packages: selection.selected.length,
      selected: [...selection.selected],
    })),
})

const trustStateCell = Cell.layer({
  read: (flow: TrustFlow) => Effect.succeed(flow),
  decode: (flow: TrustFlow): Result.Result<EvaluateTrustStateCommand, never> =>
    Result.succeed(new EvaluateTrustStateCommand({ candidates: [...flow.selected] })),
  decide: evaluateTrustState,
  encode: (outcome) => outcome,
  write: (outcome, flow) => Effect.map(Effect.fromResult(outcome), (trust) => ({ ...flow, owed: [...trust.owed] })),
})

const stagedWorkCell = Cell.layer({
  read: (flow: TrustFlow) => Effect.succeed(flow),
  decode: (flow: TrustFlow): Result.Result<PlanStagedWorkCommand, never> =>
    Result.succeed(new PlanStagedWorkCommand({ owed: [...flow.owed] })),
  decide: planStagedWork,
  encode: (outcome) => outcome,
  write: (outcome, flow) =>
    Effect.map(Effect.fromResult(outcome), (plan) => ({
      ...flow,
      debuts: [...plan.debuts],
      items: [...plan.items],
    })),
})

const launcherCell = Cell.layer({
  read: (flow: TrustFlow) => Effect.succeed(flow),
  decode: (flow: TrustFlow): Result.Result<AssessLauncherReadinessCommand, never> =>
    Result.succeed(
      new AssessLauncherReadinessCommand({
        debuts: [...flow.debuts],
        launcherManifest: flow.request.launcherManifest,
        launcherReadable: flow.launcherReadable,
      }),
    ),
  decide: assessLauncherReadiness,
  encode: (outcome) => outcome,
  write: (outcome, flow) => Effect.as(Effect.fromResult(outcome), flow),
})

const stagingCell = Cell.layer({
  read: (flow: TrustFlow) => Effect.succeed(flow),
  decode: (flow: TrustFlow): Result.Result<SplitDryRunCommand, never> =>
    Result.succeed(
      new SplitDryRunCommand({
        debuts: [...flow.debuts],
        dryRun: flow.request.dryRun,
        items: [...flow.items],
        launcherManifest: flow.request.launcherManifest,
        launcherReadable: flow.launcherReadable,
        packages: flow.packages,
        slug: flow.request.slug,
        workflowFile: flow.request.workflowFile ?? defaultWorkflowFile,
      }),
    ),
  decide: splitDryRun,
  encode: (outcome) => outcome,
  write: (outcome, flow) =>
    Effect.flatMap(Effect.fromResult(outcome), (decision) =>
      Effect.map(
        stageOf(decision.stage, flow),
        (outcomes): StagedRun => ({ flow: { ...flow, outcomes }, decision }),
      )),
})

const stagedPublishCell = Cell.layer({
  read: (staged: StagedRun): Effect.Effect<StagedPublishRead, never, never> =>
    Effect.succeed({
      command: new AssessStagedPublishCommand({ outcomes: [...staged.flow.outcomes] }),
      decision: staged.decision,
    }),
  decode: (raw: StagedPublishRead): Result.Result<AssessStagedPublishCommand, never> => Result.succeed(raw.command),
  decide: assessStagedPublish,
  encode: (outcome) => outcome,
  write: (outcome, raw) => Effect.as(Effect.fromResult(outcome), raw.decision),
})

export const stageNpmTrustCell = pipe(
  selectionCell,
  Cell.andThen(trustStateCell),
  Cell.andThen(stagedWorkCell),
  Cell.andThen(launcherCell),
  Cell.andThen(stagingCell),
  Cell.andThen(stagedPublishCell),
)
