import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import {
  ChangeEvidencePort,
  type ChangeEvidenceRefusal,
  ChangesetStore,
  type GateIntentMissing,
  type GateUnknownPackage,
  GitRef,
  type Intent,
  type IntentRefusal,
  type MemberRefusal,
  RepoRoot,
  TaskName,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { type ChangesGated, type ChangesVacant, gateChanges, GateCommand } from './gate-changes.workflow.js'

const GateRequest = Wire.wire({
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

type GateReadError = ChangeEvidenceRefusal | MemberRefusal | IntentRefusal

type GateVerdict = Result.Result<
  ChangesVacant | ChangesGated,
  GateIntentMissing | GateUnknownPackage
>

const buildTask = (): TaskName => TaskName.make('build')

const read = (
  request: GateRequestInput,
): Effect.Effect<
  GateCommand,
  GateReadError,
  ChangeEvidencePort | WorkspaceStore | ChangesetStore
> =>
  Effect.gen(function*() {
    const evidence = yield* Effect.flatMap(ChangeEvidencePort, (port) => {
      if (request.strategy === 'turbo') {
        return port.turboEvidence(request.root, request.ref, request.task ?? buildTask())
      }
      return port.pathsEvidence(request.root, request.ref)
    })
    const workspace = yield* WorkspaceStore
    const store = yield* ChangesetStore
    const members = yield* workspace.listMembers()
    const paths = yield* store.listIntents()
    const intents: ReadonlyArray<Intent> = yield* Effect.all(
      paths.map((path) => store.readIntent(path)),
    )
    return GateCommand.make({
      members,
      touched: evidence.touched,
      deleted: evidence.deleted,
      intents,
      skipLiveness: request.skipLiveness,
    })
  })

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

const deletedLine = (deleted: ReadonlyArray<string>): string => {
  if (deleted.length === 0) return ''
  return `\nchangeset gate: ${deleted.length} package(s) deleted, nothing left to release — ${deleted.join(', ')}`
}

const decisionReport = (decision: ChangesVacant | ChangesGated): GateReport =>
  Match.value(decision).pipe(
    Match.tag(
      'ChangesVacant',
      (vacant): GateReport => ({
        ok: true,
        text: `changeset gate: no publishable package changed (${vacant.members.length} member(s))${
          deletedLine(vacant.deleted)
        }`,
      }),
    ),
    Match.tag(
      'ChangesGated',
      (gated): GateReport => ({
        ok: true,
        text: `changeset gate: ${gated.touched.length} publishable package(s) changed, each named by an intent — ${
          gated.touched.join(', ')
        }${deletedLine(gated.deleted)}`,
      }),
    ),
    Match.exhaustive,
  )

const reportOf = (outcome: GateVerdict): GateReport =>
  Result.match(outcome, { onFailure: refusalReport, onSuccess: decisionReport })

export const gateChangesCell = Cell.layer({
  read,
  decide: gateChanges,
  write: (outcome: GateVerdict) => Effect.succeed(reportOf(outcome)),
})
