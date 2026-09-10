import { describe, it } from '@std/testing/bdd'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { type Member, type NewIntentDecision, PackageName } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Layer from 'effect/Layer'
import * as Result from 'effect/Result'
import * as fc from 'fast-check'
import { newIntentCell } from '../mod.ts'
import { fakeChangesetStore } from '../src/testing/FakeChangesetStore.ts'
import { fakeWorkspaceStore } from '../src/testing/FakeWorkspaceStore.ts'

const nameArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,9}$/)
const slugArb = fc.stringMatching(/^[a-z0-9]+(-[a-z0-9]+)*$/)
const bumpArb = fc.constantFrom('none', 'patch', 'minor', 'major')

const memberNamesArb = fc.uniqueArray(nameArb, { minLength: 1, maxLength: 4 })

const memberFromName = (name: string, publishable: boolean): Member =>
  ({
    name: PackageName.make(name),
    dir: `packages/${name}`,
    manifest: { name: PackageName.make(name), version: '0.1.0' },
    publishable,
  }) as unknown as Member

const requestArbFrom = (names: ReadonlyArray<string>) =>
  fc.record({
    packages: fc.array(
      fc.oneof(
        { arbitrary: fc.constantFrom(...names), weight: 3 },
        { arbitrary: nameArb, weight: 1 },
      ),
      { minLength: 1, maxLength: 3 },
    ),
    bump: bumpArb,
    summary: fc.stringMatching(/^[a-z]{1,12}$/),
    slug: fc.option(slugArb, { nil: undefined }),
  })

const scenarioArb = memberNamesArb.chain((names) => {
  const memberPairs = fc.array(
    fc.tuple(
      fc.constantFrom(...names),
      fc.boolean(),
    ),
    { minLength: 1 },
  )
  return fc.tuple(memberPairs, requestArbFrom(names)).map(
    ([memberPairsList, request]) => ({
      members: memberPairsList.map(([name, publishable]) => memberFromName(name, publishable)),
      request,
    }),
  )
})

const runNewIntent = (scenario: {
  members: ReadonlyArray<Member>
  request: {
    packages: ReadonlyArray<string>
    bump: string
    summary: string
    slug: string | undefined
  }
}) => {
  const fake = fakeChangesetStore()
  const program = Cell.provide(Layer.mergeAll(
    fakeWorkspaceStore(scenario.members),
    fake.layer,
  ))(newIntentCell)
  return Effect.runPromise(
    Effect.result(Cell.run(program, {
      packages: [...scenario.request.packages],
      bump: scenario.request.bump,
      summary: scenario.request.summary,
      slug: scenario.request.slug,
    })),
  ).then((outcome: Result.Result<typeof NewIntentDecision.Type, { readonly _tag: string }>) => {
    const memberNames: ReadonlyArray<string> = scenario.members.map((m) => m.name)
    const unknown = scenario.request.packages.filter((p) => !memberNames.includes(p))
    if (unknown.length > 0) {
      if (!Result.isFailure(outcome)) return false
      const failure = outcome.failure as { readonly package?: PackageName }
      return outcome.failure._tag === 'IntentUnknownPackage' &&
        failure.package === unknown[0]
    }
    if (Result.isFailure(outcome)) return false
    const decision = outcome.success
    const named = scenario.request.slug !== undefined
    const expectedTag = named ? 'IntentStagedNamed' : 'IntentStagedDerived'
    const writtenOk = fake.written.length === 1 &&
      fake.written[0].packages.join(',') === scenario.request.packages.join(',')
    return decision._tag === expectedTag && writtenOk
  })
}

describe('new-intent property', () => {
  it('stages named or derived intents and refuses unknown packages', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, (scenario) => runNewIntent(scenario)),
      { numRuns: 100 },
    )
  })
})
