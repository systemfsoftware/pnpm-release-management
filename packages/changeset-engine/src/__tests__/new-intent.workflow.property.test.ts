import { it } from '@effect/vitest'
import { newIntentCell } from '@systemfsoftware/changeset-engine'
import { Cell } from '@systemfsoftware/effect-cell-types'
import type { Member } from '@systemfsoftware/release-language'
import { PackageName as PackageNameSchema } from '@systemfsoftware/release-language'
import { PackageVersion } from '@systemfsoftware/release-language'
import { RelativePath } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as fc from 'effect/testing/FastCheck'
import { fakeChangesetStore } from '../../tests/__fixtures__/FakeChangesetStore.js'
import { fakeWorkspaceStore } from '../../tests/__fixtures__/FakeWorkspaceStore.js'

const nameArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,9}$/)
const slugArb = fc.stringMatching(/^[a-z0-9]+(-[a-z0-9]+)*$/)
const bumpArb = fc.constantFrom('none', 'patch', 'minor', 'major')

const memberNamesArb = fc.uniqueArray(nameArb, { minLength: 1, maxLength: 4 })

const memberFromName = (name: string, publishable: boolean): Member => ({
  name: PackageNameSchema.make(name),
  dir: RelativePath.make(`packages/${name}`),
  manifest: { name: PackageNameSchema.make(name), version: PackageVersion.make('0.1.0') },
  publishable,
})

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

const newIntentEffect = (scenario: {
  members: ReadonlyArray<Member>
  request: {
    packages: ReadonlyArray<string>
    bump: string
    summary: string
    slug: string | undefined
  }
}): Effect.Effect<boolean> => {
  const fake = fakeChangesetStore()
  const program = Cell.provide(Layer.mergeAll(
    fakeWorkspaceStore(scenario.members),
    fake.layer,
  ))(newIntentCell)
  return Effect.map(
    Effect.result(Cell.run(program, {
      packages: [...scenario.request.packages],
      bump: scenario.request.bump,
      summary: scenario.request.summary,
      slug: scenario.request.slug,
    })),
    (outcome) => {
      const memberNames: ReadonlyArray<string> = scenario.members.map((m) => m.name)
      const unknown = scenario.request.packages.filter((p) => !memberNames.includes(p))
      if (unknown.length > 0) {
        if (Result.isSuccess(outcome)) return false
        return Match.value(outcome.failure).pipe(
          Match.tag('IntentUnknownPackage', (failure) => failure.package === unknown[0]),
          Match.orElse(() => false),
        )
      }
      if (Result.isFailure(outcome)) return false
      const first = fake.written[0]
      const writtenOk = fake.written.length === 1 && first !== undefined &&
        first.packages.join(',') === scenario.request.packages.join(',')
      if (scenario.request.slug !== undefined) {
        return outcome.success.path === `${scenario.request.slug}.md` && writtenOk
      }
      return writtenOk
    },
  )
}

it.effect.prop(
  '∀request_NewIntent_=ExpectedStage',
  [scenarioArb],
  ([scenario]) => newIntentEffect(scenario),
)
