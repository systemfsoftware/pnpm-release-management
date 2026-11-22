import { newIntentCell } from '@systemfsoftware/changeset-engine'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { IntentSlug, type Member, PackageName, PackageVersion, RelativePath } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import { expect } from 'vitest'
import { fakeChangesetStore } from './__fixtures__/FakeChangesetStore.js'
import { fakeWorkspaceStore } from './__fixtures__/FakeWorkspaceStore.js'

const Feature = makeFeature({ it, layer })

const member = (name: string, publishable: boolean): Member => ({
  name: PackageName.make(name),
  dir: RelativePath.make(`packages/${name}`),
  manifest: { name: PackageName.make(name), version: PackageVersion.make('0.1.0') },
  publishable,
})

const members = [member('@s/a', true), member('@s/b', false)]

const failUnexpected = (message: string): never => {
  throw new Error(message)
}

Feature('Changeset intents').body(({ scenario }) => {
  {
    const store = fakeChangesetStore()
    const live = Layer.mergeAll(fakeWorkspaceStore(members), store.layer)
    const runnable = Cell.provide(live)(newIntentCell)
    scenario(
      'A derived intent is staged and written through the store',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a workspace with two members was prepared')('setup', () => Effect.succeed({ runnable, store })),
        When('an intent without a slug is requested')('outcome', (s) =>
          Cell.run(s.setup.runnable, {
            packages: ['@s/a'],
            bump: 'patch',
            summary: 'fixes a thing',
          }).pipe(
            Effect.match({
              onFailure: (refusal) => ({ _tag: 'refused', refusal }) as const,
              onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
            }),
          )),
        Then('the intent is staged derived and the store holds one write')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) => {
              expect(decided.decision.path).toEqual('s-a.md')
            }),
            Match.orElse(() => failUnexpected('expected decided')),
          )
          expect(s.setup.store.written.length).toEqual(1)
          const first = s.setup.store.written[0]
          if (first === undefined) return failUnexpected('expected one write')
          expect(first.bump).toEqual('patch')
          expect(first.packages.join(',')).toEqual('@s/a')
        }),
      ),
    )
  }

  {
    const store = fakeChangesetStore()
    const live = Layer.mergeAll(fakeWorkspaceStore(members), store.layer)
    const runnable = Cell.provide(live)(newIntentCell)
    scenario(
      'A named intent is staged when a slug is given',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a workspace with two members was prepared')('setup', () => Effect.succeed({ runnable, store })),
        When('an intent with a slug is requested')('outcome', (s) =>
          Cell.run(s.setup.runnable, {
            packages: ['@s/a', '@s/b'],
            bump: 'minor',
            summary: 'adds a thing',
            slug: 'add-a-thing',
          }).pipe(
            Effect.match({
              onFailure: (refusal) => ({ _tag: 'refused', refusal }) as const,
              onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
            }),
          )),
        Then('the intent is staged named under the given slug')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) => {
              expect(decided.decision.path).toEqual('add-a-thing.md')
            }),
            Match.orElse(() => failUnexpected('expected decided')),
          )
          const first = s.setup.store.written[0]
          if (first === undefined) return failUnexpected('expected one write')
          expect(first.packages.join(',')).toEqual('@s/a,@s/b')
        }),
      ),
    )
  }

  {
    const store = fakeChangesetStore()
    const live = Layer.mergeAll(fakeWorkspaceStore(members), store.layer)
    const runnable = Cell.provide(live)(newIntentCell)
    scenario(
      'An unknown bump value is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a workspace with two members was prepared')('setup', () => Effect.succeed({ runnable })),
        When('an intent with an unknown bump is requested')('outcome', (s) =>
          Cell.run(s.setup.runnable, {
            packages: ['@s/a'],
            bump: 'huge',
            summary: 'x',
          }).pipe(
            Effect.match({
              onFailure: (refusal) => ({ _tag: 'refused', refusal }) as const,
              onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
            }),
          )),
        Then('the refusal reports the invalid bump')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) =>
              Match.value(refused.refusal).pipe(
                Match.tag('NewIntentInvalidBump', () => undefined),
                Match.orElse(() => failUnexpected('expected invalid bump')),
              )),
            Match.orElse(() => failUnexpected('expected refused')),
          )
        }),
      ),
    )
  }

  {
    const store = fakeChangesetStore()
    const live = Layer.mergeAll(fakeWorkspaceStore(members), store.layer)
    const runnable = Cell.provide(live)(newIntentCell)
    scenario(
      'A request without a summary is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a workspace with two members was prepared')('setup', () => Effect.succeed({ runnable })),
        When('an intent without a summary is requested')(
          'outcome',
          (s) =>
            Cell.run(s.setup.runnable, { packages: ['@s/a'], bump: 'patch' }).pipe(
              Effect.match({
                onFailure: (refusal) => ({ _tag: 'refused', refusal }) as const,
                onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
              }),
            ),
        ),
        Then('the refusal reports the missing summary')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) =>
              Match.value(refused.refusal).pipe(
                Match.tag('NewIntentSummaryMissing', () => undefined),
                Match.orElse(() => failUnexpected('expected missing summary')),
              )),
            Match.orElse(() => failUnexpected('expected refused')),
          )
        }),
      ),
    )
  }

  {
    const store = fakeChangesetStore()
    const live = Layer.mergeAll(fakeWorkspaceStore(members), store.layer)
    const runnable = Cell.provide(live)(newIntentCell)
    scenario(
      'A request naming no packages is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a workspace with two members was prepared')('setup', () => Effect.succeed({ runnable })),
        When('an intent with empty packages is requested')(
          'outcome',
          (s) =>
            Cell.run(s.setup.runnable, { packages: [], bump: 'patch', summary: 'x' }).pipe(
              Effect.match({
                onFailure: (refusal) => ({ _tag: 'refused', refusal }) as const,
                onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
              }),
            ),
        ),
        Then('the refusal reports the empty packages')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) =>
              Match.value(refused.refusal).pipe(
                Match.tag('NewIntentPackagesEmpty', () => undefined),
                Match.orElse(() => failUnexpected('expected empty packages')),
              )),
            Match.orElse(() => failUnexpected('expected refused')),
          )
        }),
      ),
    )
  }

  {
    const store = fakeChangesetStore()
    const live = Layer.mergeAll(fakeWorkspaceStore(members), store.layer)
    const runnable = Cell.provide(live)(newIntentCell)
    scenario(
      'A malformed package name is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a workspace with two members was prepared')('setup', () => Effect.succeed({ runnable })),
        When('an intent with a malformed package name is requested')('outcome', (s) =>
          Cell.run(s.setup.runnable, {
            packages: ['Bad Name'],
            bump: 'patch',
            summary: 'x',
          }).pipe(
            Effect.match({
              onFailure: (refusal) => ({ _tag: 'refused', refusal }) as const,
              onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
            }),
          )),
        Then('the refusal reports the malformed name')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) =>
              Match.value(refused.refusal).pipe(
                Match.tag('NewIntentPackageNameMalformed', () => undefined),
                Match.orElse(() => failUnexpected('expected malformed name')),
              )),
            Match.orElse(() => failUnexpected('expected refused')),
          )
        }),
      ),
    )
  }

  {
    const store = fakeChangesetStore()
    const live = Layer.mergeAll(fakeWorkspaceStore(members), store.layer)
    const runnable = Cell.provide(live)(newIntentCell)
    scenario(
      'A well-formed package outside the workspace is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a workspace with two members was prepared')('setup', () => Effect.succeed({ runnable })),
        When('an intent naming a non-member package is requested')('outcome', (s) =>
          Cell.run(s.setup.runnable, {
            packages: ['@s/a', 'not-a-member'],
            bump: 'patch',
            summary: 'x',
          }).pipe(
            Effect.match({
              onFailure: (refusal) => ({ _tag: 'refused', refusal }) as const,
              onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
            }),
          )),
        Then('the refusal names the unknown package')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) =>
              Match.value(refused.refusal).pipe(
                Match.tag('IntentUnknownPackage', (unknown) => {
                  expect(unknown.package).toEqual('not-a-member')
                }),
                Match.orElse(() => failUnexpected('expected unknown package')),
              )),
            Match.orElse(() => failUnexpected('expected refused')),
          )
        }),
      ),
    )
  }

  {
    const store = fakeChangesetStore({
      writeIntentFailure: { _tag: 'IntentSlugTaken', slug: IntentSlug.make('changeset') },
    })
    const live = Layer.mergeAll(fakeWorkspaceStore(members), store.layer)
    const runnable = Cell.provide(live)(newIntentCell)
    scenario(
      'A store refusal for a taken slug propagates to the caller',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a store that reports every slug taken was prepared')('setup', () => Effect.succeed({ runnable, store })),
        When('an intent is requested')('outcome', (s) =>
          Cell.run(s.setup.runnable, {
            packages: ['@s/a'],
            bump: 'patch',
            summary: 'x',
          }).pipe(
            Effect.match({
              onFailure: (refusal) => ({ _tag: 'refused', refusal }) as const,
              onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
            }),
          )),
        Then('the refusal reports the taken slug and the write was attempted')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) =>
              Match.value(refused.refusal).pipe(
                Match.tag('IntentSlugTaken', () => undefined),
                Match.orElse(() => failUnexpected('expected taken slug')),
              )),
            Match.orElse(() => failUnexpected('expected refused')),
          )
          expect(s.setup.store.written.length).toEqual(1)
        }),
      ),
    )
  }

  {
    const store = fakeChangesetStore()
    const live = Layer.mergeAll(fakeWorkspaceStore(members), store.layer)
    const runnable = Cell.provide(live)(newIntentCell)
    scenario(
      'Packages that slugify short still stage a derived intent',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a workspace with two members was prepared')('setup', () => Effect.succeed({ runnable })),
        When('an intent without a slug is requested')('outcome', (s) =>
          Cell.run(s.setup.runnable, {
            packages: ['@s/a'],
            bump: 'patch',
            summary: 'x',
          }).pipe(
            Effect.match({
              onFailure: (refusal) => ({ _tag: 'refused', refusal }) as const,
              onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
            }),
          )),
        Then('the intent stages derived under the slugified path')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) => {
              expect(decided.decision.path).toEqual('s-a.md')
            }),
            Match.orElse(() => failUnexpected('expected decided')),
          )
        }),
      ),
    )
  }
})
