import { NodeServices } from '@effect/platform-node'
import { LedgerLive, RegistryLive } from '@systemfsoftware/adoption-adapter'
import { LedgerAppendCommand, verifyLedgerAppend } from '@systemfsoftware/changeset-engine'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { GitLive } from '@systemfsoftware/git-adapter'
import {
  adoptCell,
  type AdoptionReport,
  planCell,
  type PlanDecision,
  type PlanReport,
  tagCell,
} from '@systemfsoftware/github-release-engine'
import {
  type AdoptionFailure,
  ChangesetsPort,
  ChangesetStore,
  Count,
  CycleStore,
  FsPath,
  GitRef,
  HttpUrl,
  LEDGER_PATH,
  LedgerPort,
  ManifestUnreadable,
  type Member,
  MismatchedLedgerEntry,
  PackageManifest,
  PackageName,
  PackageVersion,
  PublishedLedgerEntry,
  RelativePath,
  ReleaseLedger,
  type ReleaseLedgerEntry,
  RepoRoot,
  UnpublishedLedgerEntry,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { TarballLive } from '@systemfsoftware/tarball-adapter'
import { Effect, Layer, Option, Result } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import * as Match from 'effect/Match'
import { Path } from 'effect/Path'
import * as Stream from 'effect/Stream'
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { expect } from 'vitest'
import { buildTarball } from './__fixtures__/build-tarball.js'

const Feature = makeFeature({ it, layer })

const ALPHA_NAME = PackageName.make('@e2e/alpha')
const ALPHA_VERSION = PackageVersion.make('1.0.0')
const BETA_NAME = PackageName.make('@e2e/beta')
const BETA_VERSION = PackageVersion.make('2.0.0')

const alphaMember: Member = {
  name: ALPHA_NAME,
  dir: RelativePath.make('packages/alpha'),
  manifest: { name: ALPHA_NAME, version: ALPHA_VERSION },
  publishable: true,
}

const gritlintMember: Member = {
  name: PackageName.make('@e2e/gritlint'),
  dir: RelativePath.make('packages/gritlint'),
  manifest: { name: PackageName.make('@e2e/gritlint'), version: PackageVersion.make('0.1.0') },
  publishable: false,
}

const betaMember: Member = {
  name: BETA_NAME,
  dir: RelativePath.make('packages/beta'),
  manifest: { name: BETA_NAME, version: BETA_VERSION },
  publishable: true,
}

const DAEMON_NAME = PackageName.make('@e2e/effect-daemon-spec')
const GONE_NAME = PackageName.make('@e2e/gone')

const daemonMember: Member = {
  name: DAEMON_NAME,
  dir: RelativePath.make('packages/effect-daemon-spec'),
  manifest: { name: DAEMON_NAME, version: PackageVersion.make('0.1.0') },
  publishable: true,
}

const goneMember: Member = {
  name: GONE_NAME,
  dir: RelativePath.make('packages/gone'),
  manifest: { name: GONE_NAME, version: PackageVersion.make('1.0.0') },
  publishable: true,
}

const tagOf = (name: PackageName, version: PackageVersion): string => `${name}@v${version}`
const tarNameOf = (name: PackageName, version: PackageVersion): string => `${name.replace(/[/@]/g, '-')}-${version}.tgz`
const integrityOf = (bytes: Uint8Array): string => `sha512-${createHash('sha512').update(bytes).digest('base64')}`
const tarballBytes = (name: PackageName, version: PackageVersion, files: Record<string, string>): Buffer =>
  buildTarball({ 'package/package.json': JSON.stringify({ name, version }), ...files })

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* spawner.spawn(ChildProcess.make('git', args, { cwd }))
    const [stdout, stderr] = yield* Effect.all(
      [
        Stream.mkString(Stream.decodeText(handle.stdout)),
        Stream.mkString(Stream.decodeText(handle.stderr)),
      ],
      { concurrency: 'unbounded' },
    )
    const code = yield* handle.exitCode
    if (code !== 0) {
      return yield* Effect.fail(new Error(`git ${args.join(' ')}`, { cause: new Error(stderr) }))
    }
    return stdout.trim()
  })

interface Served {
  readonly key: string
  readonly file: string
  readonly bytes: Uint8Array
  readonly integrity: string
}

const closeServer = (server: Server): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>()
  server.close(() => resolve())
  return promise
}

const portOf = (server: Server): number => {
  const address = server.address()
  if (address === null || typeof address === 'string') {
    return 0
  }
  return address.port
}

const startRegistry = (served: ReadonlyArray<Served>) =>
  Effect.tryPromise({
    try: () => {
      const { promise, resolve, reject } = Promise.withResolvers<{ base: string; close: () => Promise<void> }>()
      const server = createServer((request, response) => {
        const decoded = decodeURIComponent(request.url ?? '')
        if (decoded.startsWith('/tarballs/')) {
          const file = decoded.slice('/tarballs/'.length)
          const tarball = served.find((entry) => entry.file === file)
          if (tarball === undefined) {
            response.statusCode = 404
            response.end()
            return
          }
          response.setHeader('content-type', 'application/octet-stream')
          response.end(Buffer.from(tarball.bytes))
          return
        }
        const segments = decoded.replace(/^\//, '').split('/')
        const version = segments.pop()
        const name = segments.join('/')
        const entry = served.find((candidate) => candidate.key === `${name}@${version}`)
        if (entry === undefined) {
          response.statusCode = 404
          response.end()
          return
        }
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({
            dist: {
              tarball: `http://127.0.0.1:${portOf(server)}/tarballs/${entry.file}`,
              integrity: entry.integrity,
            },
          }),
        )
      })
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        resolve({ base: `http://127.0.0.1:${portOf(server)}`, close: () => closeServer(server) })
      })
      return promise
    },
    catch: (cause) => new Error('registry server failed', { cause: cause }),
  })

interface Context {
  readonly root: string
  readonly work: string
  readonly tarballs: string
  readonly registry: string
  readonly close: () => Promise<void>
}

interface PackEntry {
  readonly name: PackageName
  readonly version: PackageVersion
  readonly manifestName?: PackageName
  readonly private?: boolean
}

interface TagEntry {
  readonly name: PackageName
  readonly version: PackageVersion
}

interface PrepareOptions {
  readonly commits: ReadonlyArray<
    { readonly packages: ReadonlyArray<PackEntry>; readonly tags: ReadonlyArray<TagEntry> }
  >
  readonly serve: ReadonlyArray<
    {
      readonly name: PackageName
      readonly version: PackageVersion
      readonly files: Record<string, string>
      readonly integrity?: string
    }
  >
}

const prepare = (options: PrepareOptions) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const root = yield* fs.makeTempDirectory({ prefix: 'adoption-ledger-' })
    const work = path.join(root, 'work')
    const tarballs = path.join(root, 'tarballs')
    yield* fs.makeDirectory(work, { recursive: true })
    yield* fs.makeDirectory(tarballs, { recursive: true })
    yield* fs.writeFileString(path.join(work, 'README.md'), '# fixture\n')
    yield* git(work, ['init', '-q', '-b', 'main'])
    yield* git(work, ['config', 'user.email', 'test@example.invalid'])
    yield* git(work, ['config', 'user.name', 'test'])
    for (const step of options.commits) {
      for (const entry of step.packages) {
        const dir = path.join(work, 'packages', entry.name.replace(/[/@]/g, '-'))
        yield* fs.makeDirectory(dir, { recursive: true })
        const manifest: Record<string, unknown> = {
          name: entry.manifestName ?? entry.name,
          version: entry.version,
        }
        if (entry.private === true) {
          manifest['private'] = true
        }
        yield* fs.writeFileString(path.join(dir, 'package.json'), JSON.stringify(manifest))
      }
      yield* git(work, ['add', '-A'])
      yield* git(work, ['commit', '-q', '-m', 'chore: fixture'])
      for (const entry of step.tags) {
        yield* git(work, ['tag', tagOf(entry.name, entry.version)])
      }
    }
    yield* git(root, ['init', '-q', '--bare', 'origin.git'])
    yield* git(work, ['remote', 'add', 'origin', path.join(root, 'origin.git')])
    yield* git(work, ['push', '-q', '-u', 'origin', 'main'])
    yield* git(work, ['push', '-q', 'origin', '--tags'])
    const served: Array<Served> = []
    for (const entry of options.serve) {
      const bytes = tarballBytes(entry.name, entry.version, entry.files)
      yield* fs.writeFile(path.join(tarballs, tarNameOf(entry.name, entry.version)), bytes)
      served.push({
        key: `${entry.name}@${entry.version}`,
        file: tarNameOf(entry.name, entry.version),
        bytes,
        integrity: entry.integrity ?? integrityOf(bytes),
      })
    }
    const registry = yield* startRegistry(served)
    return { root, work, tarballs, registry: registry.base, close: registry.close }
  })

const workspaceLayer = (members: ReadonlyArray<Member>) =>
  Layer.succeed(WorkspaceStore, {
    root: RepoRoot.make('/'),
    listMembers: () => Effect.succeed([...members]),
    readManifest: (dir: RelativePath) => {
      const member = members.find((candidate) => candidate.dir === dir)
      if (member === undefined) {
        return Effect.fail(ManifestUnreadable.make({ path: FsPath.make(dir) }))
      }
      return Effect.succeed(PackageManifest.make({ name: member.name, version: member.manifest.version }))
    },
    readFileFromRoot: () => Effect.fail(ManifestUnreadable.make({ path: FsPath.make('/') })),
  })

const changesetsLayer = Layer.succeed(ChangesetsPort, {
  plan: () => Effect.succeed({ changesets: Count.make(0), releases: [] }),
  apply: () => Effect.void,
})

const unused = () => Effect.die(new Error('unused store operation'))

const changesetStoreLayer = Layer.succeed(ChangesetStore, {
  listIntents: () => Effect.succeed([]),
  readIntent: unused,
  writeIntent: unused,
  deleteIntents: unused,
  readReadme: unused,
})

const cycleLayer = Layer.succeed(CycleStore, {
  readCaptured: () => Effect.succeed([]),
  writeCaptured: () => Effect.succeed(Count.make(0)),
  readDeferred: () => Effect.succeed([]),
  writeDeferred: () => Effect.succeed(Count.make(0)),
})

const adaptersOf = (context: Context, members: ReadonlyArray<Member>) =>
  Layer.mergeAll(
    GitLive,
    TarballLive,
    LedgerLive(RepoRoot.make(context.work)),
    RegistryLive.pipe(Layer.provide(FetchHttpClient.layer)),
    workspaceLayer(members),
    changesetsLayer,
    changesetStoreLayer,
    cycleLayer,
  ).pipe(Layer.provide(NodeServices.layer))

const adoptRequest = (context: Context) => ({
  registry: HttpUrl.make(context.registry),
  output: RelativePath.make('release-ledger.json'),
})

const planRequest = (context: Context) => ({
  tarballs: FsPath.make(context.tarballs),
  changelogDir: RelativePath.make('.changeset/changelogs'),
})

const attempt = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<Result.Result<A, E>, never, R> =>
  Effect.result(effect)

const adoptionDecisionTag = (decision: AdoptionReport['decision']): string =>
  Match.value(decision).pipe(
    Match.tagsExhaustive({
      AdoptionRecorded: () => 'AdoptionRecorded',
      AdoptionVacant: () => 'AdoptionVacant',
    }),
  )

const planDecisionTag = (decision: PlanDecision): string =>
  Match.value(decision).pipe(
    Match.tagsExhaustive({
      PlanVersion: () => 'PlanVersion',
      PlanRelease: () => 'PlanRelease',
      PlanSettled: () => 'PlanSettled',
    }),
  )

const publishedEntries = (
  entries: ReadonlyArray<ReleaseLedgerEntry>,
): ReadonlyArray<PublishedLedgerEntry> =>
  entries.flatMap((entry) =>
    Match.value(entry).pipe(
      Match.tag('published', (published) => [published]),
      Match.tag('unpublished', () => []),
      Match.tag('mismatched', () => []),
      Match.exhaustive,
    )
  )

const kindOf = (entry: ReleaseLedgerEntry): string =>
  Match.value(entry).pipe(
    Match.tag('published', () => 'published'),
    Match.tag('unpublished', () => 'unpublished'),
    Match.tag('mismatched', () => 'mismatched'),
    Match.exhaustive,
  )

const mismatchedEntries = (
  entries: ReadonlyArray<ReleaseLedgerEntry>,
): ReadonlyArray<MismatchedLedgerEntry> =>
  entries.flatMap((entry) =>
    Match.value(entry).pipe(
      Match.tag('mismatched', (mismatched) => [mismatched]),
      Match.tag('published', () => []),
      Match.tag('unpublished', () => []),
      Match.exhaustive,
    )
  )

const unpublishedEntries = (
  entries: ReadonlyArray<ReleaseLedgerEntry>,
): ReadonlyArray<UnpublishedLedgerEntry> =>
  entries.flatMap((entry) =>
    Match.value(entry).pipe(
      Match.tag('unpublished', (unpublished) => [unpublished]),
      Match.tag('published', () => []),
      Match.tag('mismatched', () => []),
      Match.exhaustive,
    )
  )

const failureTag = (failure: AdoptionFailure): string =>
  Match.value(failure).pipe(
    Match.tagsExhaustive({
      RegistryFetchFailed: () => 'RegistryFetchFailed',
      RegistryMetadataMalformed: () => 'RegistryMetadataMalformed',
      RegistryIntegrityMismatch: () => 'RegistryIntegrityMismatch',
      AdoptionTagUnresolved: () => 'AdoptionTagUnresolved',
    }),
  )

const withWorkdir = <A, E, R>(context: Context, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.gen(function*() {
    const original = process.cwd()
    yield* Effect.sync(() => process.chdir(context.work))
    return yield* effect.pipe(Effect.ensuring(Effect.sync(() => process.chdir(original))))
  })

const cleanup = (context: Context) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    yield* Effect.promise(() => context.close())
    yield* fs.remove(context.root, { recursive: true, force: true })
  })

const phaseOfPlan = (outcome: Result.Result<PlanReport, unknown>): string =>
  Result.match(outcome, {
    onFailure: () => 'refused',
    onSuccess: (report) => planDecisionTag(report.decision),
  })

Feature('Adoption ledger').body(({ scenario }) => {
  scenario(
    'A lightweight release is adopted against its registry bytes and then plans green',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a fixture repository whose tags cover an older version, a retired name and a private member')(
        'context',
        () =>
          prepare({
            commits: [
              {
                packages: [{ name: ALPHA_NAME, version: PackageVersion.make('0.9.0') }],
                tags: [{ name: ALPHA_NAME, version: PackageVersion.make('0.9.0') }],
              },
              {
                packages: [
                  { name: ALPHA_NAME, version: ALPHA_VERSION },
                  { name: gritlintMember.name, version: gritlintMember.manifest.version, private: true },
                  {
                    name: PackageName.make('hex-schema'),
                    version: PackageVersion.make('1.0.0'),
                    manifestName: PackageName.make('@e2e/hex-schema'),
                  },
                ],
                tags: [
                  { name: ALPHA_NAME, version: ALPHA_VERSION },
                  { name: gritlintMember.name, version: gritlintMember.manifest.version },
                  { name: PackageName.make('hex-schema'), version: PackageVersion.make('1.0.0') },
                ],
              },
              {
                packages: [{ name: BETA_NAME, version: BETA_VERSION }],
                tags: [{ name: BETA_NAME, version: BETA_VERSION }],
              },
            ],
            serve: [
              { name: ALPHA_NAME, version: ALPHA_VERSION, files: { 'package/index.js': 'export const alpha = 1\n' } },
              {
                name: ALPHA_NAME,
                version: PackageVersion.make('0.9.0'),
                files: { 'package/index.js': 'export const alpha = 0\n' },
              },
              { name: BETA_NAME, version: BETA_VERSION, files: { 'package/index.js': 'export const retired = 1\n' } },
              {
                name: PackageName.make('@e2e/hex-schema'),
                version: PackageVersion.make('1.0.0'),
                files: { 'package/index.js': 'export const hex = 1\n' },
              },
            ],
          }),
      ),
      When('the release is adopted and then planned')(
        'outcome',
        (s) =>
          Effect.gen(function*() {
            const live = adaptersOf(s.context, [alphaMember, gritlintMember])
            return yield* withWorkdir(
              s.context,
              Effect.gen(function*() {
                const adopted = yield* attempt(Cell.run(Cell.provide(adoptCell, live), adoptRequest(s.context)))
                const ledger = yield* LedgerPort.pipe(
                  Effect.flatMap((port) => port.read(LEDGER_PATH)),
                  Effect.provide(live),
                )
                const planned = yield* attempt(Cell.run(Cell.provide(planCell, live), planRequest(s.context)))
                const commit = yield* git(s.context.work, ['rev-parse', `${tagOf(ALPHA_NAME, ALPHA_VERSION)}^{commit}`])
                return { adopted, ledger, planned, commit }
              }),
            )
          }),
      ),
      Then('the ledger records the peeled tag commit and the plan settles')(
        (s) =>
          Effect.gen(function*() {
            const outcome = s.outcome
            expect(
              Result.match(outcome.adopted, {
                onFailure: () => 'refused',
                onSuccess: (report) => adoptionDecisionTag(report.decision),
              }),
            ).toBe('AdoptionRecorded')
            expect(Option.isSome(outcome.ledger)).toBe(true)
            const entries = Option.getOrThrow(outcome.ledger).entries
            expect(entries.length).toBe(4)
            expect(entries.map((entry) => entry.tag)).toEqual([
              `${ALPHA_NAME}@v0.9.0`,
              `${ALPHA_NAME}@v1.0.0`,
              `${BETA_NAME}@v${BETA_VERSION}`,
              'hex-schema@v1.0.0',
            ])
            const unscoped = entries.find((entry) => entry.tag === 'hex-schema@v1.0.0')
            expect(unscoped?.package).toBe('@e2e/hex-schema')
            const published = publishedEntries(entries)
            expect(published[1]?.commit).toBe(outcome.commit)
            expect(published[1]?.version).toBe(ALPHA_VERSION)
            expect(published.every((entry) => entry.sha256.startsWith('sha256-'))).toBe(true)
            expect(Result.match(outcome.adopted, {
              onFailure: () => -1,
              onSuccess: (report) => report.excluded.length,
            })).toBe(1)
            expect(phaseOfPlan(outcome.planned)).toBe('PlanSettled')
            yield* cleanup(s.context)
          }),
      ),
    ),
  )

  scenario(
    'Moving a released tag away from its ledger commit refuses the plan red',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('an adopted fixture repository')(
        'context',
        () =>
          prepare({
            commits: [{
              packages: [{ name: ALPHA_NAME, version: ALPHA_VERSION }],
              tags: [{ name: ALPHA_NAME, version: ALPHA_VERSION }],
            }],
            serve: [{
              name: ALPHA_NAME,
              version: ALPHA_VERSION,
              files: { 'package/index.js': 'export const alpha = 1\n' },
            }],
          }),
      ),
      When('the tag is moved to a new commit and the plan runs')(
        'outcome',
        (s) =>
          Effect.gen(function*() {
            const live = adaptersOf(s.context, [alphaMember])
            return yield* withWorkdir(
              s.context,
              Effect.gen(function*() {
                yield* Cell.run(Cell.provide(adoptCell, live), adoptRequest(s.context))
                yield* git(s.context.work, ['commit', '-q', '--allow-empty', '-m', 'move'])
                yield* git(s.context.work, ['tag', '-f', tagOf(ALPHA_NAME, ALPHA_VERSION)])
                yield* git(s.context.work, [
                  'push',
                  '-q',
                  '--force',
                  'origin',
                  `refs/tags/${tagOf(ALPHA_NAME, ALPHA_VERSION)}`,
                ])
                return yield* attempt(Cell.run(Cell.provide(planCell, live), planRequest(s.context)))
              }),
            )
          }),
      ),
      Then('the refusal names the tag and both commits')(
        (s) =>
          Effect.gen(function*() {
            const tag = Result.match(s.outcome, {
              onFailure: (error) =>
                Match.value(error).pipe(
                  Match.tag('LedgerTagMoved', (moved) => moved.tag),
                  Match.tag('LedgerTagMissing', () => 'missing'),
                  Match.tag('LedgerEntryMismatch', () => 'mismatch'),
                  Match.tag('TagIntegrityMismatch', () => 'integrity'),
                  Match.tag('TagAnnotationLightweight', () => 'lightweight'),
                  Match.tag('TagAnnotationMalformed', () => 'malformed'),
                  Match.tag('TarballMissing', () => 'tarball-missing'),
                  Match.tag('TarballUnreadable', () => 'tarball-unreadable'),
                  Match.tag('LedgerUnreadable', () => 'ledger-unreadable'),
                  Match.tag('LedgerMalformed', () => 'ledger-malformed'),
                  Match.tag('LedgerUnwritable', () => 'ledger-unwritable'),
                  Match.orElse(() => 'other'),
                ),
              onSuccess: () => 'planned',
            })
            expect(tag).toBe(tagOf(ALPHA_NAME, ALPHA_VERSION))
            yield* cleanup(s.context)
          }),
      ),
    ),
  )

  scenario(
    'A new lightweight tag outside the ledger refuses the plan red',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('an adopted fixture repository that then gains a tagged member')(
        'context',
        () =>
          prepare({
            commits: [{
              packages: [{ name: ALPHA_NAME, version: ALPHA_VERSION }],
              tags: [{ name: ALPHA_NAME, version: ALPHA_VERSION }],
            }],
            serve: [{
              name: ALPHA_NAME,
              version: ALPHA_VERSION,
              files: { 'package/index.js': 'export const alpha = 1\n' },
            }],
          }),
      ),
      When('the new member is tagged lightweight and the plan runs')(
        'outcome',
        (s) =>
          Effect.gen(function*() {
            const live = adaptersOf(s.context, [alphaMember, betaMember])
            return yield* withWorkdir(
              s.context,
              Effect.gen(function*() {
                const fs = yield* FileSystem
                const path = yield* Path
                yield* Cell.run(Cell.provide(adoptCell, live), adoptRequest(s.context))
                const dir = path.join(s.context.work, 'packages', 'beta')
                yield* fs.makeDirectory(dir, { recursive: true })
                yield* fs.writeFileString(
                  path.join(dir, 'package.json'),
                  JSON.stringify({ name: BETA_NAME, version: BETA_VERSION }),
                )
                yield* fs.writeFile(
                  path.join(s.context.tarballs, tarNameOf(BETA_NAME, BETA_VERSION)),
                  tarballBytes(BETA_NAME, BETA_VERSION, { 'package/index.js': 'export const beta = 1\n' }),
                )
                yield* git(s.context.work, ['add', '-A'])
                yield* git(s.context.work, ['commit', '-q', '-m', 'chore: beta'])
                yield* git(s.context.work, ['tag', tagOf(BETA_NAME, BETA_VERSION)])
                yield* git(s.context.work, ['push', '-q', 'origin', '--tags'])
                return yield* attempt(Cell.run(Cell.provide(planCell, live), planRequest(s.context)))
              }),
            )
          }),
      ),
      Then('the refusal names the lightweight tag')(
        (s) =>
          Effect.gen(function*() {
            const tag = Result.match(s.outcome, {
              onFailure: (error) =>
                Match.value(error).pipe(
                  Match.tag('TagAnnotationLightweight', (lightweight) => lightweight.tag),
                  Match.tag('LedgerTagMoved', () => 'moved'),
                  Match.tag('LedgerTagMissing', () => 'missing'),
                  Match.tag('LedgerEntryMismatch', () => 'mismatch'),
                  Match.tag('TagIntegrityMismatch', () => 'integrity'),
                  Match.tag('TagAnnotationMalformed', () => 'malformed'),
                  Match.tag('TarballMissing', () => 'tarball-missing'),
                  Match.tag('TarballUnreadable', () => 'tarball-unreadable'),
                  Match.tag('LedgerUnreadable', () => 'ledger-unreadable'),
                  Match.tag('LedgerMalformed', () => 'ledger-malformed'),
                  Match.tag('LedgerUnwritable', () => 'ledger-unwritable'),
                  Match.orElse(() => 'other'),
                ),
              onSuccess: () => 'planned',
            })
            expect(tag).toBe(tagOf(BETA_NAME, BETA_VERSION))
            yield* cleanup(s.context)
          }),
      ),
    ),
  )

  scenario(
    'A ledgered release whose packed bytes changed refuses naming the first differing file',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('an adopted fixture repository whose tarball is then rebuilt')(
        'context',
        () =>
          prepare({
            commits: [{
              packages: [{ name: ALPHA_NAME, version: ALPHA_VERSION }],
              tags: [{ name: ALPHA_NAME, version: ALPHA_VERSION }],
            }],
            serve: [{
              name: ALPHA_NAME,
              version: ALPHA_VERSION,
              files: { 'package/index.js': 'export const alpha = 1\n' },
            }],
          }),
      ),
      When('the packed tarball changes and the plan runs')(
        'outcome',
        (s) =>
          Effect.gen(function*() {
            const live = adaptersOf(s.context, [alphaMember])
            return yield* withWorkdir(
              s.context,
              Effect.gen(function*() {
                const fs = yield* FileSystem
                const path = yield* Path
                yield* Cell.run(Cell.provide(adoptCell, live), adoptRequest(s.context))
                yield* fs.writeFile(
                  path.join(s.context.tarballs, tarNameOf(ALPHA_NAME, ALPHA_VERSION)),
                  tarballBytes(ALPHA_NAME, ALPHA_VERSION, { 'package/index.js': 'export const alpha = 2\n' }),
                )
                return yield* attempt(Cell.run(Cell.provide(planCell, live), planRequest(s.context)))
              }),
            )
          }),
      ),
      Then('the refusal names the tag, both hashes and package/index.js')(
        (s) =>
          Effect.gen(function*() {
            const file = Result.match(s.outcome, {
              onFailure: (error) =>
                Match.value(error).pipe(
                  Match.tag('TagIntegrityMismatch', (mismatch) => mismatch.file),
                  Match.tag('LedgerTagMoved', () => 'moved'),
                  Match.tag('LedgerTagMissing', () => 'missing'),
                  Match.tag('LedgerEntryMismatch', () => 'mismatch'),
                  Match.tag('TagAnnotationLightweight', () => 'lightweight'),
                  Match.tag('TagAnnotationMalformed', () => 'malformed'),
                  Match.tag('TarballMissing', () => 'tarball-missing'),
                  Match.tag('TarballUnreadable', () => 'tarball-unreadable'),
                  Match.tag('LedgerUnreadable', () => 'ledger-unreadable'),
                  Match.tag('LedgerMalformed', () => 'ledger-malformed'),
                  Match.tag('LedgerUnwritable', () => 'ledger-unwritable'),
                  Match.orElse(() => 'other'),
                ),
              onSuccess: () => 'planned',
            })
            expect(file).toBe('package/index.js')
            yield* cleanup(s.context)
          }),
      ),
    ),
  )

  scenario(
    'A tag the registry does not serve is ledgered as a burned version',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a tagged release the registry has never published')(
        'context',
        () =>
          prepare({
            commits: [{
              packages: [{ name: GONE_NAME, version: PackageVersion.make('1.0.0') }],
              tags: [{ name: GONE_NAME, version: PackageVersion.make('1.0.0') }],
            }],
            serve: [],
          }),
      ),
      When('adoption runs against that registry')(
        'outcome',
        (s) =>
          Effect.gen(function*() {
            const live = adaptersOf(s.context, [goneMember])
            return yield* withWorkdir(
              s.context,
              Effect.gen(function*() {
                const adopted = yield* attempt(Cell.run(Cell.provide(adoptCell, live), adoptRequest(s.context)))
                const ledger = yield* LedgerPort.pipe(
                  Effect.flatMap((port) => port.read(LEDGER_PATH)),
                  Effect.provide(live),
                )
                return { adopted, ledger }
              }),
            )
          }),
      ),
      Then('the ledger holds one unpublished entry carrying its evidence')(
        (s) =>
          Effect.gen(function*() {
            expect(Result.isSuccess(s.outcome.adopted)).toBe(true)
            expect(Option.isSome(s.outcome.ledger)).toBe(true)
            const entries = Option.getOrThrow(s.outcome.ledger).entries
            expect(entries.map(kindOf)).toEqual(['unpublished'])
            const unpublished = unpublishedEntries(entries)[0]
            expect(unpublished?.package).toBe(GONE_NAME)
            expect(unpublished?.version).toBe('1.0.0')
            expect(unpublished?.status).toBe(404)
            expect(unpublished?.url).toContain('%40e2e%2Fgone/1.0.0')
            yield* cleanup(s.context)
          }),
      ),
    ),
  )

  scenario(
    'A download whose bytes disagree with dist.integrity is a hard adoption error',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a tagged release whose registry declares a different integrity')(
        'context',
        () =>
          prepare({
            commits: [{
              packages: [{ name: DAEMON_NAME, version: PackageVersion.make('0.1.0') }],
              tags: [{ name: DAEMON_NAME, version: PackageVersion.make('0.1.0') }],
            }],
            serve: [{
              name: DAEMON_NAME,
              version: PackageVersion.make('0.1.0'),
              files: { 'package/index.js': 'export const daemon = 1\n' },
              integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
            }],
          }),
      ),
      When('adoption runs and downloads the tarball')(
        'outcome',
        (s) =>
          Effect.gen(function*() {
            const live = adaptersOf(s.context, [daemonMember])
            return yield* withWorkdir(
              s.context,
              attempt(Cell.run(Cell.provide(adoptCell, live), adoptRequest(s.context))),
            )
          }),
      ),
      Then('adoption refuses with an integrity mismatch and writes no ledger')(
        (s) =>
          Effect.gen(function*() {
            const fs = yield* FileSystem
            const path = yield* Path
            const kinds = Result.match(s.outcome, {
              onFailure: (error) =>
                Match.value(error).pipe(
                  Match.tag('AdoptionRefused', (refused) => refused.failures.map(failureTag)),
                  Match.tag('TagCapturedMalformed', () => ['tag-captured-malformed']),
                  Match.tag('TagExcludedMalformed', () => ['tag-excluded-malformed']),
                  Match.tag('LedgerUnwritable', () => ['ledger-unwritable']),
                  Match.orElse(() => ['other']),
                ),
              onSuccess: (report) => [adoptionDecisionTag(report.decision)],
            })
            expect(kinds).toContain('RegistryIntegrityMismatch')
            const written = yield* fs.exists(path.join(s.context.work, 'release-ledger.json'))
            expect(written).toBe(false)
            yield* cleanup(s.context)
          }),
      ),
    ),
  )

  scenario(
    'Changing a ledger entry already present at the base fails the append-only check red',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a repository whose base holds one ledger entry')(
        'context',
        () =>
          Effect.gen(function*() {
            const fs = yield* FileSystem
            const path = yield* Path
            const context = yield* prepare({
              commits: [{
                packages: [{ name: ALPHA_NAME, version: ALPHA_VERSION }],
                tags: [],
              }],
              serve: [],
            })
            const commit = yield* git(context.work, ['rev-parse', 'HEAD'])
            const entry = {
              _tag: 'published',
              tag: tagOf(ALPHA_NAME, ALPHA_VERSION),
              commit,
              package: ALPHA_NAME,
              version: ALPHA_VERSION,
              integrity: 'sha512-recorded',
              sha256: 'sha256-recorded',
              files: { 'package/package.json': 'sha512-recorded' },
            }
            yield* fs.writeFileString(
              path.join(context.work, 'release-ledger.json'),
              `${JSON.stringify({ entries: [entry] }, null, 2)}\n`,
            )
            yield* git(context.work, ['add', '-A'])
            yield* git(context.work, ['commit', '-q', '-m', 'chore: adopt'])
            const base = yield* git(context.work, ['rev-parse', 'HEAD'])
            yield* fs.writeFileString(
              path.join(context.work, 'release-ledger.json'),
              `${JSON.stringify({ entries: [{ ...entry, integrity: 'sha512-tampered' }] }, null, 2)}\n`,
            )
            yield* git(context.work, ['add', '-A'])
            yield* git(context.work, ['commit', '-q', '-m', 'chore: tamper'])
            return { ...context, base }
          }),
      ),
      When('the check compares the ledger at the base with the ledger at HEAD')(
        'outcome',
        (s) =>
          Effect.gen(function*() {
            const live = LedgerLive(RepoRoot.make(s.context.work)).pipe(Layer.provide(NodeServices.layer))
            return yield* LedgerPort.pipe(
              Effect.flatMap((port) =>
                Effect.gen(function*() {
                  const base = yield* port.readAt(GitRef.make(s.context.base), LEDGER_PATH)
                  const head = yield* port.read(LEDGER_PATH)
                  return verifyLedgerAppend(
                    LedgerAppendCommand.make({
                      base: Option.getOrElse(base, () => ReleaseLedger.make({ entries: [] })).entries,
                      head: Option.getOrElse(head, () => ReleaseLedger.make({ entries: [] })).entries,
                    }),
                  )
                })
              ),
              Effect.provide(live),
            )
          }),
      ),
      Then('the check fails red naming the changed tag')(
        (s) =>
          Effect.gen(function*() {
            const tag = Result.match(s.outcome, {
              onFailure: (error) =>
                Match.value(error).pipe(
                  Match.tag('LedgerAppendChanged', (changed) => changed.tag),
                  Match.tag('LedgerAppendRemoved', () => 'removed'),
                  Match.exhaustive,
                ),
              onSuccess: () => 'held',
            })
            expect(tag).toBe(tagOf(ALPHA_NAME, ALPHA_VERSION))
            yield* cleanup(s.context)
          }),
      ),
    ),
  )

  const daemonFixture: PrepareOptions = {
    commits: [
      {
        packages: [
          { name: DAEMON_NAME, version: PackageVersion.make('0.1.0') },
        ],
        tags: [
          { name: DAEMON_NAME, version: PackageVersion.make('0.1.0') },
          { name: DAEMON_NAME, version: PackageVersion.make('0.1.1') },
        ],
      },
    ],
    serve: [
      {
        name: DAEMON_NAME,
        version: PackageVersion.make('0.1.0'),
        files: { 'package/index.js': 'export const daemon = 1\n' },
      },
      {
        name: DAEMON_NAME,
        version: PackageVersion.make('0.1.1'),
        files: { 'package/index.js': 'export const daemon = 2\n' },
      },
    ],
  }

  scenario(
    'A tag whose manifest version differs records both registry states',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a fixture with a tag whose manifest version differs')(
        'context',
        () => prepare(daemonFixture),
      ),
      When('adoption runs')(
        'outcome',
        (s) =>
          Effect.gen(function*() {
            const live = adaptersOf(s.context, [daemonMember])
            return yield* withWorkdir(
              s.context,
              Effect.gen(function*() {
                yield* attempt(Cell.run(Cell.provide(adoptCell, live), adoptRequest(s.context)))
                return yield* LedgerPort.pipe(
                  Effect.flatMap((port) => port.read(LEDGER_PATH)),
                  Effect.provide(live),
                )
              }),
            )
          }),
      ),
      Then('the ledger holds one published and one mismatched entry')(
        (s) =>
          Effect.gen(function*() {
            expect(Option.isSome(s.outcome)).toBe(true)
            const entries = Option.getOrThrow(s.outcome).entries
            expect(entries.map(kindOf).sort()).toEqual(['mismatched', 'published'])
            const mismatched = mismatchedEntries(entries)[0]
            expect(mismatched?.package).toBe(DAEMON_NAME)
            expect(mismatched?.claimedVersion).toBe('0.1.1')
            expect(mismatched?.manifestVersion).toBe('0.1.0')
            const sides: Array<string> = []
            if (mismatched !== undefined) {
              for (const state of [mismatched.claimed, mismatched.manifest]) {
                sides.push(
                  Match.value(state).pipe(
                    Match.tag('published', () => 'published'),
                    Match.tag('unpublished', () => 'unpublished'),
                    Match.exhaustive,
                  ),
                )
              }
            }
            expect(sides).toEqual(['published', 'published'])
            yield* cleanup(s.context)
          }),
      ),
    ),
  )

  const goneFixture: PrepareOptions = {
    commits: [{
      packages: [{ name: GONE_NAME, version: PackageVersion.make('1.0.0') }],
      tags: [{ name: GONE_NAME, version: PackageVersion.make('1.0.0') }],
    }],
    serve: [],
  }

  scenario(
    'A burned version refuses the plan red',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('an adopted repository whose tag is burned')(
        'context',
        () => prepare(goneFixture),
      ),
      When('planning the burned version')(
        'outcome',
        (s) =>
          Effect.gen(function*() {
            const live = adaptersOf(s.context, [goneMember])
            return yield* withWorkdir(
              s.context,
              Effect.gen(function*() {
                yield* Cell.run(Cell.provide(adoptCell, live), adoptRequest(s.context))
                return yield* attempt(Cell.run(Cell.provide(planCell, live), planRequest(s.context)))
              }),
            )
          }),
      ),
      Then('the plan refuses naming the burned version and its evidence')(
        (s) =>
          Effect.gen(function*() {
            const burned = Result.match(s.outcome, {
              onFailure: (error) =>
                Match.value(error).pipe(
                  Match.tag('VersionBurned', (value) => `${value.package}@${value.version}:${value.status}`),
                  Match.orElse(() => 'other'),
                ),
              onSuccess: () => 'planned',
            })
            expect(burned).toBe(`${GONE_NAME}@1.0.0:404`)
            yield* cleanup(s.context)
          }),
      ),
    ),
  )

  scenario(
    'A burned version refuses tagging once its tag is gone',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('an adopted repository whose burned tag was deleted')(
        'context',
        () => prepare(goneFixture),
      ),
      When('tagging the cycle')(
        'outcome',
        (s) =>
          Effect.gen(function*() {
            const live = adaptersOf(s.context, [goneMember])
            return yield* withWorkdir(
              s.context,
              Effect.gen(function*() {
                yield* Cell.run(Cell.provide(adoptCell, live), adoptRequest(s.context))
                yield* git(s.context.work, [
                  'push',
                  '-q',
                  'origin',
                  `:refs/tags/${tagOf(GONE_NAME, PackageVersion.make('1.0.0'))}`,
                ])
                return yield* attempt(
                  Cell.run(Cell.provide(tagCell, live), {
                    tarballs: FsPath.make(s.context.tarballs),
                    changelogDir: RelativePath.make('.changeset/changelogs'),
                    dryRun: false,
                    json: false,
                  }),
                )
              }),
            )
          }),
      ),
      Then('the tag command refuses naming the burned version')(
        (s) =>
          Effect.gen(function*() {
            const burned = Result.match(s.outcome, {
              onFailure: (error) =>
                Match.value(error).pipe(
                  Match.tag('VersionBurned', (value) => `${value.package}@${value.version}:${value.status}`),
                  Match.orElse(() => 'other'),
                ),
              onSuccess: () => 'tagged',
            })
            expect(burned).toBe(`${GONE_NAME}@1.0.0:404`)
            yield* cleanup(s.context)
          }),
      ),
    ),
  )
})
