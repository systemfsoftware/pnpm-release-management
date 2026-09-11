import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import * as Lang from '@systemfsoftware/release-language'
import { Effect } from 'effect'
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
import {
  type TrustCandidateState,
  TrustItemUnstaged,
  type TrustWorkItem,
  type TrustWorkStep,
} from './stage-trust.schema.js'

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

interface TrustContext {
  readonly request: TrustRequest
  readonly candidates: ReadonlyArray<TrustCandidateState>
  readonly launcherReadable: boolean
}

interface TrustRun {
  readonly context: TrustContext
  readonly selected: ReadonlyArray<TrustCandidateState>
  readonly owed: ReadonlyArray<TrustCandidateState>
  readonly items: ReadonlyArray<TrustWorkItem>
  readonly debuts: ReadonlyArray<Lang.PackageName>
  readonly outcomes: ReadonlyArray<StagedItemOutcome>
  readonly packages: number
}

interface StagedRun {
  readonly run: TrustRun
  readonly decision: TrustIdle | TrustComplete
}

interface WorkFrame {
  readonly workflowFile: string
  readonly slug: string
}

const defaultWorkflowFile = 'release.yml'

const read = (
  request: TrustRequest,
): Effect.Effect<
  TrustContext,
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
    const launcherReadable = yield* Option.getOrElse(
      Option.map(Option.fromNullishOr(request.launcherManifest), (path) =>
        workspace.readFileFromRoot(path).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        )),
      () => Effect.succeed(false),
    )
    return { candidates, launcherReadable, request }
  })

const selectionCell = Cell.layer({
  read,
  decode: (context: TrustContext): Result.Result<SelectTrustCandidatesCommand, never> =>
    Result.succeed(
      new SelectTrustCandidatesCommand({
        candidates: [...context.candidates],
        only: [...context.request.only],
      }),
    ),
  decide: selectTrustCandidates,
  encode: (outcome) => outcome,
  write: (outcome, context) =>
    Effect.map(
      Effect.fromResult(outcome),
      (selection) => ({
        context,
        debuts: [],
        items: [],
        outcomes: [],
        owed: [],
        packages: selection.selected.length,
        selected: [...selection.selected],
      }),
    ),
})

const trustStateCell = Cell.layer({
  read: (run: TrustRun) => Effect.succeed(run),
  decode: (run: TrustRun): Result.Result<EvaluateTrustStateCommand, never> =>
    Result.succeed(new EvaluateTrustStateCommand({ candidates: [...run.selected] })),
  decide: evaluateTrustState,
  encode: (outcome) => outcome,
  write: (outcome, run) =>
    Effect.map(
      Effect.fromResult(outcome),
      (trust) => ({
        context: run.context,
        debuts: run.debuts,
        items: run.items,
        outcomes: run.outcomes,
        owed: [...trust.owed],
        packages: run.packages,
        selected: run.selected,
      }),
    ),
})

const stagedWorkCell = Cell.layer({
  read: (run: TrustRun) => Effect.succeed(run),
  decode: (run: TrustRun): Result.Result<PlanStagedWorkCommand, never> =>
    Result.succeed(new PlanStagedWorkCommand({ owed: [...run.owed] })),
  decide: planStagedWork,
  encode: (outcome) => outcome,
  write: (outcome, run) =>
    Effect.map(
      Effect.fromResult(outcome),
      (plan) => ({
        context: run.context,
        debuts: [...plan.debuts],
        items: [...plan.items],
        outcomes: run.outcomes,
        owed: run.owed,
        packages: run.packages,
        selected: run.selected,
      }),
    ),
})

const launcherCell = Cell.layer({
  read: (run: TrustRun) => Effect.succeed(run),
  decode: (run: TrustRun): Result.Result<AssessLauncherReadinessCommand, never> =>
    Result.succeed(
      new AssessLauncherReadinessCommand({
        debuts: [...run.debuts],
        launcherManifest: run.context.request.launcherManifest,
        launcherReadable: run.context.launcherReadable,
      }),
    ),
  decide: assessLauncherReadiness,
  encode: (outcome) => outcome,
  write: (outcome, run) => Effect.as(Effect.fromResult(outcome), run),
})

type StepRunner = (
  item: TrustWorkItem,
  frame: WorkFrame,
) => Effect.Effect<void, TrustItemUnstaged, Lang.RegistryPort | Lang.ProcessPort>

const runParts = (
  item: TrustWorkItem,
  program: string,
  args: ReadonlyArray<string>,
): Effect.Effect<void, TrustItemUnstaged, Lang.ProcessPort> =>
  Effect.gen(function*() {
    const process = yield* Lang.ProcessPort
    const command = yield* S.decodeUnknownEffect(Lang.WorkspaceCommand)({ args, program }).pipe(
      Effect.orDie,
    )
    yield* process.runCommand(command).pipe(
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

const attemptItem = (
  item: TrustWorkItem,
  frame: WorkFrame,
): Effect.Effect<ReadonlyArray<void>, TrustItemUnstaged, Lang.RegistryPort | Lang.ProcessPort> =>
  Effect.forEach(item.steps, (step) => stepRunners[step](item, frame))

const stageItems = (
  items: ReadonlyArray<TrustWorkItem>,
  run: TrustRun,
): Effect.Effect<
  ReadonlyArray<StagedItemOutcome>,
  never,
  Lang.RegistryPort | Lang.ProcessPort
> =>
  Effect.gen(function*() {
    const frame = {
      slug: run.context.request.slug,
      workflowFile: Option.getOrElse(
        Option.fromNullishOr(run.context.request.workflowFile),
        () => defaultWorkflowFile,
      ),
    }
    return yield* Effect.forEach(
      items,
      (item) =>
        Effect.match(attemptItem(item, frame), {
          onFailure: () => ({ name: item.name, staged: false }),
          onSuccess: () => ({ name: item.name, staged: true }),
        }),
      { concurrency: Option.getOrElse(Option.fromNullishOr(run.context.request.jobs), () => 4) },
    )
  })

const stagingCell = Cell.layer({
  read: (run: TrustRun) => Effect.succeed(run),
  decode: (run: TrustRun): Result.Result<SplitDryRunCommand, never> =>
    Result.succeed(
      new SplitDryRunCommand({
        debuts: [...run.debuts],
        dryRun: run.context.request.dryRun,
        items: [...run.items],
        launcherManifest: run.context.request.launcherManifest,
        launcherReadable: run.context.launcherReadable,
        packages: run.packages,
        slug: run.context.request.slug,
        workflowFile: Option.getOrElse(
          Option.fromNullishOr(run.context.request.workflowFile),
          () => defaultWorkflowFile,
        ),
      }),
    ),
  decide: splitDryRun,
  encode: (outcome) => outcome,
  write: (outcome, run) =>
    Effect.flatMap(
      Effect.fromResult(outcome),
      (decision) =>
        Effect.map(stageItems(decision.stage, run), (outcomes) => ({
          decision,
          run: {
            context: run.context,
            debuts: run.debuts,
            items: run.items,
            outcomes,
            owed: run.owed,
            packages: run.packages,
            selected: run.selected,
          },
        })),
    ),
})

const stagedPublishCell = Cell.layer({
  read: (staged: StagedRun) =>
    Effect.succeed({
      command: new AssessStagedPublishCommand({ outcomes: [...staged.run.outcomes] }),
      decision: staged.decision,
    }),
  decode: (
    raw: { readonly command: AssessStagedPublishCommand; readonly decision: TrustIdle | TrustComplete },
  ): Result.Result<AssessStagedPublishCommand, never> => Result.succeed(raw.command),
  decide: assessStagedPublish,
  encode: (outcome) => outcome,
  write: (outcome, raw) => Effect.as(Effect.fromResult(outcome), raw.decision),
})

export const stageNpmTrustCell = Cell.andThen(
  Cell.andThen(
    Cell.andThen(
      Cell.andThen(Cell.andThen(selectionCell, trustStateCell), stagedWorkCell),
      launcherCell,
    ),
    stagingCell,
  ),
  stagedPublishCell,
)
