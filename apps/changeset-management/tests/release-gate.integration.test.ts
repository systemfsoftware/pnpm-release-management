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

const releaseBranch = (root: string, from: string) =>
  Effect.gen(function*() {
    yield* git(root, 'checkout', '-q', '-B', 'changeset-release/main', from)
    yield* versionPending(root)
    return yield* commitAll(root, 'chore(release): version packages')
  })

const queueDraft = (root: string, main: string, head: string) =>
  Effect.gen(function*() {
    yield* git(root, 'checkout', '-q', '-B', 'mergify/merge-queue/0123abcd', main)
    yield* git(root, 'merge', '-q', '--no-ff', '--no-edit', head)
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
})
