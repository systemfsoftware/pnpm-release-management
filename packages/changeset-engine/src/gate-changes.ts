import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import {
  type ChangeEvidence,
  ChangeEvidencePort,
  ChangesetStore,
  type GateIntentMissing,
  type GateRefusal,
  type GateUnknownPackage,
  GitRef,
  type Intent,
  type IntentRefusal,
  type Member,
  type MemberRefusal,
  type PackageName,
  RepoRoot,
  TaskName,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { type ChangesGated, type ChangesVacant, gateChanges, GateCommand } from './gate-changes.workflow.js'

export const GateRequest = Wire.wire({
  root: Wire.mint(RepoRoot),
  ref: Wire.mint(GitRef),
  strategy: Wire.mint(S.Literals(['paths', 'turbo'])),
  task: Wire.mint(S.optional(TaskName)),
  skipLiveness: Wire.mint(S.optional(S.Boolean)),
})

export interface GateReport {
  readonly ok: boolean
  readonly text: string
}

type GateRequestInput = S.Schema.Type<typeof GateRequest>

type GateReadError = GateRefusal | MemberRefusal | IntentRefusal

type GateEvidence = {
  readonly members: ReadonlyArray<Member>
  readonly touched: ReadonlyArray<PackageName>
  readonly intents: ReadonlyArray<Intent>
  readonly skipLiveness?: boolean | undefined
}

const defaultTask = S.decodeUnknownResult(TaskName)('build')

const resolvedTask = (given: TaskName | undefined): Effect.Effect<TaskName> =>
  Option.match(Option.fromNullishOr(given), {
    onNone: () =>
      Result.match(defaultTask, {
        onFailure: () => Effect.die(new Error('the gate default turbo task "build" is not a task name')),
        onSuccess: (task) => Effect.succeed(task),
      }),
    onSome: (task) => Effect.succeed(task),
  })

const evidenceOf = (
  request: GateRequestInput,
): Effect.Effect<ChangeEvidence, GateRefusal, ChangeEvidencePort> =>
  Match.value(request).pipe(
    Match.when(
      { strategy: 'turbo' },
      (turbo) =>
        Effect.flatMap(ChangeEvidencePort, (port) =>
          Effect.flatMap(resolvedTask(turbo.task), (task) => port.turboEvidence(turbo.root, turbo.ref, task))),
    ),
    Match.orElse((paths) =>
      Effect.flatMap(ChangeEvidencePort, (port) => port.pathsEvidence(paths.root, paths.ref))
    ),
  )

const read = (
  request: GateRequestInput,
): Effect.Effect<
  GateEvidence,
  GateReadError,
  ChangeEvidencePort | WorkspaceStore | ChangesetStore
> =>
  Effect.gen(function*() {
    const evidence = yield* evidenceOf(request)
    const workspace = yield* WorkspaceStore
    const members = yield* workspace.listMembers()
    const store = yield* ChangesetStore
    const paths = yield* store.listIntents()
    const intents = yield* Effect.all(paths.map((intentPath) => store.readIntent(intentPath)))
    return { members, touched: evidence.touched, intents, skipLiveness: request.skipLiveness }
  })

const decode = (raw: GateEvidence): Result.Result<GateCommand, never> => Result.succeed(GateCommand.make(raw))

const missingGuidance = (missing: ReadonlyArray<string>): string =>
  [
    `This change moves ${missing.length} publishable package(s) that no intent names: ${missing.join(', ')}`,
    '',
    'Add a `.changeset/<slug>.md` naming each one — the frontmatter is the intent:',
    '',
    '  ---',
    missing.map((name) => `  "${name}": patch`).join('\n'),
    '  ---',
    '',
    '  <one line saying what changed for a consumer>',
    '',
    'Bumps are none | patch | minor | major. `none` records a touch that releases nothing;',
    'a devDependency-only or script-only bump is the canonical `none` class.',
  ].join('\n')

const refusalReport = (refusal: GateIntentMissing | GateUnknownPackage): GateReport =>
  Match.value(refusal).pipe(
    Match.tag(
      'GateUnknownPackage',
      (unknown): GateReport => ({
        ok: false,
        text: `${unknown.path} names non-member package "${unknown.package}" — no workspace package has that name`,
      }),
    ),
    Match.tag(
      'GateIntentMissing',
      (missing): GateReport => ({ ok: false, text: missingGuidance(missing.packages) }),
    ),
    Match.exhaustive,
  )

const decisionReport = (decision: ChangesGated | ChangesVacant): GateReport =>
  Match.value(decision).pipe(
    Match.tag(
      'ChangesVacant',
      (vacant): GateReport => ({
        ok: true,
        text: `changeset gate: no publishable package changed (${vacant.members.length} member(s))`,
      }),
    ),
    Match.tag(
      'ChangesGated',
      (gated): GateReport => ({
        ok: true,
        text: `changeset gate: ${gated.touched.length} publishable package(s) changed, each named by an intent — ${
          gated.touched.join(', ')
        }`,
      }),
    ),
    Match.exhaustive,
  )

const encode = (
  outcome: Result.Result<ChangesGated | ChangesVacant, GateIntentMissing | GateUnknownPackage>,
): GateReport => Result.match(outcome, { onFailure: refusalReport, onSuccess: decisionReport })

const write = (report: GateReport): Effect.Effect<GateReport> => Effect.succeed(report)

export const gateChangesCell = Cell.layer({
  read,
  decode,
  decide: gateChanges,
  encode,
  write,
})
