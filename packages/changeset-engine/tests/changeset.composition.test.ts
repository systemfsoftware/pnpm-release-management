import { assert, assertEquals } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { Cell } from '@systemfsoftware/effect-cell-types'
import {
  GitRef,
  type IntentSlugTaken,
  type IntentStagedDerived,
  type IntentStagedNamed,
  IntentSummary,
  type IntentUnknownPackage,
  type Member,
  type NewIntentRefusal,
  PackageName,
  RelativePath,
  RepoRoot,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Layer from 'effect/Layer'
import * as Result from 'effect/Result'
import { gateChangesCell, type GateReport, newIntentCell } from '../mod.ts'
import { fakeChangeEvidencePort } from '../src/testing/FakeChangeEvidencePort.ts'
import { fakeChangesetStore } from '../src/testing/FakeChangesetStore.ts'
import { fakeWorkspaceStore } from '../src/testing/FakeWorkspaceStore.ts'

const member = (name: string, publishable: boolean): Member =>
  ({
    name: PackageName.make(name),
    dir: `packages/${name}`,
    manifest: { name: PackageName.make(name), version: '0.1.0' },
    publishable,
  }) as unknown as Member

type IntentEntryLike = { name: PackageName; bump: 'none' | 'patch' | 'minor' | 'major' }
type IntentLike = { path: RelativePath; packages: IntentEntryLike[]; summary: IntentSummary }

const intentEntry = (name: string, bump: 'none' | 'patch' | 'minor' | 'major'): IntentEntryLike => ({
  name: PackageName.make(name),
  bump,
})

const intent = (slug: string, entries: IntentEntryLike[]): IntentLike => ({
  path: RelativePath.make(`.changeset/${slug}.md`),
  packages: entries,
  summary: IntentSummary.make('a change'),
})

const members = [member('@s/a', true), member('@s/b', false)]

const runGate = (scenario: {
  touched: ReadonlyArray<PackageName>
  intents?: ReturnType<typeof intent>[]
  skipLiveness?: boolean
}): Promise<GateReport> => {
  const program = Cell.provide(Layer.mergeAll(
    fakeWorkspaceStore(members),
    fakeChangeEvidencePort({ members, touched: scenario.touched, raw: null }),
    fakeChangesetStore({ intents: scenario.intents ?? [] }).layer,
  ))(gateChangesCell)
  return Effect.runPromise(Cell.run(program, {
    root: RepoRoot.make('/repo'),
    ref: GitRef.make('HEAD'),
    strategy: 'paths',
    skipLiveness: scenario.skipLiveness,
  }))
}

const runNewIntent = (
  input: { packages: string[]; bump?: string; summary?: string; slug?: string },
  options: { intents?: ReturnType<typeof intent>[]; writeIntentFailure?: NewIntentRefusal } = {},
) => {
  const fake = fakeChangesetStore({
    intents: options.intents ?? [],
    writeIntentFailure: options.writeIntentFailure,
  })
  const program = Cell.provide(Layer.mergeAll(
    fakeWorkspaceStore(members),
    fake.layer,
  ))(newIntentCell)
  return Effect.runPromise(
    Effect.result(Cell.run(program, input)),
  ).then((outcome) => ({ outcome, written: fake.written }))
}

describe('changeset gate composition', () => {
  it('is vacant when nothing publishable moved', async () => {
    const report = await runGate({ touched: [PackageName.make('@s/b')] })
    assertEquals(report.ok, true)
    assert(report.text.includes('no publishable package changed (2 member(s))'))
  })

  it('is satisfied when every moved publishable package is named', async () => {
    const report = await runGate({
      touched: [PackageName.make('@s/a')],
      intents: [intent('fix-a', [intentEntry('@s/a', 'patch')])],
    })
    assertEquals(report.ok, true)
    assert(report.text.includes('1 publishable package(s) changed'))
    assert(report.text.includes('@s/a'))
  })

  it('refuses with intent-missing guidance when a moved package is unnamed', async () => {
    const report = await runGate({
      touched: [PackageName.make('@s/a')],
      intents: [intent('other', [intentEntry('@s/b', 'none')])],
    })
    assertEquals(report.ok, false)
    assert(report.text.includes('no intent names: @s/a'))
    assert(report.text.includes('"@s/a": patch'))
  })

  it('refuses an intent naming a non-member package', async () => {
    const report = await runGate({
      touched: [],
      intents: [intent('ghost', [intentEntry('ghost-pkg', 'patch')])],
    })
    assertEquals(report.ok, false)
    assert(report.text.includes('names non-member package "ghost-pkg"'))
  })

  it('skips the liveness check when asked', async () => {
    const report = await runGate({
      touched: [],
      intents: [intent('ghost', [intentEntry('ghost-pkg', 'patch')])],
      skipLiveness: true,
    })
    assertEquals(report.ok, true)
    assert(report.text.includes('no publishable package changed'))
  })
})

describe('new intent composition', () => {
  it('stages a derived intent and writes it through the store', async () => {
    const { outcome, written } = await runNewIntent({
      packages: ['@s/a'],
      bump: 'patch',
      summary: 'fixes a thing',
    })
    assert(Result.isSuccess(outcome))
    assertEquals(outcome.success._tag, 'IntentStagedDerived')
    assertEquals(written.length, 1)
    assertEquals(written[0].bump, 'patch')
    assertEquals(written[0].packages.join(','), '@s/a')
  })

  it('stages a named intent when a slug is given', async () => {
    const { outcome, written } = await runNewIntent({
      packages: ['@s/a', '@s/b'],
      bump: 'minor',
      summary: 'adds a thing',
      slug: 'add-a-thing',
    })
    assert(Result.isSuccess(outcome))
    assertEquals(outcome.success._tag, 'IntentStagedNamed')
    assertEquals((outcome.success as IntentStagedNamed).path, 'add-a-thing.md')
    assertEquals(written[0].packages.join(','), '@s/a,@s/b')
  })

  it('refuses an invalid bump', async () => {
    const { outcome } = await runNewIntent({
      packages: ['@s/a'],
      bump: 'huge',
      summary: 'x',
    })
    assert(Result.isFailure(outcome))
    assertEquals(outcome.failure._tag, 'NewIntentInvalidBump')
  })

  it('refuses a missing summary', async () => {
    const { outcome } = await runNewIntent({ packages: ['@s/a'], bump: 'patch' })
    assert(Result.isFailure(outcome))
    const failure = outcome.failure as NewIntentRefusal
    assertEquals(failure._tag, 'NewIntentSummaryMissing')
  })

  it('refuses empty packages', async () => {
    const { outcome } = await runNewIntent({ packages: [], bump: 'patch', summary: 'x' })
    assert(Result.isFailure(outcome))
    assertEquals(outcome.failure._tag, 'NewIntentPackagesEmpty')
  })

  it('refuses a malformed package name', async () => {
    const { outcome } = await runNewIntent({
      packages: ['Bad Name'],
      bump: 'patch',
      summary: 'x',
    })
    assert(Result.isFailure(outcome))
    assertEquals(outcome.failure._tag, 'NewIntentPackageNameMalformed')
  })

  it('refuses a well-formed non-member package', async () => {
    const { outcome } = await runNewIntent({
      packages: ['@s/a', 'not-a-member'],
      bump: 'patch',
      summary: 'x',
    })
    assert(Result.isFailure(outcome))
    const failure = outcome.failure as IntentUnknownPackage
    assertEquals(failure._tag, 'IntentUnknownPackage')
    assertEquals(failure.package, 'not-a-member')
  })

  it('propagates a store refusal for a taken slug', async () => {
    const { outcome, written } = await runNewIntent({
      packages: ['@s/a'],
      bump: 'patch',
      summary: 'x',
    }, { writeIntentFailure: { _tag: 'IntentSlugTaken', slug: 'changeset' } as IntentSlugTaken })
    assert(Result.isFailure(outcome))
    assertEquals(outcome.failure._tag, 'IntentSlugTaken')
    assertEquals(written.length, 1)
  })

  it('derives a fallback name when the packages slugify empty', async () => {
    const { outcome } = await runNewIntent({
      packages: ['@s/a'],
      bump: 'patch',
      summary: 'x',
    })
    assert(Result.isSuccess(outcome))
    assertEquals((outcome.success as IntentStagedDerived).path, 's-a.md')
  })
})
