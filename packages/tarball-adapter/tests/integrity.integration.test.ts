import { NodeServices } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { GitLive } from '@systemfsoftware/git-adapter'
import { IntegrityCommand, verifyIntegrity } from '@systemfsoftware/github-release-engine'
import {
  FsPath,
  GitPort,
  PackageName,
  PackageVersion,
  ReleaseTag,
  RemoteName,
  TarballIntegrity,
  TarballPort,
} from '@systemfsoftware/release-language'
import { TarballLive } from '@systemfsoftware/tarball-adapter'
import { Effect, Layer, Option, Result } from 'effect'
import * as Arr from 'effect/Array'
import { FileSystem } from 'effect/FileSystem'
import * as Match from 'effect/Match'
import { Path } from 'effect/Path'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'
import { expect } from 'vitest'
import { buildTarball } from './__fixtures__/build-tarball.js'

const Feature = makeFeature({ it, layer })

const live = Layer.merge(
  Layer.merge(GitLive, TarballLive).pipe(Layer.provide(NodeServices.layer)),
  NodeServices.layer,
)

const originalCwd = process.cwd()
const TAG = '@x/a@v1.0.0'
const LIGHTWEIGHT = '@x/a@v2.0.0'
const MEMBER = PackageName.make('@x/a')
const VERSION = PackageVersion.make('1.0.0')
const ORIGIN = RemoteName.make('origin')

const git = (args: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* spawner.spawn(ChildProcess.make('git', args))
    const [stdout, stderr] = yield* Effect.all(
      [
        Stream.mkString(Stream.decodeText(handle.stdout)),
        Stream.mkString(Stream.decodeText(handle.stderr)),
      ],
      { concurrency: 'unbounded' },
    )
    const code = yield* handle.exitCode
    if (code !== 0) {
      return yield* Effect.fail(new Error(`git ${args.join(' ')}: ${stderr}`))
    }
    return stdout
  })

Feature('Tarball identity').body(({ scenario }) => {
  scenario(
    'A recorded tag annotation verifies its tarball and refuses a changed tree and a lightweight tag',
    { scenarioLayer: live },
    Gherkin.Do.pipe(
      Given('a bare origin and a work tree holding the identity of one packed tarball')(
        'ctx',
        () =>
          Effect.gen(function*() {
            const fs = yield* FileSystem
            const path = yield* Path
            const root = yield* fs.makeTempDirectory({ prefix: 'tarball-integrity-' })
            const work = path.join(root, 'work')
            const dirA = path.join(root, 'a')
            const dirB = path.join(root, 'b')
            yield* fs.makeDirectory(dirA, { recursive: true })
            yield* fs.makeDirectory(dirB, { recursive: true })
            yield* fs.makeDirectory(work, { recursive: true })
            yield* git(['-C', work, 'init', '-q', '-b', 'main'])
            yield* git(['-C', work, 'config', 'user.email', 'test@example.invalid'])
            yield* git(['-C', work, 'config', 'user.name', 'test'])
            yield* fs.writeFileString(path.join(work, 'README.md'), '# fixture\n')
            yield* git(['-C', work, 'add', '-A'])
            yield* git(['-C', work, 'commit', '-q', '-m', 'chore: fixture'])
            yield* git(['-C', root, 'init', '-q', '--bare', 'origin.git'])
            const origin = path.join(root, 'origin.git')
            yield* git(['-C', work, 'remote', 'add', 'origin', origin])
            yield* git(['-C', work, 'push', '-q', '-u', 'origin', 'main'])
            return { root, work, dirA, dirB }
          }),
      ),
      When('the recorded annotation is checked against the same bytes and a changed tree')(
        'outcome',
        (s) =>
          Effect.gen(function*() {
            const fs = yield* FileSystem
            const path = yield* Path
            const tarballs = yield* TarballPort
            const work = s.ctx.work
            const dirA = FsPath.make(s.ctx.dirA)
            const dirB = FsPath.make(s.ctx.dirB)
            yield* fs.writeFile(
              path.join(s.ctx.dirA, 'a.tgz'),
              buildTarball({
                'package/package.json': JSON.stringify({ name: '@x/a', version: '1.0.0' }),
                'package/index.js': 'export const a = 1\n',
              }),
            )
            yield* fs.writeFile(
              path.join(s.ctx.dirB, 'b.tgz'),
              buildTarball({
                'package/package.json': JSON.stringify({
                  name: '@x/a',
                  version: '1.0.0',
                  dependencies: { '@x/b': '1.0.0' },
                }),
                'package/index.js': 'export const a = 1\n',
              }),
            )
            const digestA = Option.getOrThrow(Arr.head(yield* tarballs.read(dirA)))
            const digestB = Option.getOrThrow(Arr.head(yield* tarballs.read(dirB)))
            const message = JSON.stringify({ integrity: digestA.integrity, files: digestA.files })
            yield* git(['-C', work, 'tag', '-a', TAG, '-m', message])
            yield* git(['-C', work, 'push', '-q', 'origin', '--tags'])
            yield* Effect.sync(() => process.chdir(work))
            const gitPort = yield* GitPort
            const annotation = yield* gitPort.tagAnnotation(ORIGIN, ReleaseTag.make(TAG))
            const recorded = Option.getOrThrow(
              S.decodeUnknownOption(S.fromJsonString(TarballIntegrity))(Option.getOrThrow(annotation)),
            )
            const matched = verifyIntegrity(
              IntegrityCommand.make({
                checks: [{
                  package: MEMBER,
                  version: VERSION,
                  recorded,
                  current: { integrity: digestA.integrity, files: digestA.files },
                }],
              }),
            )
            const mismatched = verifyIntegrity(
              IntegrityCommand.make({
                checks: [{
                  package: MEMBER,
                  version: VERSION,
                  recorded,
                  current: { integrity: digestB.integrity, files: digestB.files },
                }],
              }),
            )
            yield* git(['-C', work, 'tag', LIGHTWEIGHT])
            yield* git(['-C', work, 'push', '-q', 'origin', '--tags'])
            const lightweight = yield* gitPort.tagAnnotation(ORIGIN, ReleaseTag.make(LIGHTWEIGHT))
            const matchedChecked = Result.match(matched, {
              onFailure: () => -1,
              onSuccess: (decision) =>
                Match.value(decision).pipe(
                  Match.tag('IntegrityVerified', (verified) => verified.checked),
                  Match.tag('IntegrityVacant', () => -2),
                  Match.exhaustive,
                ),
            })
            const mismatch = Result.match(mismatched, {
              onFailure: (failure) => failure,
              onSuccess: () => undefined,
            })
            return { digestA, digestB, recorded, matchedChecked, mismatch, lightweight }
          }),
      ),
      Then('the same bytes verify, the changed tree names package/package.json, and the lightweight tag is refused')(
        (s) =>
          Effect.gen(function*() {
            const fs = yield* FileSystem
            const outcome = s.outcome
            expect(outcome.recorded.integrity).toBe(outcome.digestA.integrity)
            expect(outcome.recorded.files).toEqual(outcome.digestA.files)
            expect(outcome.matchedChecked).toBe(1)
            expect(outcome.mismatch?.package).toBe('@x/a')
            expect(outcome.mismatch?.version).toBe('1.0.0')
            expect(outcome.mismatch?.recorded).toBe(outcome.digestA.integrity)
            expect(outcome.mismatch?.current).toBe(outcome.digestB.integrity)
            expect(outcome.mismatch?.file).toBe('package/package.json')
            expect(Option.isNone(outcome.lightweight)).toBe(true)
            yield* Effect.sync(() => process.chdir(originalCwd))
            yield* fs.remove(s.ctx.root, { recursive: true, force: true })
          }),
      ),
    ),
  )
})
