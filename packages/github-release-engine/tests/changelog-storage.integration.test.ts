import { NodeServices } from '@effect/platform-node'
import { ChangesetsPortLive } from '@systemfsoftware/changesets-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { githubReleaseCell } from '@systemfsoftware/github-release-engine'
import { GitRef, RelativePath, RepoRoot } from '@systemfsoftware/release-language'
import { bumpCell, BumpInput } from '@systemfsoftware/version-engine'
import {
  ChangelogStoreLive,
  ChangesetStoreLive,
  SurfaceStoreLive,
  WorkspaceStoreLive,
} from '@systemfsoftware/workspace-adapter'
import { Effect, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import * as S from 'effect/Schema'
import { expect, vi } from 'vitest'
import { makeFakeCycleStore } from './__fixtures__/FakeCycleStore.js'
import { makeFakeForge } from './__fixtures__/FakeForge.js'
import { makeFakeGit } from './__fixtures__/FakeGit.js'

const Feature = makeFeature({ it, layer })

const SPAWNS_REAL_PNPM_TIMEOUT_MS = 30_000
vi.setConfig({ testTimeout: SPAWNS_REAL_PNPM_TIMEOUT_MS })

const changelogDir = RelativePath.make('.changeset/changelogs')

const ROOT_MANIFEST = `{\n  "name": "@e2e/root",\n  "private": true,\n  "version": "0.0.0"\n}\n`
const ALPHA_MANIFEST = `{\n  "name": "@e2e/alpha",\n  "version": "1.0.0"\n}\n`
const BETA_MANIFEST =
  `{\n  "name": "@e2e/beta",\n  "version": "1.0.0",\n  "dependencies": {\n    "@e2e/alpha": "workspace:^1.0.0"\n  }\n}\n`
const ALPHA_CHANGELOG = '# @e2e/alpha\n\n## 1.0.0\n\n- first release\n'
const ALPHA_BUMPED = '# @e2e/alpha\n\n## 1.1.0\n\nalpha grows a public export\n\n## 1.0.0\n\n- first release\n'

const workspaceOf = (storage: 'registry' | 'repository') =>
  `packages:\n  - packages/*\nversioning:\n  changelog:\n    storage: ${storage}\n`

interface MemberChangelogs {
  readonly alpha?: string
  readonly beta?: string
}

const repoWith = (storage: 'registry' | 'repository', changelogs: MemberChangelogs = { alpha: ALPHA_CHANGELOG }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const root = yield* fs.makeTempDirectory({ prefix: `changelog-storage-${storage}-` })
    const memberChangelogs = Object.entries(changelogs).map(([member, text]) =>
      [`packages/${member}/CHANGELOG.md`, text] as const
    )
    const files: ReadonlyArray<readonly [string, string]> = [
      ['package.json', ROOT_MANIFEST],
      ['pnpm-workspace.yaml', workspaceOf(storage)],
      ['packages/alpha/package.json', ALPHA_MANIFEST],
      ['packages/beta/package.json', BETA_MANIFEST],
      ...memberChangelogs,
      ['.changeset/README.md', '# Changesets\n'],
      ['.changeset/changelogs/.gitkeep', ''],
      ['.changeset/alpha-minor.md', '---\n"@e2e/alpha": minor\n---\n\nalpha grows a public export\n'],
      ['.changeset/beta-patch.md', '---\n"@e2e/beta": patch\n---\n\nbeta fixes a bug\n'],
    ]
    yield* Effect.forEach(files, ([file, text]) =>
      Effect.gen(function*() {
        const full = path.join(root, file)
        yield* fs.makeDirectory(path.dirname(full), { recursive: true })
        yield* fs.writeFileString(full, text)
      }), { discard: true })
    return RepoRoot.make(root)
  })

const bumpThenRelease = (root: RepoRoot) =>
  Effect.gen(function*() {
    const workspace = WorkspaceStoreLive(root)
    const bumpLayer = Layer.mergeAll(
      workspace,
      SurfaceStoreLive(root),
      ChangelogStoreLive(root),
      ChangesetStoreLive({ root, changesetDir: RelativePath.make('.changeset') }),
      ChangesetsPortLive({ root, base: GitRef.make('main') }),
    ).pipe(Layer.provide(NodeServices.layer))
    const input = yield* S.decodeUnknownEffect(BumpInput)({
      strategy: 'changesets',
      changelogDir,
      manifest: { file: 'package.json', surface: { kind: 'json', path: 'package.json' } },
      surfaces: [],
    })
    yield* Cell.run(Cell.provide(bumpCell, bumpLayer), input)
    const forge = makeFakeForge()
    const releaseLayer = Layer.mergeAll(
      workspace.pipe(Layer.provide(NodeServices.layer)),
      makeFakeGit({ tags: [] }),
      makeFakeCycleStore().layer,
      forge.layer,
    )
    yield* Cell.run(
      Cell.provide(githubReleaseCell, releaseLayer),
      { assert: false, dryRun: false, changelogDir },
    )
    const notes = Object.fromEntries(forge.calls.created.map((release) => [release.tag, release.body]))
    return { root, notes }
  })

const filesUnder = (root: RepoRoot, dir: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    return [...(yield* fs.readDirectory(path.join(root, dir)))].sort()
  })

const textOf = (root: RepoRoot, file: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const full = path.join(root, file)
    if (!(yield* fs.exists(full))) return undefined
    return yield* fs.readFileString(full)
  })

Feature('Member changelogs follow the declared storage from bump to release').body(({ scenario }) => {
  scenario(
    'Under repository storage the release phase reads every moved member notes from its CHANGELOG.md',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('alpha with a changelog and beta without one, both with pending intents')(
        'root',
        () => repoWith('repository'),
      ),
      When('the intents are versioned and the releases are created')('run', (s) => bumpThenRelease(s.root)),
      Then('each member CHANGELOG.md gains its section, nothing is parked, and every release carries it')((s) =>
        Effect.gen(function*() {
          expect(yield* filesUnder(s.run.root, '.changeset/changelogs')).toEqual(['.gitkeep'])
          expect(yield* textOf(s.run.root, 'packages/alpha/CHANGELOG.md')).toEqual(
            '# @e2e/alpha\n\n## 1.1.0\n\nalpha grows a public export\n\n## 1.0.0\n\n- first release\n',
          )
          expect(yield* textOf(s.run.root, 'packages/beta/CHANGELOG.md')).toEqual(
            '# @e2e/beta\n\n## 1.0.1\n\nbeta fixes a bug\n',
          )
          expect(s.run.notes).toEqual({
            '@e2e/alpha@v1.1.0': '## 1.1.0\n\nalpha grows a public export',
            '@e2e/beta@v1.0.1': '## 1.0.1\n\nbeta fixes a bug',
          })
        })
      ),
    ),
  )

  scenario(
    'Under registry storage bump parks one file per moved member and the release phase reads it',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('alpha with a changelog and beta without one, both with pending intents')(
        'root',
        () => repoWith('registry'),
      ),
      When('the intents are versioned and the releases are created')('run', (s) => bumpThenRelease(s.root)),
      Then('each moved member is parked byte for byte, no CHANGELOG.md changes, and every release carries it')((s) =>
        Effect.gen(function*() {
          expect(yield* filesUnder(s.run.root, '.changeset/changelogs')).toEqual([
            '.gitkeep',
            '@e2e!alpha@1.1.0.md',
            '@e2e!beta@1.0.1.md',
          ])
          expect(yield* textOf(s.run.root, '.changeset/changelogs/@e2e!alpha@1.1.0.md')).toEqual(
            '# @e2e/alpha@1.1.0\n\nalpha grows a public export\n',
          )
          expect(yield* textOf(s.run.root, '.changeset/changelogs/@e2e!beta@1.0.1.md')).toEqual(
            '# @e2e/beta@1.0.1\n\nbeta fixes a bug\n',
          )
          expect(yield* textOf(s.run.root, 'packages/alpha/CHANGELOG.md')).toEqual(ALPHA_CHANGELOG)
          expect(yield* textOf(s.run.root, 'packages/beta/CHANGELOG.md')).toBeUndefined()
          expect(s.run.notes).toEqual({
            '@e2e/alpha@v1.1.0': '# @e2e/alpha@1.1.0\n\nalpha grows a public export\n',
            '@e2e/beta@v1.0.1': '# @e2e/beta@1.0.1\n\nbeta fixes a bug\n',
          })
        })
      ),
    ),
  )

  scenario(
    'Under repository storage the section lands above earlier sections whatever precedes them, in the file line endings',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('alpha with a CRLF changelog opening on a blank line and a preamble, beta with a setext title')(
        'root',
        () =>
          repoWith('repository', {
            alpha:
              '\r\n<!-- generated -->\r\n# @e2e/alpha\r\n\r\nAll notable changes.\r\n\r\n## 1.0.0\r\n\r\n- first release\r\n',
            beta: '@e2e/beta\n=========\n',
          }),
      ),
      When('the intents are versioned and the releases are created')('run', (s) => bumpThenRelease(s.root)),
      Then('each section sits below the title and preamble, alpha stays CRLF, and the releases carry only the section')(
        (
          s,
        ) =>
          Effect.gen(function*() {
            expect(yield* textOf(s.run.root, 'packages/alpha/CHANGELOG.md')).toEqual(
              '<!-- generated -->\r\n# @e2e/alpha\r\n\r\nAll notable changes.\r\n\r\n## 1.1.0\r\n\r\nalpha grows a public export\r\n\r\n## 1.0.0\r\n\r\n- first release\r\n',
            )
            expect(yield* textOf(s.run.root, 'packages/beta/CHANGELOG.md')).toEqual(
              '@e2e/beta\n=========\n\n## 1.0.1\n\nbeta fixes a bug\n',
            )
            expect(s.run.notes).toEqual({
              '@e2e/alpha@v1.1.0': '## 1.1.0\n\nalpha grows a public export',
              '@e2e/beta@v1.0.1': '## 1.0.1\n\nbeta fixes a bug',
            })
          }),
      ),
    ),
  )

  scenario(
    'Under repository storage a retried bump leaves a changelog that already has the version untouched',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('alpha whose changelog an interrupted bump already gave its 1.1.0 section')(
        'root',
        () => repoWith('repository', { alpha: ALPHA_BUMPED }),
      ),
      When('the intents are versioned and the releases are created')('run', (s) => bumpThenRelease(s.root)),
      Then('alpha has exactly one 1.1.0 section and its release carries it')((s) =>
        Effect.gen(function*() {
          expect(yield* textOf(s.run.root, 'packages/alpha/CHANGELOG.md')).toEqual(ALPHA_BUMPED)
          expect(s.run.notes['@e2e/alpha@v1.1.0']).toEqual('## 1.1.0\n\nalpha grows a public export')
        })
      ),
    ),
  )
})
