import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { TurboComparison, TurboRun } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import { expect } from 'vitest'
import {
  type FakeHistory,
  gateReport,
  type GateRun,
  intentPath,
  intentText,
  linear,
  manifestPath,
  member,
  modelRelease,
  released,
  steps,
  type Tree,
  withFiles,
  without,
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

const pending: Tree = { ...base, [intentPath('x')]: intentText({ a: 'patch' }) }

const draftMerging = (main: Tree, feature: (tree: Tree) => Tree, release: (tree: Tree) => Tree): FakeHistory => {
  const f1 = feature(main)
  const r1 = release(main)
  const paths = [...new Set([...Object.keys(f1), ...Object.keys(r1), ...Object.keys(main)])]
  const sideOf = (path: string): Tree => {
    if (r1[path] !== main[path]) return r1
    return f1
  }
  const draft = Object.fromEntries(paths.flatMap((path) => {
    const value = sideOf(path)[path]
    if (value === undefined) return []
    return [[path, value]]
  }))
  return {
    mergeBase: 'm0',
    commits: [
      { sha: 'm0', parents: [], tree: main },
      { sha: 'f1', parents: ['m0'], tree: f1 },
      { sha: 'r1', parents: ['m0'], tree: r1 },
      { sha: 'q1', parents: ['f1', 'r1'], tree: draft },
    ],
    range: ['f1', 'r1', 'q1'],
  }
}

const turboRun = (
  tasks: ReadonlyArray<readonly [string, string, ReadonlyArray<string>]>,
  globalFiles: Readonly<Record<string, string>> = {},
): TurboRun => ({
  tasks: tasks.map(([name, hash, dependencies]) => ({
    taskId: `${name}#build`,
    package: name,
    hash,
    dependencies: dependencies.map((dependency) => `${dependency}#build`),
    inputs: {},
    externalHash: 'ext',
  })),
  globalFiles: { ...globalFiles },
  globalOther: '{}',
})

const comparison = (before: TurboRun, after: TurboRun): TurboComparison => ({
  task: 'build',
  base: before,
  head: after,
})

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

  scenario(
    'A release commit that is exactly the bump of its intents passes on any branch',
    Gherkin.Do.pipe(
      Given('a range holding only the release commit for intent x')(
        'run',
        () => Effect.succeed<GateRun>({ members, history: linear(pending, released(intentPath('x'))) }),
      ),
      When('the gate runs')('report', (s) => gateReport(s.run)),
      Then('it passes and names a as released')(passes('1 package(s) released by a verified release commit — a')),
    ),
  )

  scenario(
    'A release commit that also edits the bumped manifest is refused naming it',
    Gherkin.Do.pipe(
      Given('a release commit whose manifest for a also gains a bin entry')('run', () =>
        Effect.succeed<GateRun>({
          members,
          history: linear(
            pending,
            steps(released(intentPath('x')), (tree) => ({
              ...tree,
              [manifestPath('a')]: `${tree[manifestPath('a')] ?? ''} bin`,
            })),
          ),
        })),
      When('the gate runs')('report', (s) => gateReport(s.run)),
      Then('it refuses naming the manifest')(refuses('is not what the bump writes', manifestPath('a'))),
    ),
  )

  scenario(
    'A release commit that consumes an intent but bumps only one of its packages is refused',
    Gherkin.Do.pipe(
      Given('an intent for a and b, and a commit deleting it while bumping only a')(
        'run',
        () =>
          Effect.succeed<GateRun>({
            members,
            history: linear(
              { ...base, [intentPath('x')]: intentText({ a: 'patch', b: 'patch' }) },
              (tree) => ({
                ...modelRelease({ ...tree, [intentPath('x')]: intentText({ a: 'patch' }) }, [intentPath('x')]),
              }),
            ),
          }),
      ),
      When('the gate runs')('report', (s) => gateReport(s.run)),
      Then('it refuses naming the manifest the bump would have written')(refuses(manifestPath('b'))),
    ),
  )

  scenario(
    'A release commit carrying an unrelated file is refused naming the file',
    Gherkin.Do.pipe(
      Given('a release commit that also adds a workflow')('run', () =>
        Effect.succeed<GateRun>({
          members,
          history: linear(
            pending,
            steps(released(intentPath('x')), withFiles({ '.github/workflows/ci.yml': 'on: push' })),
          ),
        })),
      When('the gate runs')('report', (s) => gateReport(s.run)),
      Then('it refuses naming the workflow')(refuses('.github/workflows/ci.yml')),
    ),
  )

  scenario(
    'A moved intent is an intent edit, not a release, and passes',
    Gherkin.Do.pipe(
      Given('a commit renaming intent x to x-moved')('run', () =>
        Effect.succeed<GateRun>({
          members,
          history: linear(
            pending,
            steps(without(intentPath('x')), withFiles({ [intentPath('x-moved')]: intentText({ a: 'patch' }) })),
          ),
        })),
      When('the gate runs')('report', (s) => gateReport(s.run)),
      Then('it passes')(passes('no publishable package changed')),
    ),
  )

  scenario(
    'Deleting a pending intent outside a release commit is refused naming what it owed',
    Gherkin.Do.pipe(
      Given('a feature commit that edits b and deletes intent x')('run', () =>
        Effect.succeed<GateRun>({
          members,
          history: linear(
            pending,
            steps(
              without(intentPath('x')),
              withFiles({ 'packages/b/src/index.ts': 'b2', [intentPath('y')]: intentText({ b: 'patch' }) }),
            ),
          ),
        })),
      When('the gate runs')('report', (s) => gateReport(s.run)),
      Then('it refuses naming a, its bump and the intent')(
        refuses('drops releases', 'a: patch owed by .changeset/x.md'),
      ),
    ),
  )

  scenario(
    'A changed merge-base intent that does not parse at the merge base is refused by path',
    Gherkin.Do.pipe(
      Given('a malformed intent at the merge base that the range rewrites')('run', () =>
        Effect.succeed<GateRun>({
          members,
          history: linear(
            { ...base, [intentPath('broken')]: '---\n"a": patch\n' },
            withFiles({ [intentPath('broken')]: intentText({ a: 'patch' }) }),
          ),
        })),
      When('the gate runs')('report', (s) => gateReport(s.run)),
      Then('it refuses naming the intent')(refuses('.changeset/broken.md is changed or deleted here')),
    ),
  )

  scenario(
    'A queue draft batching a named feature change with the release passes',
    Gherkin.Do.pipe(
      Given('a draft merging a feature commit with its own intent and the release commit for a')(
        'run',
        () =>
          Effect.succeed<GateRun>({
            members,
            history: draftMerging(
              pending,
              withFiles({ 'packages/a/src/index.ts': 'a2', [intentPath('y')]: intentText({ a: 'minor' }) }),
              released(intentPath('x')),
            ),
          }),
      ),
      When('the gate runs')('report', (s) => gateReport(s.run)),
      Then('it passes')(passes('each accounted for — a')),
    ),
  )

  scenario(
    'A queue draft batching an unnamed feature change with the release is refused',
    Gherkin.Do.pipe(
      Given('a draft merging a feature commit with no intent and the release commit for a')(
        'run',
        () =>
          Effect.succeed<GateRun>({
            members,
            history: draftMerging(pending, withFiles({ 'packages/a/src/index.ts': 'a2' }), released(intentPath('x'))),
          }),
      ),
      When('the gate runs')('report', (s) => gateReport(s.run)),
      Then('it refuses naming a')(refuses('no intent names: a')),
    ),
  )

  scenario(
    'Under turbo, a package moved only by a named upstream passes without its own intent',
    Gherkin.Do.pipe(
      Given('a change to a that b depends on, with an intent for a')('run', () =>
        Effect.succeed<GateRun>({
          members,
          strategy: 'turbo',
          history: linear(
            base,
            withFiles({ 'packages/a/src/index.ts': 'a2', [intentPath('y')]: intentText({ a: 'patch' }) }),
          ),
          turbo: comparison(
            turboRun([['a', 'a1', []], ['b', 'b1', ['a']], ['p', 'p1', []]]),
            turboRun([['a', 'a2', []], ['b', 'b2', ['a']], ['p', 'p1', []]]),
          ),
        })),
      When('the gate runs')('report', (s) => gateReport(s.run)),
      Then('it passes naming both')(passes('2 publishable package(s) changed, each accounted for — a, b')),
    ),
  )

  scenario(
    'Under turbo, a package moved by an unnamed private upstream is refused',
    Gherkin.Do.pipe(
      Given('a change to private p that b depends on, with no intent')('run', () =>
        Effect.succeed<GateRun>({
          members,
          strategy: 'turbo',
          history: linear(base, withFiles({ 'packages/p/src/index.ts': 'p2' })),
          turbo: comparison(
            turboRun([['a', 'a1', []], ['b', 'b1', ['p']], ['p', 'p1', []]]),
            turboRun([['a', 'a1', []], ['b', 'b2', ['p']], ['p', 'p2', []]]),
          ),
        })),
      When('the gate runs')('report', (s) => gateReport(s.run)),
      Then('it refuses naming b')(refuses('no intent names: b')),
    ),
  )

  scenario(
    'Under turbo, a global input changed by a feature commit moves every package and is refused',
    Gherkin.Do.pipe(
      Given('a change to a global input that moves a and b')('run', () =>
        Effect.succeed<GateRun>({
          members,
          strategy: 'turbo',
          history: linear(base, withFiles({ 'tsconfig.base.json': '{}' })),
          turbo: comparison(
            turboRun([['a', 'a1', []], ['b', 'b1', []]], {}),
            turboRun([['a', 'a2', []], ['b', 'b2', []]], { 'tsconfig.base.json': 'h' }),
          ),
        })),
      When('the gate runs')('report', (s) => gateReport(s.run)),
      Then('it refuses naming both')(refuses('no intent names: a, b')),
    ),
  )

  scenario(
    'Under turbo, a global input changed only by the release commit moves nothing that needs naming',
    Gherkin.Do.pipe(
      Given('a release commit plus a feature change to private p, while b moves without owning a change')(
        'run',
        () =>
          Effect.succeed<GateRun>({
            members,
            strategy: 'turbo',
            history: linear(pending, released(intentPath('x')), withFiles({ 'packages/p/src/index.ts': 'p2' })),
            turbo: comparison(
              turboRun([['a', 'a1', []], ['b', 'b1', []], ['p', 'p1', []]], { [manifestPath('a')]: 'v1' }),
              turboRun([['a', 'a2', []], ['b', 'b2', []], ['p', 'p2', []]], { [manifestPath('a')]: 'v2' }),
            ),
          }),
      ),
      When('the gate runs')('report', (s) => gateReport(s.run)),
      Then('it passes')(passes('released by a verified release commit — a')),
    ),
  )

  scenario(
    'A merge that edits a package file neither parent changed makes the package need an intent',
    Gherkin.Do.pipe(
      Given('a queue draft whose merge commit also edits b')('run', () =>
        Effect.sync(() => {
          const history = draftMerging(pending, withFiles({ 'README.md': 'r' }), released(intentPath('x')))
          const commits = history.commits.map((commit) => {
            if (commit.sha !== 'q1') return commit
            return { ...commit, tree: { ...commit.tree, 'packages/b/src/index.ts': 'b-in-merge' } }
          })
          return { members, history: { ...history, commits } } satisfies GateRun
        })),
      When('the gate runs')('report', (s) => gateReport(s.run)),
      Then('it refuses naming b')(refuses('no intent names: b')),
    ),
  )
})
