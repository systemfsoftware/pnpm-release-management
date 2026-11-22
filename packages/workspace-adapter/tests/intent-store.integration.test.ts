import { NodeServices } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { ChangesetStore, FsPath, RelativePath, ReleaseConfigStore, RepoRoot } from '@systemfsoftware/release-language'
import { ChangesetStoreLive, ReleaseConfigStoreLive } from '@systemfsoftware/workspace-adapter'
import { Effect } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const FILES: ReadonlyArray<readonly [string, string]> = [
  ['.changeset/fix-a.md', '---\n"@s/a": minor\n\'@s/b\': none\n---\n\nFixes the thing.\n'],
  ['.changeset/README.md', '# Changesets\n'],
  ['.changeset/readme.md', '# changesets\n'],
  ['.changeset/AGENTS.md', '# Agents\n'],
  ['.changeset/.draft.md', '---\n"@s/a": major\n---\n\nnot yet\n'],
  ['.changeset/config.json', '{}\n'],
  ['.changeset/changelogs/@s!a@1.0.0.md', '# @s/a@1.0.0\n'],
]

const scratchRoot = (files: ReadonlyArray<readonly [string, string]>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const root = yield* fs.makeTempDirectory({ prefix: 'workspace-adapter-intents-' })
    yield* Effect.forEach(files, ([file, text]) =>
      Effect.gen(function*() {
        yield* fs.makeDirectory(path.dirname(path.join(root, file)), { recursive: true })
        yield* fs.writeFileString(path.join(root, file), text)
      }), { discard: true })
    return RepoRoot.make(root)
  })

const configNaming = (changesetDir: string) =>
  Effect.flatMap(ReleaseConfigStore, (store) =>
    store.parseConfig(
      JSON.stringify({
        base: 'main',
        branch: 'changeset-release/main',
        changesetDir,
        versioning: { strategy: 'changesets' },
        gate: { strategy: 'paths' },
      }),
      FsPath.make('release.jsonc'),
    )).pipe(Effect.provide(ReleaseConfigStoreLive))

const intentsAt = (root: RepoRoot, changesetDir: RelativePath) =>
  Effect.gen(function*() {
    const store = yield* ChangesetStore
    const paths = yield* store.listIntents()
    return yield* Effect.forEach(paths, (file) => store.readIntent(file))
  }).pipe(Effect.provide(ChangesetStoreLive({ root, changesetDir })))

Feature('The changeset store reads exactly the intents the bump reads').body(({ scenarioOutline, scenario }) => {
  scenarioOutline(
    'A changeset directory written as <given> lists only the one intent file',
    [{ given: '.changeset' }, { given: './.changeset' }, { given: '.changeset/' }, { given: './.changeset/' }] as const,
    (row) =>
      Gherkin.Do.pipe(
        Given('a changeset directory holding one intent beside readmes, agent notes, a dotfile and changelogs')(
          'root',
          () => scratchRoot(FILES),
        ),
        Given(`a release config naming the directory ${row.given}`)('config', () => configNaming(row.given)),
        When('the intents are listed and read')('intents', (s) => intentsAt(s.root, s.config.changesetDir)),
        Then('only fix-a.md is read, with each package and bump')((s) =>
          Effect.sync(() => {
            expect(s.config.changesetDir).toBe('.changeset')
            expect(s.intents).toEqual([{
              path: '.changeset/fix-a.md',
              packages: [{ name: '@s/a', bump: 'minor' }, { name: '@s/b', bump: 'none' }],
              summary: 'Fixes the thing.',
            }])
          })
        ),
      ),
    { scenarioLayer: NodeServices.layer },
  )

  scenario(
    'An intent with no closing fence is refused as malformed',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('an intent whose frontmatter never closes')(
        'root',
        () => scratchRoot([['.changeset/broken.md', '---\n"@s/a": minor\n\nbody\n']]),
      ),
      When('the intents are read')('outcome', (s) => Effect.result(intentsAt(s.root, RelativePath.make('.changeset')))),
      Then('the refusal names the file')((s) =>
        Effect.sync(() => {
          expect(s.outcome).toMatchObject({
            failure: { _tag: 'IntentFrontmatterMalformed', path: '.changeset/broken.md' },
          })
        })
      ),
    ),
  )
})
