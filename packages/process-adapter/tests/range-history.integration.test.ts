import { NodeServices } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { ChangeEvidencePort, GitRef, RelativePath, RepoRoot } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import { expect } from 'vitest'
import { git } from './__fixtures__/real-git.js'
import { evidenceServing } from './__fixtures__/served-turbo.js'

const Feature = makeFeature({ it, layer })

const writer = (root: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    return (file: string, text: string) =>
      Effect.flatMap(
        fs.makeDirectory(path.dirname(path.join(root, file)), { recursive: true }),
        () => fs.writeFileString(path.join(root, file), text),
      )
  })

const queueDraft = Effect.gen(function*() {
  const fs = yield* FileSystem
  const root = yield* fs.makeTempDirectory({ prefix: 'range-history-' })
  const write = yield* writer(root)
  yield* write('packages/a/package.json', '{"name":"@t/a","version":"1.0.0"}\n')
  yield* write('.changeset/fix-a.md', '---\n"@t/a": patch\n---\n\nFixes a.\n')
  yield* git(root, 'init', '-q', '-b', 'main')
  yield* git(root, 'add', '-A')
  yield* git(root, 'commit', '-q', '-m', 'base')
  yield* git(root, 'tag', 'base')
  yield* git(root, 'checkout', '-q', '-b', 'release')
  yield* git(root, 'rm', '-q', '.changeset/fix-a.md')
  yield* write('packages/a/package.json', '{"name":"@t/a","version":"1.0.1"}\n')
  yield* git(root, 'commit', '-q', '-am', 'release')
  yield* git(root, 'checkout', '-q', '-b', 'mergify/merge-queue/0123abcd', 'base')
  yield* write('packages/b/index.js', 'export const b = 1\n')
  yield* git(root, 'add', '-A')
  yield* git(root, 'commit', '-q', '-m', 'feature')
  yield* git(root, 'merge', '-q', '--no-edit', 'release')
  return root
})

const removed = (root: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    yield* fs.remove(root, { recursive: true, force: true })
  })

Feature('Change evidence reads a range as the commits that built it').body(({ scenario }) => {
  scenario(
    'A queue draft merging a release branch into a feature commit is read commit by commit',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a merge-queue branch holding a feature commit and a clean merge of a release commit')(
        'root',
        () => queueDraft,
      ),
      When('the range against base is read')('facts', (s) =>
        Effect.gen(function*() {
          const port = yield* ChangeEvidencePort
          const root = RepoRoot.make(s.root)
          const range = yield* port.range(root, GitRef.make('base'))
          const commits = yield* port.commits(root, range)
          return {
            range,
            commits,
            intentsAtBase: yield* port.filesIn(root, range.mergeBase, RelativePath.make('.changeset')),
            intentAtBase: yield* port.fileAt(root, range.mergeBase, RelativePath.make('.changeset/fix-a.md')),
            intentAtHead: yield* port.fileAt(root, range.head, RelativePath.make('.changeset/fix-a.md')),
          }
        }).pipe(Effect.provide(evidenceServing))),
      Then('the release and feature commits carry their own changes and the clean merge carries none')((s) =>
        Effect.gen(function*() {
          const byParents = s.facts.commits.map((commit) => ({
            parents: commit.parents.length,
            changes: commit.changes,
            residue: commit.residue,
          }))
          expect(byParents).toHaveLength(3)
          expect(byParents).toContainEqual({
            parents: 1,
            changes: [{ path: 'packages/b/index.js', status: 'added' }],
            residue: [],
          })
          expect(byParents).toContainEqual({
            parents: 1,
            changes: [
              { path: '.changeset/fix-a.md', status: 'deleted' },
              { path: 'packages/a/package.json', status: 'modified' },
            ],
            residue: [],
          })
          expect(byParents.at(-1)).toEqual({ parents: 2, changes: [], residue: [] })
          expect(s.facts.range.mergeBase).toBe(s.facts.range.base)
          expect(s.facts.intentsAtBase).toEqual(['.changeset/fix-a.md'])
          expect(s.facts.intentAtBase).toContain('"@t/a": patch')
          expect(s.facts.intentAtHead).toBeUndefined()
          yield* removed(s.root)
        })
      ),
    ),
  )

  scenario(
    'A merge that edits a file neither parent changed carries that file as residue',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a queue draft whose merge commit was amended to edit a workflow')('root', () =>
        Effect.gen(function*() {
          const root = yield* queueDraft
          const write = yield* writer(root)
          yield* write('.github/workflows/ci.yml', 'on: push\n')
          yield* git(root, 'add', '-A')
          yield* git(root, 'commit', '-q', '--amend', '--no-edit')
          return root
        })),
      When('the range against base is read')('commits', (s) =>
        Effect.gen(function*() {
          const port = yield* ChangeEvidencePort
          const root = RepoRoot.make(s.root)
          return yield* port.commits(root, yield* port.range(root, GitRef.make('base')))
        }).pipe(Effect.provide(evidenceServing))),
      Then('the merge commit names the workflow as residue')((s) =>
        Effect.gen(function*() {
          expect(s.commits.at(-1)?.residue).toEqual(['.github/workflows/ci.yml'])
          yield* removed(s.root)
        })
      ),
    ),
  )

  scenario(
    'A shallow clone is refused before any history is read',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('a depth-one clone of a queue draft')('dirs', () =>
        Effect.gen(function*() {
          const fs = yield* FileSystem
          const source = yield* queueDraft
          const clone = yield* fs.makeTempDirectory({ prefix: 'range-history-shallow-' })
          yield* git(clone, 'clone', '-q', '--depth', '1', '--no-local', `file://${source}`, '.')
          return { source, clone }
        })),
      When('the range is read')('outcome', (s) =>
        Effect.result(
          Effect.flatMap(ChangeEvidencePort, (port) => port.range(RepoRoot.make(s.dirs.clone), GitRef.make('HEAD')))
            .pipe(Effect.provide(evidenceServing)),
        )),
      Then('the refusal names the shallow clone')((s) =>
        Effect.gen(function*() {
          expect(s.outcome).toMatchObject({ failure: { _tag: 'EvidenceShallowClone' } })
          yield* removed(s.dirs.source)
          yield* removed(s.dirs.clone)
        })
      ),
    ),
  )
})
