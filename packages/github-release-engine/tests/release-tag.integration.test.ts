import { NodeServices } from '@effect/platform-node'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { GitLive } from '@systemfsoftware/git-adapter'
import { tagCell, type TagDecision } from '@systemfsoftware/github-release-engine'
import { FsPath, RelativePath, RepoRoot } from '@systemfsoftware/release-language'
import { CycleStoreLive, WorkspaceStoreLive } from '@systemfsoftware/workspace-adapter'
import { Effect, Layer, Result } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import { expect, vi } from 'vitest'
import { makeFakeLedger } from './__fixtures__/FakeLedger.js'
import { fakeDigest, makeFakeTarball } from './__fixtures__/FakeTarball.js'
import { git, insideRepo, SEED_IDENTITY, withoutGitIdentity, writeFiles } from './__fixtures__/RealGit.js'

const Feature = makeFeature({ it, layer })

const SPAWNS_REAL_PNPM_AND_GIT_TIMEOUT_MS = 30_000
vi.setConfig({ testTimeout: SPAWNS_REAL_PNPM_AND_GIT_TIMEOUT_MS })

const changelogDir = RelativePath.make('.changeset/changelogs')
const ALPHA = '@e2e/alpha@v1.0.0'
const BETA = '@e2e/beta@v2.0.0'
const BOT = 'github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>'
const SEED = 'seed <seed@example.invalid>'

const FILES: ReadonlyArray<readonly [string, string]> = [
  ['package.json', `{\n  "name": "@e2e/root",\n  "private": true,\n  "version": "0.0.0"\n}\n`],
  ['pnpm-workspace.yaml', 'packages:\n  - packages/*\n'],
  ['packages/alpha/package.json', `{\n  "name": "@e2e/alpha",\n  "version": "1.0.0"\n}\n`],
  ['packages/beta/package.json', `{\n  "name": "@e2e/beta",\n  "version": "2.0.0"\n}\n`],
  ['.changeset/changelogs/.gitkeep', ''],
]

interface Repo {
  readonly root: RepoRoot
  readonly remote: string
  readonly tarballs: FsPath
  readonly captured: FsPath
}

const releasedRepo = Effect.gen(function*() {
  const fs = yield* FileSystem
  const path = yield* Path
  const scratch = yield* fs.makeTempDirectory({ prefix: 'release-tag-' })
  const root = path.join(scratch, 'work')
  const remote = path.join(scratch, 'origin.git')
  yield* writeFiles(root, FILES)
  yield* git(scratch, 'init', '-q', '--bare', remote)
  yield* git(root, 'init', '-q', '-b', 'main')
  yield* git(root, 'config', 'commit.gpgsign', 'false')
  yield* git(root, 'config', 'tag.gpgsign', 'false')
  yield* git(root, 'remote', 'add', 'origin', remote)
  yield* git(root, 'add', '-A')
  yield* git(root, ...SEED_IDENTITY, 'commit', '-q', '-m', 'chore(release): version packages')
  const repo: Repo = {
    root: RepoRoot.make(root),
    remote,
    tarballs: FsPath.make(path.join(scratch, 'tarballs')),
    captured: FsPath.make(path.join(scratch, 'captured.json')),
  }
  return repo
})

const runTag = (repo: Repo, step: { readonly output?: FsPath; readonly captured?: FsPath }) =>
  Effect.gen(function*() {
    const live = Layer.mergeAll(
      WorkspaceStoreLive(repo.root),
      GitLive,
      CycleStoreLive,
      makeFakeTarball([fakeDigest('@e2e/alpha', '1.0.0'), fakeDigest('@e2e/beta', '2.0.0')]),
      makeFakeLedger(),
    ).pipe(Layer.provide(NodeServices.layer))
    return yield* withoutGitIdentity(insideRepo(
      repo.root,
      Effect.result(Cell.run(Cell.provide(tagCell, live), {
        tarballs: repo.tarballs,
        dryRun: false,
        json: false,
        changelogDir,
        ...step,
      })),
    ))
  })

const captureCycle = (repo: Repo) =>
  Effect.tap(
    runTag(repo, { output: repo.captured }),
    (captured) => Effect.sync(() => expect(Result.getOrThrow(captured)._tag).toEqual('TagPreview')),
  )

const tagCaptured = (repo: Repo) => runTag(repo, { captured: repo.captured })

const releaseTags = (repo: Repo) => Effect.andThen(captureCycle(repo), tagCaptured(repo))

const pushAlphaAs = (repo: Repo, message: string) =>
  Effect.gen(function*() {
    yield* git(repo.root, ...SEED_IDENTITY, 'tag', '-a', ALPHA, '-m', message)
    yield* git(repo.root, 'push', '-q', 'origin', `refs/tags/${ALPHA}`)
  })

const pushedTags = (repo: Repo) =>
  Effect.map(
    git(
      repo.remote,
      'for-each-ref',
      'refs/tags',
      '--format=%(refname:short)|%(taggername) %(taggeremail)|%(*objectname)',
    ),
    (listing) => listing.split('\n').filter((line) => line.length > 0),
  )

const expectPushed = <E>(outcome: Result.Result<TagDecision, E>, tags: ReadonlyArray<string>) =>
  Result.match(outcome, {
    onSuccess: (decision) => expect(decision).toMatchObject({ _tag: 'TagPushed', tags }),
    onFailure: (refusal) => expect.fail(`expected pushed tags, got ${JSON.stringify(refusal)}`),
  })

Feature('The tag step pushes annotated release tags from the commit it releases').body(({ scenario }) => {
  scenario(
    'With no HOME and no git identity, every tag is pushed with the release bot as tagger',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a released workspace with two packages and a bare origin')('repo', () => releasedRepo),
      When('tag captures the cycle and then tags it, as release.yml runs it')('outcome', (s) => releaseTags(s.repo)),
      Then('origin holds both tags at the release commit, tagged by github-actions[bot]')((s) =>
        Effect.gen(function*() {
          expectPushed(s.outcome, [ALPHA, BETA])
          const head = yield* git(s.repo.root, 'rev-parse', 'HEAD')
          expect(yield* pushedTags(s.repo)).toEqual([`${ALPHA}|${BOT}|${head}`, `${BETA}|${BOT}|${head}`])
        })
      ),
    ),
  )

  scenario(
    'Re-running the tag job after an earlier run pushed part of the tag set pushes the rest',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('an earlier run that captured both tags and pushed only alpha before failing')(
        'repo',
        () => Effect.tap(releasedRepo, (repo) => Effect.andThen(captureCycle(repo), pushAlphaAs(repo, 'earlier run'))),
      ),
      When('the job re-runs: tag captures the cycle again and tags it')('outcome', (s) => releaseTags(s.repo)),
      Then('the alpha tag is left as the earlier run pushed it and the beta tag is added')((s) =>
        Effect.gen(function*() {
          expectPushed(s.outcome, [BETA])
          const head = yield* git(s.repo.root, 'rev-parse', 'HEAD')
          expect(yield* pushedTags(s.repo)).toEqual([`${ALPHA}|${SEED}|${head}`, `${BETA}|${BOT}|${head}`])
        })
      ),
    ),
  )

  scenario(
    'A captured cycle naming a tag already pushed at the release commit pushes only the rest',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a captured cycle of both tags, then alpha pushed at the release commit')(
        'repo',
        () => Effect.tap(releasedRepo, (repo) => Effect.andThen(captureCycle(repo), pushAlphaAs(repo, 'earlier run'))),
      ),
      When('tag runs on that captured file')('outcome', (s) => tagCaptured(s.repo)),
      Then('tag succeeds, leaving alpha as it was and adding beta')((s) =>
        Effect.gen(function*() {
          expectPushed(s.outcome, [ALPHA, BETA])
          const head = yield* git(s.repo.root, 'rev-parse', 'HEAD')
          expect(yield* pushedTags(s.repo)).toEqual([`${ALPHA}|${SEED}|${head}`, `${BETA}|${BOT}|${head}`])
        })
      ),
    ),
  )

  scenario(
    'A captured cycle naming a tag that exists at another commit is refused and nothing is pushed',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a captured cycle of both tags, alpha pushed at that commit, then a later commit checked out')(
        'repo',
        () =>
          Effect.gen(function*() {
            const repo = yield* releasedRepo
            yield* captureCycle(repo)
            yield* pushAlphaAs(repo, 'older release')
            const older = yield* git(repo.root, 'rev-parse', 'HEAD')
            yield* git(repo.root, ...SEED_IDENTITY, 'commit', '-q', '--allow-empty', '-m', 'chore: later')
            return { ...repo, older }
          }),
      ),
      When('tag runs on that captured file')('outcome', (s) => tagCaptured(s.repo)),
      Then('tag refuses, naming the tag and both commits, and origin gains no tag')((s) =>
        Effect.gen(function*() {
          const head = yield* git(s.repo.root, 'rev-parse', 'HEAD')
          Result.match(s.outcome, {
            onFailure: (refusal) =>
              expect(refusal).toMatchObject({
                _tag: 'TagAtOtherCommit',
                tag: ALPHA,
                expected: head,
                found: s.repo.older,
              }),
            onSuccess: (decision) => expect.fail(`expected a refusal, got ${JSON.stringify(decision)}`),
          })
          expect(yield* pushedTags(s.repo)).toEqual([`${ALPHA}|${SEED}|${s.repo.older}`])
        })
      ),
    ),
  )
})
