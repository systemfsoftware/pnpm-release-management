import { NodeServices } from '@effect/platform-node'
import { ChangesetsPortLive } from '@systemfsoftware/changesets-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { GitLive } from '@systemfsoftware/git-adapter'
import { pullRequestCell } from '@systemfsoftware/github-release-engine'
import { GitRef, PrTitle, RelativePath, ReleaseLabel, RepoRoot } from '@systemfsoftware/release-language'
import { bumpCell, BumpInput } from '@systemfsoftware/version-engine'
import {
  ChangelogStoreLive,
  ChangesetStoreLive,
  SurfaceStoreLive,
  WorkspaceStoreLive,
} from '@systemfsoftware/workspace-adapter'
import { Effect, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import * as Match from 'effect/Match'
import { Path } from 'effect/Path'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { ChildProcess } from 'effect/unstable/process'
import { expect, vi } from 'vitest'
import { makeFakeForge } from './__fixtures__/FakeForge.js'

const Feature = makeFeature({ it, layer })

const SPAWNS_REAL_PNPM_AND_GIT_TIMEOUT_MS = 30_000
vi.setConfig({ testTimeout: SPAWNS_REAL_PNPM_AND_GIT_TIMEOUT_MS })

const SLUG_URL = 'https://github.com/acme/acme.git'
const changesetDir = RelativePath.make('.changeset')
const changelogDir = RelativePath.make('.changeset/changelogs')
const title = PrTitle.make('chore(release): version packages')
const base = GitRef.make('main')
const branch = GitRef.make('release')

const SETTLED_FILES: ReadonlyArray<readonly [string, string]> = [
  ['package.json', `{\n  "name": "@e2e/root",\n  "private": true,\n  "version": "0.0.0"\n}\n`],
  ['pnpm-workspace.yaml', 'packages:\n  - packages/*\n'],
  ['packages/alpha/package.json', `{\n  "name": "@e2e/alpha",\n  "version": "1.0.0"\n}\n`],
  ['.changeset/README.md', '# Changesets\n'],
  ['.changeset/changelogs/.gitkeep', ''],
]

const PENDING_FILES: ReadonlyArray<readonly [string, string]> = [
  ...SETTLED_FILES,
  ['.changeset/alpha-minor.md', '---\n"@e2e/alpha": minor\n---\n\nalpha grows a public export\n'],
]

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* ChildProcess.make('git', args, { cwd })
      const [stdout, code] = yield* Effect.all([
        Stream.mkString(Stream.decodeText(handle.stdout)),
        handle.exitCode,
      ], { concurrency: 'unbounded' })
      if (code !== 0) return yield* Effect.die(new Error(`git ${args.join(' ')} exited ${code}`))
      return stdout.trim()
    }),
  )

const writeFiles = (root: string, files: ReadonlyArray<readonly [string, string]>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    yield* Effect.forEach(files, ([file, text]) =>
      Effect.gen(function*() {
        const full = path.join(root, file)
        yield* fs.makeDirectory(path.dirname(full), { recursive: true })
        yield* fs.writeFileString(full, text)
      }), { discard: true })
  })

const committedRepo = (files: ReadonlyArray<readonly [string, string]>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const scratch = yield* fs.makeTempDirectory({ prefix: 'release-pull-request-' })
    const root = path.join(scratch, 'work')
    const remote = path.join(scratch, 'origin.git')
    yield* writeFiles(root, files)
    yield* git(scratch, 'init', '-q', '--bare', remote)
    yield* git(root, 'init', '-q', '-b', 'main')
    yield* git(root, 'config', 'user.name', 't')
    yield* git(root, 'config', 'user.email', 't@example.invalid')
    yield* git(root, 'config', 'commit.gpgsign', 'false')
    yield* git(root, 'remote', 'add', 'origin', SLUG_URL)
    yield* git(root, 'config', `url.${remote}.pushInsteadOf`, SLUG_URL)
    yield* git(root, 'add', '-A')
    yield* git(root, 'commit', '-q', '-m', 'chore: seed')
    return { root: RepoRoot.make(root), remote }
  })

const bump = (root: RepoRoot) =>
  Effect.gen(function*() {
    const bumpLayer = Layer.mergeAll(
      WorkspaceStoreLive(root),
      SurfaceStoreLive(root),
      ChangelogStoreLive(root),
      ChangesetStoreLive({ root, changesetDir }),
      ChangesetsPortLive({ root, base }),
    ).pipe(Layer.provide(NodeServices.layer))
    const input = yield* S.decodeUnknownEffect(BumpInput)({
      strategy: 'changesets',
      changelogDir,
      manifest: { file: 'package.json', surface: { kind: 'json', path: 'package.json' } },
      surfaces: [],
    })
    yield* Cell.run(Cell.provide(bumpCell, bumpLayer), input)
  })

const insideRepo = <A, E, R>(root: RepoRoot, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.cwd()
      process.chdir(root)
      return previous
    }),
    () => effect,
    (previous) => Effect.sync(() => process.chdir(previous)),
  )

const openReleasePullRequest = (root: RepoRoot) =>
  Effect.gen(function*() {
    const forge = makeFakeForge()
    const prLayer = Layer.mergeAll(
      WorkspaceStoreLive(root),
      ChangesetStoreLive({ root, changesetDir }),
      GitLive,
      forge.layer,
    ).pipe(Layer.provide(NodeServices.layer))
    const outcome = yield* insideRepo(
      root,
      Effect.match(
        Cell.run(Cell.provide(pullRequestCell, prLayer), {
          title,
          base,
          branch,
          labels: [ReleaseLabel.make('release')],
          changelogDir,
        }),
        {
          onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
          onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
        },
      ),
    )
    return { outcome, forge }
  })

const remoteBranches = (remote: string) => git(remote, 'for-each-ref', '--format=%(refname:short)', 'refs/heads')

Feature('The release PR is opened from the tree the version step bumped').body(({ scenario }) => {
  scenario(
    'Bump then pr, the order the reusable release workflow runs them',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a committed workspace with one pending minor intent for alpha')(
        'repo',
        () => committedRepo(PENDING_FILES),
      ),
      When('the version step bumps and pr runs on the bumped tree')(
        'run',
        (s) => Effect.andThen(bump(s.repo.root), openReleasePullRequest(s.repo.root)),
      ),
      Then('the release PR opens and its branch commit holds the bumped versions without the intent')((s) =>
        Effect.gen(function*() {
          Match.value(s.run.outcome).pipe(
            Match.tag('decided', ({ decision }) => expect(decision._tag).toEqual('PullRequestCreated')),
            Match.tag('refused', ({ refusal }) => expect.fail(`expected a created PR, got ${refusal._tag}`)),
            Match.exhaustive,
          )
          expect(s.run.forge.calls.createdPullRequests.map((created) => created.head)).toEqual(['release'])
          expect(yield* git(s.repo.remote, 'log', '-1', '--format=%s', 'release')).toEqual(title)
          expect(yield* git(s.repo.remote, 'show', 'release:packages/alpha/package.json')).toContain(
            '"version": "1.1.0"',
          )
          expect(yield* git(s.repo.remote, 'ls-tree', '--name-only', 'release', '.changeset/')).toEqual(
            ['.changeset/README.md', '.changeset/changelogs'].join('\n'),
          )
        })
      ),
    ),
  )

  scenario(
    'pr with intents still pending refuses instead of reporting nothing to release',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a committed workspace with one pending minor intent for alpha')(
        'repo',
        () => committedRepo(PENDING_FILES),
      ),
      When('pr runs before the version step')('run', (s) => openReleasePullRequest(s.repo.root)),
      Then('pr refuses with the pending count and pushes nothing')((s) =>
        Effect.gen(function*() {
          Match.value(s.run.outcome).pipe(
            Match.tag('refused', ({ refusal }) =>
              expect(refusal).toMatchObject({ _tag: 'PullRequestUnversioned', pending: 1 })),
            Match.tag('decided', ({ decision }) =>
              expect.fail(`expected a refusal, got ${decision._tag}`)),
            Match.exhaustive,
          )
          expect(s.run.forge.calls.createdPullRequests).toEqual([])
          expect(yield* remoteBranches(s.repo.remote)).toEqual('')
        })
      ),
    ),
  )

  scenario(
    'An untracked artifact beside an unchanged tree opens no release PR',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a committed workspace with no pending intent and an untracked .release/ artifact')(
        'repo',
        () =>
          Effect.tap(
            committedRepo(SETTLED_FILES),
            (repo) => writeFiles(repo.root, [['.release/captured.json', '{"entries":[]}\n']]),
          ),
      ),
      When('the version step bumps nothing and pr runs')(
        'run',
        (s) => Effect.andThen(bump(s.repo.root), openReleasePullRequest(s.repo.root)),
      ),
      Then('the release PR rests vacant and nothing is committed or pushed')((s) =>
        Effect.gen(function*() {
          Match.value(s.run.outcome).pipe(
            Match.tag('decided', ({ decision }) => expect(decision._tag).toEqual('PullRequestVacant')),
            Match.tag('refused', ({ refusal }) => expect.fail(`expected a vacant decision, got ${refusal._tag}`)),
            Match.exhaustive,
          )
          expect(s.run.forge.calls.createdPullRequests).toEqual([])
          expect(yield* remoteBranches(s.repo.remote)).toEqual('')
          expect(yield* git(s.repo.root, 'log', '--format=%s')).toEqual('chore: seed')
        })
      ),
    ),
  )

  scenario(
    'The release commit holds what bump wrote and no untracked artifact',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a committed workspace with one pending minor intent and an untracked .release/ artifact')(
        'repo',
        () =>
          Effect.tap(
            committedRepo(PENDING_FILES),
            (repo) => writeFiles(repo.root, [['.release/captured.json', '{"entries":[]}\n']]),
          ),
      ),
      When('the version step bumps and pr runs on the bumped tree')(
        'run',
        (s) => Effect.andThen(bump(s.repo.root), openReleasePullRequest(s.repo.root)),
      ),
      Then(
        'the release commit changes the version, the intent and the new changelog, and the artifact stays untracked',
      )((
        s,
      ) =>
        Effect.gen(function*() {
          Match.value(s.run.outcome).pipe(
            Match.tag('decided', ({ decision }) => expect(decision._tag).toEqual('PullRequestCreated')),
            Match.tag('refused', ({ refusal }) => expect.fail(`expected a created PR, got ${refusal._tag}`)),
            Match.exhaustive,
          )
          expect(yield* git(s.repo.remote, 'diff-tree', '--no-commit-id', '--name-status', '-r', 'release')).toEqual(
            [
              'D\t.changeset/alpha-minor.md',
              'A\t.changeset/changelogs/@e2e!alpha@1.1.0.md',
              'M\tpackages/alpha/package.json',
            ].join('\n'),
          )
          expect(yield* git(s.repo.root, 'status', '--porcelain', '--untracked-files=all')).toEqual(
            '?? .release/captured.json',
          )
        })
      ),
    ),
  )
})
