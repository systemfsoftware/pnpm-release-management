import { describe, it } from '@std/testing/bdd'
import { Cell } from '@systemfsoftware/effect-cell-types'
import {
  GitRef,
  type Intent,
  IntentSummary,
  type Member,
  PackageName,
  PackageVersion,
  RelativePath,
  RepoRoot,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as fc from 'fast-check'
import { gateChangesCell, type GateReport } from '../mod.ts'
import { fakeChangeEvidencePort } from '../src/testing/FakeChangeEvidencePort.ts'
import { fakeChangesetStore } from '../src/testing/FakeChangesetStore.ts'
import { fakeWorkspaceStore } from '../src/testing/FakeWorkspaceStore.ts'

const nameArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,9}$/)
const pkgArb = nameArb.map((name) => PackageName.make(name))
const bumpArb = fc.constantFrom('none', 'patch', 'minor', 'major')

const memberArb = fc.record({
  name: pkgArb,
  dir: nameArb.map((dir) => RelativePath.make(`packages/${dir}`)),
  manifest: fc.record({
    name: pkgArb,
    version: fc.constant(PackageVersion.make('0.1.0')),
  }),
  publishable: fc.boolean(),
}) as fc.Arbitrary<Member>

const membersArb = fc.uniqueArray(memberArb, {
  selector: (member) => member.name,
  maxLength: 4,
})

const intentNameArbFrom = (names: ReadonlyArray<PackageName>) =>
  names.length > 0
    ? fc.oneof(
      { arbitrary: fc.constantFrom(...names), weight: 3 },
      { arbitrary: pkgArb, weight: 1 },
    )
    : pkgArb

const intentArbFrom = (names: ReadonlyArray<PackageName>): fc.Arbitrary<Intent> =>
  fc.record({
    path: nameArb.map((slug) => RelativePath.make(`.changeset/${slug}.md`)),
    packages: fc.array(
      fc.record({
        name: intentNameArbFrom(names),
        bump: bumpArb,
      }),
      { minLength: 1, maxLength: 3 },
    ),
    summary: fc.stringMatching(/^[a-z]{1,12}$/).map((line) => IntentSummary.make(line)),
  }) as fc.Arbitrary<Intent>

const scenarioArb = membersArb.chain((members) =>
  fc.tuple(
    members.length > 0
      ? fc.array(fc.constantFrom(...members.map((m) => m.name)), { maxLength: 4 })
      : fc.constant([] as ReadonlyArray<PackageName>),
    fc.array(intentArbFrom(members.map((m) => m.name)), { maxLength: 3 }),
    fc.boolean(),
  ).map(([touched, intents, skipLiveness]) => ({ members, touched, intents, skipLiveness }))
)

const classification = (text: string): string => {
  if (text.includes('names non-member package')) return 'GateUnknownPackage'
  if (text.includes('no publishable package changed')) return 'GateVacant'
  if (text.includes('no intent names')) return 'GateIntentMissing'
  return 'GateSatisfied'
}

const oracle = (scenario: {
  members: ReadonlyArray<Member>
  touched: ReadonlyArray<PackageName>
  intents: ReadonlyArray<Intent>
  skipLiveness: boolean
}): { ok: boolean; tag: string } => {
  const names = scenario.members.map((m) => m.name)
  const publishable = scenario.members.filter((m) => m.publishable).map((m) => m.name)
  const moved = scenario.touched.filter((n) => publishable.includes(n)).sort()
  const foreign = scenario.intents
    .flatMap((intent) => intent.packages.map((entry) => entry.name))
    .filter((name) => !names.includes(name) && !scenario.skipLiveness)
  if (foreign.length > 0) return { ok: false, tag: 'GateUnknownPackage' }
  if (moved.length === 0) return { ok: true, tag: 'GateVacant' }
  const missing = moved.filter((name) =>
    !scenario.intents.some((intent) => intent.packages.some((entry) => entry.name === name))
  )
  if (missing.length > 0) return { ok: false, tag: 'GateIntentMissing' }
  return { ok: true, tag: 'GateSatisfied' }
}

const runGate = (scenario: {
  members: ReadonlyArray<Member>
  touched: ReadonlyArray<PackageName>
  intents: ReadonlyArray<Intent>
  skipLiveness: boolean
}): Promise<GateReport> => {
  const program = Cell.provide(Layer.mergeAll(
    fakeWorkspaceStore(scenario.members),
    fakeChangeEvidencePort({
      members: scenario.members,
      touched: scenario.touched,
      raw: null,
    }),
    fakeChangesetStore({ intents: scenario.intents }).layer,
  ))(gateChangesCell)
  return Effect.runPromise(Cell.run(program, {
    root: RepoRoot.make('/repo'),
    ref: GitRef.make('HEAD'),
    strategy: 'paths',
    skipLiveness: scenario.skipLiveness,
  }))
}

describe('gate property', () => {
  it('verdicts match the gate spec over generated scenarios', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const report = await runGate(scenario)
        const expected = oracle(scenario)
        return report.ok === expected.ok && classification(report.text) === expected.tag
      }),
      { numRuns: 100 },
    )
  })
})
