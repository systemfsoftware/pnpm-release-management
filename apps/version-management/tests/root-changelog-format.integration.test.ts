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
const ROOT_CHANGELOG = 'CHANGELOG.md'

const request = S.decodeUnknownEffect(BumpInput)({
  strategy: 'surfaces',
  changelogDir: '.changeset/changelogs',
  rootChangelog: ROOT_CHANGELOG,
  manifest: { file: 'package.json', surface: { kind: 'json', path: 'package.json' } },
  surfaces: [{ file: 'packages/alpha/package.json', surface: { kind: 'json', path: 'packages/alpha/package.json' } }],
})

const LONG_SUMMARY =
  '`version-management bump` now writes every bullet of the root changelog as a top-level list item, ' +
  'so the release pull request it opens passes the repository format check.'
const FIRST_PARAGRAPH = 'When `pnpm` cannot be started, the release tools now say so.'
const SECOND_PARAGRAPH = 'Breaking for adapter authors: the refusal union gains a case.'

const FILES: ReadonlyArray<readonly [string, string]> = [
  ['package.json', '{\n  "name": "@e2e/root",\n  "private": true,\n  "version": "1.0.0"\n}\n'],
  ['pnpm-workspace.yaml', 'packages:\n  - packages/*\n'],
  ['packages/alpha/package.json', '{\n  "name": "@e2e/alpha",\n  "version": "1.0.0"\n}\n'],
  ['.changeset/README.md', '# Changesets\n'],
  ['.changeset/alpha-format.md', `---\n"@e2e/alpha": minor\n---\n\n${LONG_SUMMARY}\n`],
  ['.changeset/alpha-unstartable.md', `---\n"@e2e/alpha": patch\n---\n\n${FIRST_PARAGRAPH}\n\n${SECOND_PARAGRAPH}\n`],
]

const STARTING_CHANGELOGS = {
  'no root changelog': [],
  'a changelog with an earlier release': [[ROOT_CHANGELOG, '# Changelog\n\n## 1.0.0\n\n- first release\n']],
} as const satisfies Record<string, ReadonlyArray<readonly [string, string]>>

const repositoryStartingWith = (start: keyof typeof STARTING_CHANGELOGS) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'version-management-root-changelog-' })
    yield* Effect.forEach([...FILES, ...STARTING_CHANGELOGS[start]], ([file, text]) =>
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

const repositoryFormatCheck = (root: RepoRoot) =>
  Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* ChildProcess.make(
        `${REPOSITORY}bin/dprint`,
        ['check', '--config', `${REPOSITORY}dprint.json`, ROOT_CHANGELOG],
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

const rootChangelogOf = (root: RepoRoot) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    return yield* fs.readFileString(path.join(root, ROOT_CHANGELOG))
  })

Feature('Release notes in the root changelog pass the repository format check').body(({ scenarioOutline }) => {
  scenarioOutline(
    'Versioning a repository that starts with <start> leaves a root changelog the format check accepts',
    [
      { start: 'no root changelog', kept: [] },
      { start: 'a changelog with an earlier release', kept: ['## 1.0.0', '- first release'] },
    ] as const,
    (row) =>
      Gherkin.Do.pipe(
        Given(`a repository with ${row.start} and two pending intents, one long and one of two paragraphs`)(
          'root',
          () => repositoryStartingWith(row.start),
        ),
        When('the pending intents are versioned')('decision', (s) => versionPendingIntents(s.root)),
        Then('the root changelog holds the new release and passes the repository format check')((s) =>
          Effect.gen(function*() {
            expect(s.decision._tag).toBe('VersionBumped')
            const changelog = yield* rootChangelogOf(s.root)
            const lines = changelog.split('\n')
            expect(lines).toContain('## 1.1.0')
            expect(lines).toContain(`- ${LONG_SUMMARY}`)
            expect(lines.find((line) => line.startsWith(`- ${FIRST_PARAGRAPH}`))).toContain(SECOND_PARAGRAPH)
            expect(lines).toEqual(expect.arrayContaining([...row.kept]))
            const verdict = yield* repositoryFormatCheck(s.root)
            expect(verdict.output).toBe('')
            expect(verdict.code).toBe(0)
          })
        ),
      ),
    { scenarioLayer: NodeServices.layer },
  )
})
