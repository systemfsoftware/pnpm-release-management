import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect } from 'effect'
import { expect } from 'vitest'
import {
  gateReport,
  type GateRun,
  intentPath,
  intentText,
  linear,
  manifestPath,
  member,
  type Tree,
  withFiles,
} from './__fixtures__/FakeHistory.js'

const Feature = makeFeature({ it, layer })

const members = [member('a'), member('b'), member('p', false)]

const base: Tree = {
  [manifestPath('a')]: '{"name":"a"}',
  [manifestPath('b')]: '{"name":"b"}',
  [manifestPath('p')]: '{"name":"p"}',
  'packages/a/src/index.ts': 'a',
  'packages/b/src/index.ts': 'b',
  'packages/p/src/index.ts': 'p',
}

const passes = (fragment: string) => (s: { readonly report: { readonly ok: boolean; readonly text: string } }) =>
  Effect.sync(() => {
    expect(s.report.ok).toBe(true)
    expect(s.report.text).toContain(fragment)
  })

const refuses =
  (...fragments: ReadonlyArray<string>) => (s: { readonly report: { readonly ok: boolean; readonly text: string } }) =>
    Effect.sync(() => {
      expect(s.report.ok).toBe(false)
      for (const fragment of fragments) expect(s.report.text).toContain(fragment)
    })

Feature('The changeset gate accounts for every package a range moves').body(({ scenario }) => {
  scenario(
    'A change to a private package only leaves the gate vacant',
    Gherkin.Do.pipe(
      Given('a range that edits only the private package')(
        'run',
        () =>
          Effect.succeed<GateRun>({ members, history: linear(base, withFiles({ 'packages/p/src/index.ts': 'p2' })) }),
      ),
      When('the gate runs')('report', (s) => gateReport(s.run)),
      Then('it passes naming no publishable package')(passes('no publishable package changed (3 member(s))')),
    ),
  )

  scenario(
    'A deleted package needs no intent and is listed as deleted',
    Gherkin.Do.pipe(
      Given('a range whose evidence names a deleted package')(
        'run',
        () =>
          Effect.succeed<GateRun>({
            members,
            history: linear(base, withFiles({ 'README.md': 'r' })),
            deleted: ['gone'],
          }),
      ),
      When('the gate runs')('report', (s) => gateReport(s.run)),
      Then('it passes and names the deleted package')(passes('1 package(s) deleted, nothing left to release — gone')),
    ),
  )

  scenario(
    'A feature change named by a live intent passes',
    Gherkin.Do.pipe(
      Given('a commit editing a and adding an intent for it')('run', () =>
        Effect.succeed<GateRun>({
          members,
          history: linear(
            base,
            withFiles({ 'packages/a/src/index.ts': 'a2', [intentPath('y')]: intentText({ a: 'minor' }) }),
          ),
        })),
      When('the gate runs')('report', (s) => gateReport(s.run)),
      Then('it passes naming a')(passes('1 publishable package(s) changed, each accounted for — a')),
    ),
  )

  scenario(
    'A feature change no intent names is refused with guidance',
    Gherkin.Do.pipe(
      Given('a commit editing a with only an intent for b')('run', () =>
        Effect.succeed<GateRun>({
          members,
          history: linear(
            base,
            withFiles({ 'packages/a/src/index.ts': 'a2', [intentPath('y')]: intentText({ b: 'none' }) }),
          ),
        })),
      When('the gate runs')('report', (s) => gateReport(s.run)),
      Then('it refuses and shows the frontmatter to add')(refuses('no intent names: a', '"a": patch')),
    ),
  )

  scenario(
    'An intent naming a package outside the workspace is refused unless liveness is skipped',
    Gherkin.Do.pipe(
      Given('a commit adding an intent for a non-member')(
        'history',
        () => Effect.succeed(linear(base, withFiles({ [intentPath('ghost')]: intentText({ ghost: 'patch' }) }))),
      ),
      When('the gate runs with and without the liveness check')('reports', (s) =>
        Effect.all({
          checked: gateReport({ members, history: s.history }),
          skipped: gateReport({ members, history: s.history, skipLiveness: true }),
        })),
      Then('only the checked run refuses, naming the package')((s) =>
        Effect.sync(() => {
          expect(s.reports.checked.ok).toBe(false)
          expect(s.reports.checked.text).toContain('names non-member package "ghost"')
          expect(s.reports.skipped.ok).toBe(true)
        })
      ),
    ),
  )
})
