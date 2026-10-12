import { NodeServices } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { ChangeEvidenceLive } from '@systemfsoftware/process-adapter'
import {
  type ChangeEvidence,
  ChangeEvidencePort,
  GitRef,
  RelativePath,
  RepoRoot,
  TaskName,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import { ChildProcess } from 'effect/unstable/process'
import { expect } from 'vitest'
import { fakeGitChanging } from './__fixtures__/FakeGitPort.js'

const Feature = makeFeature({ it, layer })

const TURBO = '2.10.1'

const LOCKFILE = [
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
].join('\n')

const TURBO_DRY_RUN_OVER_PRESENT_MANIFESTS = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.join(process.cwd(), 'packages')
const packages = []
const tasks = []
for (const dir of fs.readdirSync(root).sort()) {
  const manifest = path.join(root, dir, 'package.json')
  if (!fs.existsSync(manifest)) continue
  const text = fs.readFileSync(manifest, 'utf8')
  const name = JSON.parse(text).name
  packages.push(name)
  tasks.push({ taskId: name + '#build', package: name, hash: crypto.createHash('sha256').update(text).digest('hex'), directory: 'packages/' + dir })
}
process.stdout.write(JSON.stringify({ packages, tasks, turboVersion: '${TURBO}' }))
`

const CHANGED = [RelativePath.make('packages/gone/index.js'), RelativePath.make('packages/gone/package.json')]

const live = Layer.merge(ChangeEvidenceLive.pipe(Layer.provide(fakeGitChanging(CHANGED))), NodeServices.layer)

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
    const fs = yield* FileSystem
    const path = yield* Path
    const root = yield* fs.makeTempDirectory({ prefix: 'deleted-packages-' })
    const write = (file: string, text: string) =>
      Effect.flatMap(
        fs.makeDirectory(path.dirname(path.join(root, file)), { recursive: true }),
        () => fs.writeFileString(path.join(root, file), text),
      )
    yield* write('pnpm-lock.yaml', LOCKFILE)
    yield* write('.gitignore', 'node_modules\n')
    yield* write('node_modules/turbo/package.json', JSON.stringify({ version: TURBO }))
    yield* write('node_modules/.bin/turbo', TURBO_DRY_RUN_OVER_PRESENT_MANIFESTS)
    yield* fs.chmod(path.join(root, 'node_modules/.bin/turbo'), 0o755)
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
  const root = yield* repositoryDeleting(GONE[1].manifest)
  yield* git(root, 'checkout', '-q', '-b', 'upstream', 'base')
  yield* git(root, 'rm', '-q', '-r', 'packages/gone')
  yield* git(root, 'commit', '-q', '-m', 'upstream deletes gone too')
  yield* git(root, 'checkout', '-q', 'main')
  return root
})

Feature('Change evidence counts a package deleted on the head').body(({ scenario }) => {
  for (const { kind, manifest } of GONE) {
    scenario(
      `Deleting a ${kind} package lists it as deleted and moves nothing`,
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given(`a repository whose head deletes a ${kind} package present at base`)(
          'root',
          () => repositoryDeleting(manifest),
        ),
        When('turbo and paths evidence are collected against base')('evidence', (s) => evidenceOf(s.root)),
        Then('both read the deleted manifest from base, list it as deleted, and name no package to release')(
          (s) =>
            Effect.gen(function*() {
              const fs = yield* FileSystem
              expectDeletedOnly(s.evidence.turbo)
              expectDeletedOnly(s.evidence.paths)
              yield* fs.remove(s.root, { recursive: true, force: true })
            }),
        ),
      ),
    )
  }
  scenario(
    'A base branch that also deleted the package after the head branched still lists it as deleted',
    { scenarioLayer: live },
    Gherkin.Do.pipe(
      Given('a stacked head deleting a package that its base branch deleted after the fork')(
        'root',
        () => repositoryDeletingOnBothSides,
      ),
      When('paths evidence is collected against the base branch')('evidence', (s) =>
        Effect.gen(function*() {
          const port = yield* ChangeEvidencePort
          return yield* port.pathsEvidence(RepoRoot.make(s.root), GitRef.make('upstream'))
        })),
      Then('the manifest is read at the merge-base and the package is listed as deleted')((s) =>
        Effect.gen(function*() {
          const fs = yield* FileSystem
          expectDeletedOnly(s.evidence)
          yield* fs.remove(s.root, { recursive: true, force: true })
        })
      ),
    ),
  )
})
