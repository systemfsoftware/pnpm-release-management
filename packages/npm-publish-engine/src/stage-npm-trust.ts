import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import * as Lang from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { assessLauncherReadiness, AssessLauncherReadinessCommand } from './assess-launcher-readiness.workflow.js'
import { evaluateTrustState, EvaluateTrustStateCommand } from './evaluate-trust-state.workflow.js'
import { planStagedWork, PlanStagedWorkCommand } from './plan-staged-work.workflow.js'
import { selectTrustCandidates, SelectTrustCandidatesCommand } from './select-trust-candidates.workflow.js'
import { splitDryRun, SplitDryRunCommand, TrustComplete, type TrustIdle } from './split-dry-run.workflow.js'
import { type TrustCandidateState, TrustItemUnstaged, type TrustWorkItem } from './stage-trust.schema.js'

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
  readonly launcherReady: boolean
}

interface TrustRun {
  readonly context: TrustContext
  readonly selected: ReadonlyArray<TrustCandidateState>
  readonly owed: ReadonlyArray<TrustCandidateState>
  readonly items: ReadonlyArray<TrustWorkItem>
  readonly debuts: ReadonlyArray<Lang.PackageName>
  readonly packages: number
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
    const launcherManifest = request.launcherManifest
    const launcherReady = yield* Match.value(launcherManifest).pipe(
      Match.when(undefined, () => Effect.succeed(true)),
      Match.orElse((path) =>
        workspace.readFileFromRoot(path).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        )
      ),
    )
    return { candidates, launcherReady, request }
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
    Match.value(outcome).pipe(
      Match.tag('Failure', (failed) => Effect.fail(failed.failure)),
      Match.tag('Success', (decided) =>
        Effect.succeed({
          context,
          debuts: [],
          items: [],
          owed: [],
          packages: decided.success.selected.length,
          selected: [...decided.success.selected],
        })),
      Match.exhaustive,
    ),
})

const trustStateCell = Cell.layer({
  read: (run: TrustRun) => Effect.succeed(run),
  decode: (run: TrustRun): Result.Result<EvaluateTrustStateCommand, never> =>
    Result.succeed(new EvaluateTrustStateCommand({ candidates: [...run.selected] })),
  decide: evaluateTrustState,
  encode: (outcome) => outcome,
  write: (outcome, run) =>
    Match.value(outcome).pipe(
      Match.tag('Failure', (failed) => Effect.fail(failed.failure)),
      Match.tag('Success', (decided) =>
        Effect.succeed({
          context: run.context,
          debuts: run.debuts,
          items: run.items,
          owed: [...decided.success.owed],
          packages: run.packages,
          selected: run.selected,
        })),
      Match.exhaustive,
    ),
})

const stagedWorkCell = Cell.layer({
  read: (run: TrustRun) => Effect.succeed(run),
  decode: (run: TrustRun): Result.Result<PlanStagedWorkCommand, never> =>
    Result.succeed(new PlanStagedWorkCommand({ owed: [...run.owed] })),
  decide: planStagedWork,
  encode: (outcome) => outcome,
  write: (outcome, run) =>
    Match.value(outcome).pipe(
      Match.tag('Failure', (failed) => Effect.fail(failed.failure)),
      Match.tag('Success', (decided) =>
        Effect.succeed({
          context: run.context,
          debuts: [...decided.success.debuts],
          items: [...decided.success.items],
          owed: run.owed,
          packages: run.packages,
          selected: run.selected,
        })),
      Match.exhaustive,
    ),
})

const launcherCell = Cell.layer({
  read: (run: TrustRun) => Effect.succeed(run),
  decode: (run: TrustRun): Result.Result<AssessLauncherReadinessCommand, never> =>
    Result.succeed(
      new AssessLauncherReadinessCommand({
        debuts: [...run.debuts],
        launcherReady: run.context.launcherReady,
      }),
    ),
  decide: assessLauncherReadiness,
  encode: (outcome) => outcome,
  write: (outcome, run) =>
    Match.value(outcome).pipe(
      Match.tag('Failure', (failed) => Effect.fail(failed.failure)),
      Match.tag('Success', () => Effect.succeed(run)),
      Match.exhaustive,
    ),
})

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

const attemptItem = (
  item: TrustWorkItem,
  frame: { readonly workflowFile: string; readonly slug: string },
): Effect.Effect<void, TrustItemUnstaged, Lang.RegistryPort | Lang.ProcessPort> =>
  Effect.gen(function*() {
    const registry = yield* Lang.RegistryPort
    yield* Match.value(item.mode).pipe(
      Match.when('debut', () =>
        Effect.gen(function*() {
          yield* Match.value(item.hasBuild).pipe(
            Match.when(true, () => runParts(item, 'pnpm', ['--filter', item.name, 'build'])),
            Match.when(false, () => Effect.void),
            Match.exhaustive,
          )
          yield* registry.publishMember(item.name, item.version, false).pipe(
            Effect.mapError(() => TrustItemUnstaged.make({ name: item.name })),
          )
        })),
      Match.when('untrusted', () => Effect.void),
      Match.exhaustive,
    )
    yield* runParts(item, 'npm', [
      'trust',
      'github',
      item.name,
      '--repo',
      frame.slug,
      '--file',
      frame.workflowFile,
      '--allow-publish',
      '--yes',
    ])
    yield* runParts(item, 'npm', ['trust', 'list', item.name])
  })

const stageOwed = (
  complete: TrustComplete,
  request: TrustRequest,
): Effect.Effect<void, Lang.TrustPublishRefused, Lang.RegistryPort | Lang.ProcessPort> =>
  Effect.gen(function*() {
    const outcomes = yield* Effect.forEach(
      complete.owed,
      (item) =>
        Effect.match(
          attemptItem(item, { slug: complete.slug, workflowFile: complete.workflowFile }),
          {
            onFailure: () => ({ name: item.name, staged: false }),
            onSuccess: () => ({ name: item.name, staged: true }),
          },
        ),
      { concurrency: request.jobs ?? 4 },
    )
    const failed = outcomes
      .filter((outcome) => outcome.staged === false)
      .map((outcome) => outcome.name)
    yield* Match.value(failed).pipe(
      Match.when((names) => names.length === 0, () => Effect.void),
      Match.orElse((names) =>
        S.decodeUnknownEffect(Lang.TrustPublishRefused)({
          _tag: 'TrustPublishRefused',
          packages: [...names],
        }).pipe(
          Effect.orDie,
          Effect.flatMap((refused) => Effect.fail(refused)),
        )
      ),
    )
  })

const stageDecision = (
  decision: TrustIdle | TrustComplete,
  request: TrustRequest,
): Effect.Effect<
  TrustIdle | TrustComplete,
  Lang.TrustPublishRefused,
  Lang.RegistryPort | Lang.ProcessPort
> =>
  Match.value(decision).pipe(
    Match.tag('TrustIdle', () => Effect.succeed(decision)),
    Match.tag('TrustComplete', (complete) =>
      Effect.gen(function*() {
        yield* Match.value(complete.dryRun).pipe(
          Match.when(true, () => Effect.void),
          Match.when(false, () => stageOwed(complete, request)),
          Match.exhaustive,
        )
        return complete
      })),
    Match.exhaustive,
  )

const stagingCell = Cell.layer({
  read: (run: TrustRun) => Effect.succeed(run),
  decode: (run: TrustRun): Result.Result<SplitDryRunCommand, never> =>
    Result.succeed(
      new SplitDryRunCommand({
        debuts: [...run.debuts],
        dryRun: run.context.request.dryRun,
        items: [...run.items],
        launcherReady: run.context.launcherReady,
        packages: run.packages,
        slug: run.context.request.slug,
        workflowFile: run.context.request.workflowFile ?? defaultWorkflowFile,
      }),
    ),
  decide: splitDryRun,
  encode: (outcome) => outcome,
  write: (outcome, run) =>
    Match.value(outcome).pipe(
      Match.tag('Failure', (failed) => Effect.fail(failed.failure)),
      Match.tag('Success', (decided) => stageDecision(decided.success, run.context.request)),
      Match.exhaustive,
    ),
})

export const stageNpmTrustCell = Cell.andThen(
  Cell.andThen(
    Cell.andThen(Cell.andThen(selectionCell, trustStateCell), stagedWorkCell),
    launcherCell,
  ),
  stagingCell,
)
