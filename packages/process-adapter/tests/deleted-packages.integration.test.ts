import { NodeServices } from '@effect/platform-node'
import { RegistryLive } from '@systemfsoftware/adoption-adapter'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { ChangeEvidenceLive } from '@systemfsoftware/process-adapter'
import {
  type ChangeEvidence,
  ChangeEvidencePort,
  GitPort,
  GitRef,
  RelativePath,
  RepoRoot,
  TaskName,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient'
import { ChildProcess } from 'effect/unstable/process'
import { expect } from 'vitest'
import { fakeGitChanging } from './__fixtures__/FakeGitPort.js'
import { type ServedTurbo, serveTurbo } from './__fixtures__/served-turbo.js'

const Feature = makeFeature({ it, layer })

const TURBO = '2.10.1'

const lockfile = (packages: string): string =>
  [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    devDependencies:',
    '      turbo:',
    `        specifier: ^${TURBO}`,
    `        version: ${TURBO}`,
    '',
    'packages:',
    '',
    packages,
    '',
  ].join('\n')

const registry = (served: ServedTurbo) =>
  RegistryLive.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, served.fetch)),
  )

const evidenceLayer = (served: ServedTurbo, git: Layer.Layer<GitPort>) =>
  ChangeEvidenceLive.pipe(Layer.provide(git), Layer.provide(registry(served)))

const CHANGED = [RelativePath.make('packages/gone/index.js'), RelativePath.make('packages/gone/package.json')]

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* ChildProcess.make(
        'git',
        ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args],
        { cwd },
      )
      const code = yield* handle.exitCode
      if (code !== 0) return yield* Effect.die(new Error(`git ${args.join(' ')} exited ${code}`))
    }),
  )

const GONE = [
  { kind: 'private', manifest: { name: '@t/gone', version: '1.0.0', private: true } },
  { kind: 'publishable', manifest: { name: '@t/gone', version: '1.0.0' } },
] as const

const repositoryDeleting = (gone: (typeof GONE)[number]['manifest']) =>
  Effect.gen(function*() {
    const served = serveTurbo({ pin: TURBO })
    const fs = yield* FileSystem
    const path = yield* Path
    const root = yield* fs.makeTempDirectory({ prefix: 'deleted-packages-' })
    const write = (file: string, text: string) =>
      Effect.flatMap(
        fs.makeDirectory(path.dirname(path.join(root, file)), { recursive: true }),
        () => fs.writeFileString(path.join(root, file), text),
      )
    yield* write('pnpm-lock.yaml', lockfile(served.packagesYaml()))
    yield* write('packages/keep/package.json', JSON.stringify({ name: '@t/keep', version: '1.0.0' }))
    yield* write('packages/gone/package.json', JSON.stringify(gone))
    yield* write('packages/gone/index.js', 'export const gone = 1\n')
    yield* git(root, 'init', '-q', '-b', 'main')
    yield* git(root, 'add', '-A')
    yield* git(root, 'commit', '-q', '-m', 'base')
    yield* git(root, 'tag', 'base')
    yield* fs.remove(path.join(root, 'packages/gone'), { recursive: true })
    yield* git(root, 'add', '-A')
    yield* git(root, 'commit', '-q', '-m', 'delete gone')
    return { root, served }
  })

const evidenceOf = (root: string) =>
  Effect.gen(function*() {
    const port = yield* ChangeEvidencePort
    return {
      turbo: yield* port.turboEvidence(RepoRoot.make(root), GitRef.make('base'), TaskName.make('build')),
      paths: yield* port.pathsEvidence(RepoRoot.make(root), GitRef.make('base')),
    }
  })

const expectDeletedOnly = (evidence: ChangeEvidence) => {
  expect(evidence.deleted).toEqual(['@t/gone'])
  expect(evidence.touched).toEqual([])
  expect(evidence.members.map((member) => member.name)).toEqual(['@t/keep'])
}

const repositoryDeletingOnBothSides = Effect.gen(function*() {
  const { root, served } = yield* repositoryDeleting(GONE[1].manifest)
  yield* git(root, 'checkout', '-q', '-b', 'upstream', 'base')
  yield* git(root, 'rm', '-q', '-r', 'packages/gone')
  yield* git(root, 'commit', '-q', '-m', 'upstream deletes gone too')
  yield* git(root, 'checkout', '-q', 'main')
  return { root, served }
})

Feature('Change evidence counts a package deleted on the head').body(({ scenario }) => {
  for (const { kind, manifest } of GONE) {
    scenario(
      `Deleting a ${kind} package lists it as deleted and moves nothing`,
      { scenarioLayer: NodeServices.layer },
      Gherkin.Do.pipe(
        Given(`a repository whose head deletes a ${kind} package present at base`)(
          'fixture',
          () => repositoryDeleting(manifest),
        ),
        When('turbo and paths evidence are collected against base')(
          'evidence',
          (s) =>
            evidenceOf(s.fixture.root).pipe(
              Effect.provide(evidenceLayer(s.fixture.served, fakeGitChanging(CHANGED))),
            ),
        ),
        Then('both read the deleted manifest from base, list it as deleted, and name no package to release')(
          (s) =>
            Effect.gen(function*() {
              const fs = yield* FileSystem
              expectDeletedOnly(s.evidence.turbo)
              expectDeletedOnly(s.evidence.paths)
              yield* fs.remove(s.fixture.root, { recursive: true, force: true })
            }),
        ),
      ),
    )
  }
  scenario(
    'A base branch that also deleted the package after the head branched still lists it as deleted',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a stacked head deleting a package that its base branch deleted after the fork')(
        'fixture',
        () => repositoryDeletingOnBothSides,
      ),
      When('paths evidence is collected against the base branch')(
        'evidence',
        (s) =>
          Effect.gen(function*() {
            const port = yield* ChangeEvidencePort
            return yield* port.pathsEvidence(RepoRoot.make(s.fixture.root), GitRef.make('upstream'))
          }).pipe(Effect.provide(evidenceLayer(s.fixture.served, fakeGitChanging(CHANGED)))),
      ),
      Then('the manifest is read at the merge-base and the package is listed as deleted')((s) =>
        Effect.gen(function*() {
          const fs = yield* FileSystem
          expectDeletedOnly(s.evidence)
          yield* fs.remove(s.fixture.root, { recursive: true, force: true })
        })
      ),
    ),
  )
})
