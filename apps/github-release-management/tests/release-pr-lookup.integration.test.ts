import { NodeHttpServer, NodeServices } from '@effect/platform-node'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { GitLive } from '@systemfsoftware/git-adapter'
import { ForgeConfig, ForgeLive } from '@systemfsoftware/github-adapter'
import { pullRequestCell } from '@systemfsoftware/github-release-engine'
import { GitRef, PrTitle, RelativePath, ReleaseLabel, RepoRoot } from '@systemfsoftware/release-language'
import { ChangesetStoreLive, WorkspaceStoreLive } from '@systemfsoftware/workspace-adapter'
import { Effect, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import * as Match from 'effect/Match'
import { Path } from 'effect/Path'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { ChildProcess } from 'effect/unstable/process'
import { expect, vi } from 'vitest'
import { PullWrite } from './__fixtures__/forge-emulator.schema.js'

const Feature = makeFeature({ it, layer })

const SPAWNS_REAL_PNPM_AND_GIT_TIMEOUT_MS = 30_000
vi.setConfig({ testTimeout: SPAWNS_REAL_PNPM_AND_GIT_TIMEOUT_MS })

const OWNER = 'acme'
const REPO = 'acme'
const SLUG_URL = `https://github.com/${OWNER}/${REPO}.git`
const RELEASE_BRANCH = 'changeset-release/main'
const RELEASE_TITLE = 'chore(release): version packages'
const RELEASE_BODY = 'Consumes the pending intents.'

interface Pull {
  readonly number: number
  readonly head: string
  readonly owner: string
  title: string
  body: string
  state: 'open' | 'closed'
}

const dependabotPull = (): Pull => ({
  number: 128,
  head: 'dependabot/npm_and_yarn/effect-4.0.0',
  owner: OWNER,
  title: 'build(deps): bump effect to 4.0.0',
  body: 'Bumps effect from 3.x to 4.0.0.',
  state: 'open',
})

const releasePull = (): Pull => ({
  number: 7,
  head: RELEASE_BRANCH,
  owner: OWNER,
  title: 'chore(release): old title',
  body: 'old body',
  state: 'open',
})

type HeadFilter = 'github-owner-qualified-only' | 'ignored'

interface Emulator {
  readonly pulls: Array<Pull>
  readonly listedHeads: Array<string>
}

const wireOf = (pull: Pull) => ({
  number: pull.number,
  title: pull.title,
  body: pull.body,
  state: pull.state,
  head: { ref: pull.head, repo: { owner: { login: pull.owner } } },
})

const listed = (pulls: ReadonlyArray<Pull>, head: string, filter: HeadFilter): ReadonlyArray<Pull> => {
  const open = pulls.filter((pull) => pull.state === 'open')
  if (filter === 'ignored' || head.includes(':') === false) return open
  return open.filter((pull) => `${pull.owner}:${pull.head}` === head)
}

const pullsPath = `/repos/${OWNER}/${REPO}/pulls`
const pullPath = /^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/
const labelsPath = /^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/labels$/

const respond = (emulator: Emulator, filter: HeadFilter) =>
  Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = new URL(request.url, 'http://emulator')
    const written = () => Effect.orDie(Effect.flatMap(request.text, S.decodeUnknownEffect(PullWrite)))
    if (request.method === 'GET' && url.pathname === pullsPath) {
      const head = url.searchParams.get('head') ?? ''
      emulator.listedHeads.push(head)
      return HttpServerResponse.jsonUnsafe(listed(emulator.pulls, head, filter).map(wireOf))
    }
    if (request.method === 'POST' && url.pathname === pullsPath) {
      const body = yield* written()
      const created: Pull = {
        number: Math.max(0, ...emulator.pulls.map((pull) => pull.number)) + 1,
        head: body.head ?? '',
        owner: OWNER,
        title: body.title ?? '',
        body: body.body ?? '',
        state: 'open',
      }
      emulator.pulls.push(created)
      return HttpServerResponse.jsonUnsafe(wireOf(created), { status: 201 })
    }
    const pull = emulator.pulls.find((candidate) => candidate.number === Number(pullPath.exec(url.pathname)?.[1]))
    if (request.method === 'PATCH' && pull !== undefined) {
      const body = yield* written()
      pull.title = body.title ?? pull.title
      pull.body = body.body ?? pull.body
      if (body.state === 'closed') pull.state = 'closed'
      return HttpServerResponse.jsonUnsafe(wireOf(pull))
    }
    if (request.method === 'POST' && labelsPath.test(url.pathname)) {
      const body = yield* written()
      return HttpServerResponse.jsonUnsafe((body.labels ?? []).map((name) => ({ name })))
    }
    return HttpServerResponse.jsonUnsafe({ message: `no route for ${request.method} ${url.pathname}` }, {
      status: 404,
    })
  })

const emulatorWith = (seed: ReadonlyArray<Pull>, filter: HeadFilter) =>
  Effect.gen(function*() {
    const emulator: Emulator = { pulls: seed.map((pull) => ({ ...pull })), listedHeads: [] }
    yield* HttpServer.serveEffect(respond(emulator, filter))
    const server = yield* HttpServer.HttpServer
    const port = yield* Match.value(server.address).pipe(
      Match.tag('TcpAddress', (address) => Effect.succeed(address.port)),
      Match.orElse(() => Effect.die(new Error('the emulator is not listening on TCP'))),
    )
    return { ...emulator, url: `http://127.0.0.1:${String(port)}` }
  })

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

const FILES: ReadonlyArray<readonly [string, string]> = [
  ['package.json', `{\n  "name": "@e2e/root",\n  "private": true,\n  "version": "0.0.0"\n}\n`],
  ['pnpm-workspace.yaml', 'packages:\n  - packages/*\n'],
  ['packages/alpha/package.json', `{\n  "name": "@e2e/alpha",\n  "version": "1.0.0"\n}\n`],
  ['.changeset/README.md', '# Changesets\n'],
  ['.changeset/changelogs/.gitkeep', ''],
]

const bumpedRepo = Effect.gen(function*() {
  const fs = yield* FileSystem
  const path = yield* Path
  const scratch = yield* fs.makeTempDirectory({ prefix: 'release-pr-lookup-' })
  const root = path.join(scratch, 'work')
  const remote = path.join(scratch, 'origin.git')
  for (const [file, text] of FILES) {
    yield* fs.makeDirectory(path.dirname(path.join(root, file)), { recursive: true })
    yield* fs.writeFileString(path.join(root, file), text)
  }
  yield* git(scratch, 'init', '-q', '--bare', remote)
  yield* git(root, 'init', '-q', '-b', 'main')
  yield* git(root, 'config', 'commit.gpgsign', 'false')
  yield* git(root, 'remote', 'add', 'origin', SLUG_URL)
  yield* git(root, 'config', `url.${remote}.pushInsteadOf`, SLUG_URL)
  yield* git(root, 'add', '-A')
  yield* git(root, '-c', 'user.name=seed', '-c', 'user.email=seed@example.invalid', 'commit', '-q', '-m', 'seed')
  yield* fs.writeFileString(
    path.join(root, 'packages/alpha/package.json'),
    `{\n  "name": "@e2e/alpha",\n  "version": "1.1.0"\n}\n`,
  )
  return { scratch, root: RepoRoot.make(root) }
})

const insideRepo = <A, E, R>(root: string, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.cwd()
      process.chdir(root)
      vi.stubEnv('GITHUB_REPOSITORY', `${OWNER}/${REPO}`)
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        vi.unstubAllEnvs()
        process.chdir(previous)
      }),
  )

const openReleasePullRequest = (seed: ReadonlyArray<Pull>, filter: HeadFilter) =>
  Effect.scoped(Effect.gen(function*() {
    const repo = yield* bumpedRepo
    const emulator = yield* emulatorWith(seed, filter)
    const forge = Layer.provide(ForgeLive, Layer.succeed(ForgeConfig, { token: 'test-token', baseUrl: emulator.url }))
    const adapters = Layer.mergeAll(
      WorkspaceStoreLive(repo.root),
      ChangesetStoreLive({ root: repo.root, changesetDir: RelativePath.make('.changeset') }),
      GitLive,
      forge,
    ).pipe(Layer.provide(NodeServices.layer))
    const decision = yield* insideRepo(
      repo.root,
      Cell.run(Cell.provide(pullRequestCell, adapters), {
        title: PrTitle.make(RELEASE_TITLE),
        body: RELEASE_BODY,
        base: GitRef.make('main'),
        branch: GitRef.make(RELEASE_BRANCH),
        labels: [ReleaseLabel.make('release')],
        changelogDir: RelativePath.make('.changeset/changelogs'),
      }),
    )
    const fs = yield* FileSystem
    yield* Effect.orDie(fs.remove(repo.scratch, { recursive: true }))
    return { decision, pulls: emulator.pulls, listedHeads: emulator.listedHeads }
  })).pipe(Effect.provide(NodeHttpServer.layerTest))

const untouchedDependabot = (pulls: ReadonlyArray<Pull>): void => {
  expect(pulls.find((pull) => pull.number === 128)).toEqual(dependabotPull())
}

Feature('The release PR lookup only ever finds the release branch PR').body(({ scenario }) => {
  scenario(
    'Another open PR is listed first and GitHub ignores a bare head filter',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('an open Dependabot PR and no release PR, on a host with GitHub head filtering')(
        'seed',
        () => Effect.succeed([dependabotPull()]),
      ),
      When('pr runs on the bumped tree')('run', (s) => openReleasePullRequest(s.seed, 'github-owner-qualified-only')),
      Then('a new release PR is opened and the Dependabot PR keeps its title and body')((s) =>
        Effect.sync(() => {
          expect(s.run.decision).toMatchObject({ _tag: 'PullRequestCreated', number: 129 })
          untouchedDependabot(s.run.pulls)
          expect(s.run.pulls.find((pull) => pull.number === 129)).toMatchObject({
            head: RELEASE_BRANCH,
            title: RELEASE_TITLE,
            body: RELEASE_BODY,
            state: 'open',
          })
          expect(s.run.listedHeads).toEqual([`${OWNER}:${RELEASE_BRANCH}`])
        })
      ),
    ),
  )

  scenario(
    'A host that ignores the head filter altogether still yields no foreign PR',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('an open Dependabot PR and no release PR, on a host that returns every open PR')(
        'seed',
        () => Effect.succeed([dependabotPull()]),
      ),
      When('pr runs on the bumped tree')('run', (s) => openReleasePullRequest(s.seed, 'ignored')),
      Then('a new release PR is opened and the Dependabot PR keeps its title and body')((s) =>
        Effect.sync(() => {
          expect(s.run.decision).toMatchObject({ _tag: 'PullRequestCreated', number: 129 })
          untouchedDependabot(s.run.pulls)
        })
      ),
    ),
  )

  scenario(
    'The release PR listed after another PR is the one updated',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('an open Dependabot PR listed before the open release PR, on a host that returns every open PR')(
        'seed',
        () => Effect.succeed([dependabotPull(), releasePull()]),
      ),
      When('pr runs on the bumped tree')('run', (s) => openReleasePullRequest(s.seed, 'ignored')),
      Then('the release PR gets the release title and body and the Dependabot PR is untouched')((s) =>
        Effect.sync(() => {
          expect(s.run.decision).toMatchObject({ _tag: 'PullRequestUpdated', number: 7 })
          untouchedDependabot(s.run.pulls)
          expect(s.run.pulls.find((pull) => pull.number === 7)).toMatchObject({
            title: RELEASE_TITLE,
            body: RELEASE_BODY,
          })
          expect(s.run.pulls).toHaveLength(2)
        })
      ),
    ),
  )
})
