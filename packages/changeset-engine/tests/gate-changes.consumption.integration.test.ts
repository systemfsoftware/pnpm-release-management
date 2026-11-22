import { NodeServices } from '@effect/platform-node'
import { gateChangesCell, type GateReport } from '@systemfsoftware/changeset-engine'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { Gherkin, Given, it, layer, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { ChangeEvidenceLive } from '@systemfsoftware/process-adapter'
import {
  GitPort,
  GitRef,
  type Member,
  PackageName,
  PackageVersion,
  RelativePath,
  RepoRoot,
} from '@systemfsoftware/release-language'
import { Effect, Layer, Stream } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient'
import { ChildProcess } from 'effect/unstable/process'
import { expect } from 'vitest'
import { fakeChangesetStore } from './__fixtures__/FakeChangesetStore.js'
import { fakeWorkspaceStore } from './__fixtures__/FakeWorkspaceStore.js'

const Feature = makeFeature({ it, layer })

const NAME = PackageName.make('@t/pkg')
const DIR = RelativePath.make('packages/pkg')
const CHANGESET = '.changeset/order-rows.md'
const CHANGESET_DIR = RelativePath.make('.changeset')

const members: ReadonlyArray<Member> = [
  {
    name: NAME,
    dir: DIR,
    manifest: { name: NAME, version: PackageVersion.make('0.7.1') },
    publishable: true,
  },
]

const manifest = (version: string): string => JSON.stringify({ name: NAME, version, private: false }, null, 2)

const intent = (): string => `---\n"${NAME}": patch\n---\n\nOrder rows by the source their query reads.\n`

const GIT_IDENTITY: ReadonlyArray<string> = [
  '-c',
  'commit.gpgsign=false',
  '-c',
  'user.name=t',
  '-c',
  'user.email=t@example.invalid',
]

const gitOutput = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.scoped(Effect.gen(function*() {
    const handle = yield* ChildProcess.make('git', [...GIT_IDENTITY, ...args], { cwd })
    const out = yield* Stream.mkString(Stream.decodeText(handle.stdout))
    const code = yield* handle.exitCode
    if (code !== 0) return yield* Effect.die(new Error(`git ${args.join(' ')} exited ${code}`))
    return out
  })).pipe(Effect.provide(NodeServices.layer))

const git = (cwd: string, ...args: ReadonlyArray<string>) => Effect.asVoid(gitOutput(cwd, args))

const write = (root: string, file: string, text: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    yield* fs.makeDirectory(path.dirname(path.join(root, file)), { recursive: true })
    yield* fs.writeFileString(path.join(root, file), text)
  }).pipe(Effect.provide(NodeServices.layer))

const remove = (root: string, file: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    yield* fs.remove(path.join(root, file))
  }).pipe(Effect.provide(NodeServices.layer))

const repository = (shape: (root: string) => Effect.Effect<void, unknown>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const found = yield* fs.makeTempDirectory({ prefix: 'gate-consumption-' })
    yield* write(found, 'packages/pkg/package.json', manifest('0.7.0'))
    yield* write(found, 'packages/pkg/CHANGELOG.md', '# Changelog\n')
    yield* write(found, 'packages/pkg/index.ts', 'export const value = 1\n')
    yield* write(found, CHANGESET, intent())
    yield* git(found, 'init', '-q', '-b', 'main')
    yield* git(found, 'add', '-A')
    yield* git(found, 'commit', '-q', '-m', 'base')
    yield* git(found, 'tag', 'base')
    yield* shape(found)
    yield* git(found, 'add', '-A')
    yield* git(found, 'commit', '-q', '-m', 'head')
    return found
  }).pipe(Effect.provide(NodeServices.layer))

const releaseShaped = (root: string) =>
  Effect.gen(function*() {
    yield* remove(root, '.changeset/order-rows.md')
    yield* write(root, 'packages/pkg/package.json', manifest('0.7.1'))
    yield* write(
      root,
      'packages/pkg/CHANGELOG.md',
      '# Changelog\n\n## 0.7.1\n\nOrder rows by the source their query reads.\n',
    )
  }).pipe(Effect.provide(NodeServices.layer))

const bumpOnly = (root: string) =>
  Effect.gen(function*() {
    yield* write(root, 'packages/pkg/package.json', manifest('0.7.1'))
    yield* write(
      root,
      'packages/pkg/CHANGELOG.md',
      '# Changelog\n\n## 0.7.1\n\nA version without an intent.\n',
    )
  }).pipe(Effect.provide(NodeServices.layer))

const bumpAndSource = (root: string) =>
  Effect.gen(function*() {
    yield* remove(root, '.changeset/order-rows.md')
    yield* write(root, 'packages/pkg/package.json', manifest('0.7.1'))
    yield* write(
      root,
      'packages/pkg/CHANGELOG.md',
      '# Changelog\n\n## 0.7.1\n\nOrder rows by the source their query reads.\n',
    )
    yield* write(root, 'packages/pkg/index.ts', 'export const value = 2\n')
  }).pipe(Effect.provide(NodeServices.layer))

const unimplemented = (method: string): Effect.Effect<never> =>
  Effect.die(new Error(`gitPortAt: ${method} is not used by paths evidence`))

const gitPortAt = (changed: ReadonlyArray<RelativePath>): Layer.Layer<GitPort> =>
  Layer.succeed(GitPort, {
    currentBranch: () => Effect.succeed(GitRef.make('main')),
    changedPaths: () => Effect.succeed(changed),
    headSha: () => unimplemented('headSha'),
    remoteTags: () => unimplemented('remoteTags'),
    trackedChanges: () => unimplemented('trackedChanges'),
    commitRelease: () => unimplemented('commitRelease'),
    pushBranch: () => unimplemented('pushBranch'),
    deleteRemoteBranch: () => unimplemented('deleteRemoteBranch'),
    pushTags: () => unimplemented('pushTags'),
    writeTag: () => unimplemented('writeTag'),
    tagCommit: () => unimplemented('tagCommit'),
    tagTree: () => unimplemented('tagTree'),
    repoSlug: () => unimplemented('repoSlug'),
    stagedPaths: () => unimplemented('stagedPaths'),
    mergeInProgress: () => unimplemented('mergeInProgress'),
  })

const live = (changed: ReadonlyArray<RelativePath>) =>
  Layer.mergeAll(
    Layer.provide(ChangeEvidenceLive, Layer.merge(gitPortAt(changed), FetchHttpClient.layer)),
    fakeWorkspaceStore(members),
    fakeChangesetStore({ intents: [] }).layer,
  )

const gateAt = (root: string, changed: ReadonlyArray<RelativePath>) =>
  Cell.run(Cell.provide(live(changed))(gateChangesCell), {
    root: RepoRoot.make(root),
    ref: GitRef.make('base'),
    strategy: 'paths',
    changesetDir: CHANGESET_DIR,
  }).pipe(Effect.provide(NodeServices.layer))

const within = async (shape: (root: string) => Effect.Effect<void, unknown>): Promise<GateReport> => {
  const root = await Effect.runPromise(repository(shape))
  try {
    const listed = await Effect.runPromise(gitOutput(root, ['diff', '--name-only', 'base...main']))
    const changed = listed
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => RelativePath.make(line))
    return await Effect.runPromise(gateAt(root, changed))
  } finally {
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(FileSystem, (fs) => fs.remove(root, { recursive: true, force: true })),
        NodeServices.layer,
      ),
    )
  }
}

Feature('The intent gate reads the change itself').body(({ scenario }) => {
  scenario(
    'A release-shaped version bump consumes the intent it deletes and passes on any branch',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a real repository whose head deletes an intent and only bumps the version and changelog')(
        'report',
        () => Effect.promise(() => within(releaseShaped)),
      ),
      Then('the gate passes and names the moved package')((s) => {
        expect(s.report.ok).toBe(true)
        expect(s.report.text).toContain('1 publishable package(s) changed')
        expect(s.report.text).not.toContain('no intent names')
      }),
    ),
  )

  scenario(
    'A version bump with no changeset to consume is still refused',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a real repository whose head bumps a version with no intent to delete')(
        'report',
        () => Effect.promise(() => within(bumpOnly)),
      ),
      Then('the gate refuses and names the package without an intent')((s) => {
        expect(s.report.ok).toBe(false)
        expect(s.report.text).toContain('no intent names: @t/pkg')
      }),
    ),
  )

  scenario(
    'A consumed intent does not excuse a source change in the same package',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a real repository whose head deletes an intent, bumps the version, and edits source')(
        'report',
        () => Effect.promise(() => within(bumpAndSource)),
      ),
      Then('the gate refuses because the move is not only a version bump')((s) => {
        expect(s.report.ok).toBe(false)
        expect(s.report.text).toContain('no intent names: @t/pkg')
      }),
    ),
  )
})
