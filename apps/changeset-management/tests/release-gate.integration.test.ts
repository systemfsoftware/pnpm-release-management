import { NodeServices } from '@effect/platform-node'
import { ChangesetsPortLive } from '@systemfsoftware/changesets-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { ReleaseConfigStore, RepoRoot } from '@systemfsoftware/release-language'
import { bumpCell, bumpInputOf } from '@systemfsoftware/version-engine'
import {
  ChangelogStoreLive,
  ChangesetStoreLive,
  ReleaseConfigStoreLive,
  SurfaceStoreLive,
  WorkspaceStoreLive,
} from '@systemfsoftware/workspace-adapter'
import { Effect, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import * as Stream from 'effect/Stream'
import { ChildProcess } from 'effect/unstable/process'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const CLI = new URL('../dist/main.js', import.meta.url).pathname

const IDENTITY = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false']

const run = (cwd: string, program: string, args: ReadonlyArray<string>) =>
  Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* ChildProcess.make(program, args, {
        cwd,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [stdout, stderr, code] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText, Stream.mkString),
          handle.stderr.pipe(Stream.decodeText, Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: 3 },
      )
      return { code, stdout, stderr }
    }),
  )

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  Effect.flatMap(run(cwd, 'git', [...IDENTITY, ...args]), (out) => {
    if (out.code !== 0) return Effect.die(new Error(`git ${args.join(' ')} exited ${out.code}: ${out.stderr}`))
    return Effect.succeed(out.stdout.trim())
  })

const intent = (entries: Readonly<Record<string, string>>, summary = 'Fixes a thing.') =>
  ['---', ...Object.entries(entries).map(([name, bump]) => `"${name}": ${bump}`), '---', '', summary, ''].join('\n')

const manifest = (name: string) => `${JSON.stringify({ name, version: '1.0.0', main: 'index.js' }, null, 2)}\n`

const RELEASE_CONFIG = `${
  JSON.stringify(
    {
      base: 'main',
      branch: 'changeset-release/main',
      versioning: { strategy: 'changesets' },
      gate: { strategy: 'paths' },
    },
    null,
    2,
  )
}\n`

const BASE_FILES: ReadonlyArray<readonly [string, string]> = [
  ['package.json', '{\n  "name": "@t/root",\n  "private": true\n}\n'],
  ['pnpm-workspace.yaml', 'packages:\n  - packages/*\n'],
  ['release.jsonc', RELEASE_CONFIG],
  ['packages/a/package.json', manifest('@t/a')],
  ['packages/a/index.js', 'export const a = 1\n'],
  ['packages/b/package.json', manifest('@t/b')],
  ['packages/b/index.js', 'export const b = 1\n'],
  ['.changeset/README.md', '# Changesets\n'],
  ['.changeset/AGENTS.md', '# Agent notes\n'],
]

const write = (root: string, files: ReadonlyArray<readonly [string, string]>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    yield* Effect.forEach(files, ([file, text]) =>
      Effect.gen(function*() {
        yield* fs.makeDirectory(path.dirname(path.join(root, file)), { recursive: true })
        yield* fs.writeFileString(path.join(root, file), text)
      }), { discard: true })
  })

const commitAll = (root: string, message: string) =>
  Effect.gen(function*() {
    yield* git(root, 'add', '-A')
    yield* git(root, 'commit', '-q', '--allow-empty', '-m', message)
    return yield* git(root, 'rev-parse', 'HEAD')
  })

const repository = (pending: ReadonlyArray<readonly [string, string]>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'changeset-management-gate-' })
    yield* git(root, 'init', '-q', '-b', 'main')
    yield* write(root, BASE_FILES)
    yield* commitAll(root, 'base')
    yield* write(root, pending)
    yield* commitAll(root, 'pending intents')
    return root
  })

const storesAt = (root: RepoRoot) =>
  Effect.gen(function*() {
    const configs = yield* ReleaseConfigStore
    const release = yield* configs.loadConfig(root)
    return {
      release,
      layer: Layer.mergeAll(
        WorkspaceStoreLive(root),
        SurfaceStoreLive(root),
        ChangelogStoreLive(root),
        ChangesetsPortLive({ root, base: release.base }),
        ChangesetStoreLive({ root, changesetDir: release.changesetDir }),
      ),
    }
  }).pipe(Effect.provide(ReleaseConfigStoreLive))

const versionPending = (root: string) =>
  Effect.gen(function*() {
    const stores = yield* storesAt(RepoRoot.make(root))
    yield* Cell.run(Cell.provide(bumpCell, stores.layer), bumpInputOf(stores.release))
  })

const releaseBranch = (root: string, from: string, edit: Effect.Effect<void, never, FileSystem | Path> = Effect.void) =>
  Effect.gen(function*() {
    yield* git(root, 'checkout', '-q', '-B', 'changeset-release/main', from)
    yield* versionPending(root)
    yield* edit
    return yield* commitAll(root, 'chore(release): version packages')
  })

const queueDraft = (root: string, main: string, ...heads: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    yield* git(root, 'checkout', '-q', '-B', 'mergify/merge-queue/0123abcd', main)
    for (const head of heads) yield* git(root, 'merge', '-q', '--no-ff', '--no-edit', head)
    return yield* git(root, 'rev-parse', 'HEAD')
  })

const gate = (root: string, base: string) =>
  Effect.map(run(root, 'node', [CLI, 'check', base]), (out) => ({
    ok: out.code === 0,
    text: `${out.stdout}${out.stderr}`,
  }))

const PENDING = [['.changeset/fix-a.md', intent({ '@t/a': 'patch' })]] as const

const passes =
  (...fragments: ReadonlyArray<string>) => (s: { readonly report: { readonly ok: boolean; readonly text: string } }) =>
    Effect.sync(() => {
      expect(s.report.text).not.toContain('::error')
      expect(s.report.ok).toBe(true)
      for (const fragment of fragments) expect(s.report.text).toContain(fragment)
    })

const refuses =
  (...fragments: ReadonlyArray<string>) => (s: { readonly report: { readonly ok: boolean; readonly text: string } }) =>
    Effect.sync(() => {
      expect(s.report.ok).toBe(false)
      for (const fragment of fragments) expect(s.report.text).toContain(fragment)
    })

const edited = (file: string, change: (text: string) => string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    yield* fs.writeFileString(file, change(yield* fs.readFileString(file)))
  }).pipe(Effect.orDie)

Feature('The changeset gate re-derives release commits in a real repository').body(({ scenario }) => {
  scenario(
    'A queue draft holding the real release commit passes on a merge-queue branch',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a main with a pending intent and a queue draft merging the release commit the bump wrote')(
        'root',
        () =>
          Effect.gen(function*() {
            const root = yield* repository(PENDING)
            const release = yield* releaseBranch(root, 'main')
            yield* queueDraft(root, 'main', release)
            return root
          }),
      ),
      When('the gate checks the draft against main')('report', (s) => gate(s.root, 'main')),
      Then('it passes naming the released package')(passes('released by a verified release commit — @t/a')),
    ),
  )

  scenario(
    'A release commit whose bumped manifest gains a bin entry is refused naming the manifest',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a release commit that also adds a bin entry to the bumped manifest')('root', () =>
        Effect.gen(function*() {
          const root = yield* repository(PENDING)
          yield* releaseBranch(
            root,
            'main',
            edited(`${root}/packages/a/package.json`, (text) => text.replace('"main"', '"bin": "cli.js",\n  "main"')),
          )
          return root
        })),
      When('the gate checks the release branch against main')('report', (s) => gate(s.root, 'main')),
      Then('it refuses naming the manifest')(refuses('is not what the bump writes', 'packages/a/package.json')),
    ),
  )

  scenario(
    'A release commit that deletes a two-package intent but bumps one package is refused',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('an intent for both packages, consumed by a commit that bumps only a')(
        'root',
        () =>
          Effect.gen(function*() {
            const root = yield* repository([['.changeset/fix-ab.md', intent({ '@t/a': 'patch', '@t/b': 'patch' })]])
            yield* git(root, 'checkout', '-q', '-B', 'changeset-release/main', 'main')
            yield* write(root, [['.changeset/fix-ab.md', intent({ '@t/a': 'patch' })]])
            yield* versionPending(root)
            yield* commitAll(root, 'chore(release): version packages')
            return root
          }),
      ),
      When('the gate checks the release branch against main')('report', (s) => gate(s.root, 'main')),
      Then('it refuses naming the manifest the bump would have written')(refuses('packages/b/package.json')),
    ),
  )

  scenario(
    'A release commit carrying a workflow file is refused naming the file',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a release commit that also adds a workflow')('root', () =>
        Effect.gen(function*() {
          const root = yield* repository(PENDING)
          yield* releaseBranch(
            root,
            'main',
            write(root, [['.github/workflows/ci.yml', 'on: push\n']]).pipe(Effect.orDie),
          )
          return root
        })),
      When('the gate checks the release branch against main')('report', (s) => gate(s.root, 'main')),
      Then('it refuses naming the workflow')(refuses('.github/workflows/ci.yml')),
    ),
  )

  scenario(
    'Moving an intent, rewriting it across commits, and deleting the agent notes all pass',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a branch that deletes fix-a, then writes it back under another name, then deletes AGENTS.md')(
        'root',
        () =>
          Effect.gen(function*() {
            const root = yield* repository(PENDING)
            yield* git(root, 'checkout', '-q', '-b', 'feature')
            yield* git(root, 'rm', '-q', '.changeset/fix-a.md')
            yield* commitAll(root, 'drop the intent for now')
            yield* write(root, [['.changeset/fix-a-moved.md', intent({ '@t/a': 'minor' }, 'Rewritten.')]])
            yield* commitAll(root, 'write it back')
            yield* git(root, 'rm', '-q', '.changeset/AGENTS.md')
            yield* commitAll(root, 'drop the agent notes')
            return root
          }),
      ),
      When('the gate checks the branch against main')('report', (s) => gate(s.root, 'main')),
      Then('it passes and names no release')((s) =>
        Effect.gen(function*() {
          yield* passes('no publishable package changed')(s)
          expect(s.report.text).not.toContain('released by')
        })
      ),
    ),
  )

  scenario(
    'A release commit consuming an intent that does not parse is refused as unreplayable',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a malformed pending intent and a commit that deletes it')('root', () =>
        Effect.gen(function*() {
          const root = yield* repository([['.changeset/bad.md', '---\n"@t/a": patch\n\nno closing fence\n']])
          yield* git(root, 'checkout', '-q', '-B', 'changeset-release/main', 'main')
          yield* git(root, 'rm', '-q', '.changeset/bad.md')
          yield* write(root, [['packages/a/package.json', manifest('@t/a').replace('1.0.0', '1.0.1')]])
          yield* commitAll(root, 'chore(release): version packages')
          return root
        })),
      When('the gate checks the release branch against main')('report', (s) => gate(s.root, 'main')),
      Then('it refuses because the bump cannot replay it')(refuses('the bump cannot replay it')),
    ),
  )

  scenario(
    'A queue draft batching a feature with its intent and the release passes, and without the intent is refused',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a release commit and two feature branches editing a, one with an intent and one without')(
        'root',
        () =>
          Effect.gen(function*() {
            const root = yield* repository(PENDING)
            const release = yield* releaseBranch(root, 'main')
            yield* git(root, 'checkout', '-q', '-b', 'named', 'main')
            yield* write(root, [
              ['packages/a/index.js', 'export const a = 2\n'],
              ['.changeset/feat-a.md', intent({ '@t/a': 'minor' })],
            ])
            const named = yield* commitAll(root, 'feat: a, named')
            yield* git(root, 'checkout', '-q', '-b', 'unnamed', 'main')
            yield* write(root, [['packages/a/index.js', 'export const a = 3\n']])
            const unnamed = yield* commitAll(root, 'feat: a, unnamed')
            return { root, release, named, unnamed }
          }),
      ),
      When('the gate checks each draft against main')('reports', (s) =>
        Effect.gen(function*() {
          yield* queueDraft(s.root.root, 'main', s.root.named, s.root.release)
          const named = yield* gate(s.root.root, 'main')
          yield* queueDraft(s.root.root, 'main', s.root.unnamed, s.root.release)
          const unnamed = yield* gate(s.root.root, 'main')
          return { named, unnamed }
        })),
      Then('the named draft passes and the unnamed draft is refused naming a')((s) =>
        Effect.gen(function*() {
          yield* passes('each accounted for — @t/a')({ report: s.reports.named })
          yield* refuses('no intent names: @t/a')({ report: s.reports.unnamed })
        })
      ),
    ),
  )

  scenario(
    'A release cut before main changed a manifest is refused as stale',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a release commit cut from an older main, and a main that has since edited b and named it')(
        'root',
        () =>
          Effect.gen(function*() {
            const root = yield* repository(PENDING)
            const release = yield* releaseBranch(root, 'main')
            yield* git(root, 'checkout', '-q', 'main')
            yield* write(root, [
              ['packages/b/package.json', manifest('@t/b').replace('"main"', '"type": "module",\n  "main"')],
              ['.changeset/fix-b.md', intent({ '@t/b': 'patch' })],
            ])
            yield* commitAll(root, 'feat: b is a module')
            yield* queueDraft(root, 'main', release)
            return root
          }),
      ),
      When('the gate checks the draft against main')('report', (s) => gate(s.root, 'main')),
      Then('it refuses naming the manifest that moved under it')(
        refuses('cut from an older base', 'packages/b/package.json'),
      ),
    ),
  )
})
