import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import {
  ChangeEvidencePort,
  ChangesetStore,
  type GateIntentMissing,
  type GateRefusal,
  GateSatisfied,
  type GateUnknownPackage,
  GateVacant,
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
type RawGate = {
  readonly request: S.Schema.Type<typeof GateRequest>
  readonly touched: ReadonlyArray<PackageName>
  readonly members: ReadonlyArray<Member>
  readonly intents: ReadonlyArray<Intent>
}

type GateReadError = GateRefusal | MemberRefusal | IntentRefusal

const read = (
  request: S.Schema.Type<typeof GateRequest>,
): Effect.Effect<
  RawGate,
  GateReadError,
  ChangeEvidencePort | WorkspaceStore | ChangesetStore
> =>
  Effect.gen(function*() {
    const evidence = yield* Effect.flatMap(ChangeEvidencePort, (port) =>
      Match.value(request).pipe(
        Match.when(
          { strategy: 'turbo' },
          (r) => port.turboEvidence(r.root, r.ref, r.task ?? TaskName.make('build')),
        ),
        Match.orElse((r) => port.pathsEvidence(r.root, r.ref)),
      ))
    const workspace = yield* WorkspaceStore
    const members = yield* workspace.listMembers()
    const store = yield* ChangesetStore
    const paths = yield* store.listIntents()
    const intents = yield* Effect.all(paths.map((path) => store.readIntent(path)))
    return { request, touched: evidence.touched, members, intents }
  })
const decode = (raw: RawGate): Result.Result<InstanceType<typeof GateCommand>, never> =>
  Result.succeed(
    GateCommand.make({
      members: [...raw.members],
      touched: [...raw.touched],
      intents: [...raw.intents],
      skipLiveness: raw.request.skipLiveness,
    }),
  )

const missingGuidance = (missing: ReadonlyArray<string>): string => {
  const frontmatter = missing.map((name) => `  "${name}": patch`).join('\n')
  return [
    `This change moves ${missing.length} publishable package(s) that no intent names: ${missing.join(', ')}`,
    '',
    'Add a `.changeset/<slug>.md` naming each one — the frontmatter is the intent:',
    '',
    '  ---',
    frontmatter,
    '  ---',
    '',
    '  <one line saying what changed for a consumer>',
    '',
    'Bumps are none | patch | minor | major. `none` records a touch that releases nothing;',
    'a devDependency-only or script-only bump is the canonical `none` class.',
  ].join('\n')
}
const encode = (
  outcome: Result.Result<ChangesGated | ChangesVacant, GateIntentMissing | GateUnknownPackage>,
): GateReport =>
  Result.match(outcome, {
    onFailure: (refusal) =>
      Match.value(refusal).pipe(
        Match.tag(
          'GateUnknownPackage',
          (r) => ({
            ok: false,
            text: `${r.path} names non-member package "${r.package}" — no workspace package has that name`,
          }),
        ),
        Match.tag('GateIntentMissing', (r) => ({
          ok: false,
          text: missingGuidance(r.packages),
        })),
        Match.exhaustive,
      ),
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('ChangesVacant', (r) => {
          const wire = GateVacant.make({ members: r.members })
          return {
            ok: true,
            text: `changeset gate: no publishable package changed (${wire.members.length} member(s))`,
          }
        }),
        Match.tag('ChangesGated', (r) => {
          const wire = GateSatisfied.make({ touched: r.touched })
          return {
            ok: true,
            text: `changeset gate: ${wire.touched.length} publishable package(s) changed, each named by an intent — ${
              wire.touched.join(', ')
            }`,
          }
        }),
        Match.exhaustive,
      ),
  })

const write = (report: GateReport): Effect.Effect<GateReport> => Effect.succeed(report)

export const gateChangesCell = Cell.layer({
  read,
  decode,
  decide: gateChanges,
  encode,
  write,
})
