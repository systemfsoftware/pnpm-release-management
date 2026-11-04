import { NodeServices } from '@effect/platform-node'
import { ChangesetsPortLive } from '@systemfsoftware/changesets-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
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
import * as Stream from 'effect/Stream'
import { ChildProcess } from 'effect/unstable/process'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const REPOSITORY = new URL('../../../', import.meta.url).pathname

const request = S.decodeUnknownEffect(BumpInput)({
  strategy: 'changesets',
  changelogDir: '.changeset/changelogs',
  manifest: { file: 'package.json', surface: { kind: 'json', path: 'package.json' } },
  surfaces: [],
})

const PARAGRAPH = 'Step contexts now carry `expect`: the assertions of whichever runner the play runs in.'
const SECOND_PARAGRAPH = 'The assertions are promise-shaped: `await` them.'
const LIST = [
  '- `DuplicateCapture` carries its capture name in `capture`, where it carried it in `name`.',
  '- Every `Schema.Class` the packages export is branded.',
].join('\n')

const MEMBER_CHANGELOG = {
  registry: '.changeset/changelogs/@e2e!alpha@1.1.0.md',
  repository: 'packages/alpha/CHANGELOG.md',
} as const

const INTENTS = {
  'a two-paragraph intent and a list intent': [[PARAGRAPH, SECOND_PARAGRAPH], [LIST]],
  'a list intent and a paragraph intent': [[LIST], [PARAGRAPH]],
} as const satisfies Record<string, ReadonlyArray<ReadonlyArray<string>>>

const intentFilesOf = (intents: keyof typeof INTENTS): ReadonlyArray<readonly [string, string]> =>
  INTENTS[intents].map((blocks, index) => [
    `.changeset/intent-${index}.md`,
    `---\n"@e2e/alpha": minor\n---\n\n${blocks.join('\n\n')}\n`,
  ])

const filesFor = (storage: keyof typeof MEMBER_CHANGELOG): ReadonlyArray<readonly [string, string]> => [
  ['package.json', '{\n  "name": "@e2e/root",\n  "private": true,\n  "version": "1.0.0"\n}\n'],
  ['pnpm-workspace.yaml', `packages:\n  - packages/*\nversioning:\n  changelog:\n    storage: ${storage}\n`],
  ['packages/alpha/package.json', '{\n  "name": "@e2e/alpha",\n  "version": "1.0.0"\n}\n'],
  ['.changeset/README.md', '# Changesets\n'],
]

const repositoryWith = (storage: keyof typeof MEMBER_CHANGELOG, intents: keyof typeof INTENTS) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'version-management-member-changelog-' })
    yield* Effect.forEach([...filesFor(storage), ...intentFilesOf(intents)], ([file, text]) =>
      Effect.gen(function*() {
        const full = path.join(root, file)
        yield* fs.makeDirectory(path.dirname(full), { recursive: true })
        yield* fs.writeFileString(full, text)
      }), { discard: true })
    return RepoRoot.make(root)
  })

const storesAt = (root: RepoRoot) =>
  Layer.mergeAll(
    WorkspaceStoreLive(root),
    SurfaceStoreLive(root),
    ChangelogStoreLive(root),
    ChangesetsPortLive({ root, base: GitRef.make('main') }),
    ChangesetStoreLive({ root, changesetDir: RelativePath.make('.changeset') }),
  ).pipe(Layer.provide(NodeServices.layer))

const versionPendingIntents = (root: RepoRoot) =>
  Effect.flatMap(request, (input) => Cell.run(Cell.provide(bumpCell, storesAt(root)), input))

const repositoryFormatCheck = (root: RepoRoot, file: string) =>
  Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* ChildProcess.make(
        `${REPOSITORY}bin/dprint`,
        ['check', '--config', `${REPOSITORY}dprint.json`, file],
        { cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      )
      const [stdout, stderr, code] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText, Stream.mkString),
          handle.stderr.pipe(Stream.decodeText, Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: 3 },
      )
      return { code, output: `${stdout}${stderr}` }
    }),
  )

const changelogOf = (root: RepoRoot, file: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    return yield* fs.readFileString(path.join(root, file))
  })

Feature('Release notes in a member changelog pass the repository format check').body(({ scenarioOutline }) => {
  scenarioOutline(
    'Versioning <intents> with <storage> changelog storage leaves a member changelog the format check accepts',
    [
      { storage: 'registry', intents: 'a two-paragraph intent and a list intent' },
      { storage: 'registry', intents: 'a list intent and a paragraph intent' },
      { storage: 'repository', intents: 'a two-paragraph intent and a list intent' },
    ] as const,
    (row) =>
      Gherkin.Do.pipe(
        Given(`a workspace member with ${row.intents} pending`)('root', () => repositoryWith(row.storage, row.intents)),
        When('the pending intents are versioned')('decision', (s) => versionPendingIntents(s.root)),
        Then('each intent is its own block in the member changelog and the format check passes')((s) =>
          Effect.gen(function*() {
            expect(s.decision._tag).toBe('VersionBumped')
            const file = MEMBER_CHANGELOG[row.storage]
            const lines = (yield* changelogOf(s.root, file)).split('\n')
            const expected = INTENTS[row.intents].flat().flatMap((block) => block.split('\n'))
            expect(lines).toEqual(expect.arrayContaining(expected))
            const verdict = yield* repositoryFormatCheck(s.root, file)
            expect(verdict.output).toBe('')
            expect(verdict.code).toBe(0)
          })
        ),
      ),
    { scenarioLayer: NodeServices.layer },
  )
})
