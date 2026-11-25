import { NodeServices } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { ChangeEvidencePort, GitRef, RepoRoot } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import { expect } from 'vitest'
import { git } from './__fixtures__/real-git.js'
import { evidenceServing } from './__fixtures__/served-turbo.js'

const Feature = makeFeature({ it, layer })

const GONE = [
  { kind: 'private', manifest: { name: '@t/gone', version: '1.0.0', private: true } },
  { kind: 'publishable', manifest: { name: '@t/gone', version: '1.0.0' } },
] as const

const repositoryDeleting = (gone: (typeof GONE)[number]['manifest']) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const root = yield* fs.makeTempDirectory({ prefix: 'deleted-packages-' })
    const write = (file: string, text: string) =>
      Effect.flatMap(
        fs.makeDirectory(path.dirname(path.join(root, file)), { recursive: true }),
        () => fs.writeFileString(path.join(root, file), text),
      )
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
    return root
  })

const repositoryDeletingOnBothSides = Effect.gen(function*() {
  const root = yield* repositoryDeleting(GONE[1].manifest)
  yield* git(root, 'checkout', '-q', '-b', 'upstream', 'base')
  yield* git(root, 'rm', '-q', '-r', 'packages/gone')
  yield* git(root, 'commit', '-q', '-m', 'upstream deletes gone too')
  yield* git(root, 'checkout', '-q', 'main')
  return root
})

const deletedAgainst = (root: string, base: string) =>
  Effect.gen(function*() {
    const port = yield* ChangeEvidencePort
    const range = yield* port.range(RepoRoot.make(root), GitRef.make(base))
    return yield* port.deletedMembers(RepoRoot.make(root), range)
  }).pipe(Effect.provide(evidenceServing))

const removed = (root: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    yield* fs.remove(root, { recursive: true, force: true })
  })

Feature('Change evidence counts a package deleted on the head').body(({ scenario }) => {
  for (const { kind, manifest } of GONE) {
    scenario(
      `Deleting a ${kind} package lists it as deleted`,
      { scenarioLayer: NodeServices.layer },
      Gherkin.Do.pipe(
        Given(`a repository whose head deletes a ${kind} package present at base`)(
          'root',
          () => repositoryDeleting(manifest),
        ),
        When('deleted members are collected against base')('deleted', (s) => deletedAgainst(s.root, 'base')),
        Then('the manifest is read at base and the package is listed as deleted')((s) =>
          Effect.gen(function*() {
            expect(s.deleted).toEqual(['@t/gone'])
            yield* removed(s.root)
          })
        ),
      ),
    )
  }
  scenario(
    'A base branch that also deleted the package after the head branched still lists it as deleted',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a stacked head deleting a package that its base branch deleted after the fork')(
        'root',
        () => repositoryDeletingOnBothSides,
      ),
      When('deleted members are collected against the base branch')(
        'deleted',
        (s) => deletedAgainst(s.root, 'upstream'),
      ),
      Then('the manifest is read at the merge-base and the package is listed as deleted')((s) =>
        Effect.gen(function*() {
          expect(s.deleted).toEqual(['@t/gone'])
          yield* removed(s.root)
        })
      ),
    ),
  )
})
