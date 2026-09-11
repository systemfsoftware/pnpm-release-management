import { it } from '@effect/vitest'
import { gateChangesCell } from '@systemfsoftware/changeset-engine'
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
import * as fc from 'effect/testing/FastCheck'
import { fakeChangeEvidencePort } from '../../tests/__fixtures__/FakeChangeEvidencePort.js'
import { fakeChangesetStore } from '../../tests/__fixtures__/FakeChangesetStore.js'
import { fakeWorkspaceStore } from '../../tests/__fixtures__/FakeWorkspaceStore.js'

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
})

const membersArb = fc.uniqueArray(memberArb, {
  selector: (member) => member.name,
  maxLength: 4,
})

const intentNameArbFrom = (names: ReadonlyArray<PackageName>) => {
  if (names.length > 0) {
    return fc.oneof(
      { arbitrary: fc.constantFrom(...names), weight: 3 },
      { arbitrary: pkgArb, weight: 1 },
    )
  }
  return pkgArb
}

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
  })

const touchedArbFrom = (members: ReadonlyArray<Member>): fc.Arbitrary<ReadonlyArray<PackageName>> => {
  if (members.length === 0) {
    return fc.constant([])
  }
  return fc.array(fc.constantFrom(...members.map((m) => m.name)), { maxLength: 4 })
}

const scenarioArb = membersArb.chain((members) =>
  fc.tuple(
    touchedArbFrom(members),
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

const gateEffect = (scenario: {
  members: ReadonlyArray<Member>
  touched: ReadonlyArray<PackageName>
  intents: ReadonlyArray<Intent>
  skipLiveness: boolean
}): Effect.Effect<boolean> => {
  const program = Cell.provide(Layer.mergeAll(
    fakeWorkspaceStore(scenario.members),
    fakeChangeEvidencePort({
      members: scenario.members,
      touched: scenario.touched,
      raw: null,
    }),
    fakeChangesetStore({ intents: scenario.intents }).layer,
  ))(gateChangesCell)
  return Effect.map(
    Cell.run(program, {
      root: RepoRoot.make('/repo'),
      ref: GitRef.make('HEAD'),
      strategy: 'paths',
      skipLiveness: scenario.skipLiveness,
    }),
    (report) => {
      const expected = oracle(scenario)
      return report.ok === expected.ok && classification(report.text) === expected.tag
    },
  ).pipe(Effect.orElseSucceed(() => false))
}

it.effect.prop(
  '∀scenario_GateVerdict_=Oracle',
  [scenarioArb],
  ([scenario]) => gateEffect(scenario),
)
