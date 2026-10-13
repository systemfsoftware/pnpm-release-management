import { NodeServices } from '@effect/platform-node'
import { LedgerLive } from '@systemfsoftware/adoption-adapter'
import { Reporter } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { GitLive } from '@systemfsoftware/git-adapter'
import { unreleasedTarballsCell, type UnreleasedTarballsDecision } from '@systemfsoftware/github-release-engine'
import { renderUnreleasedTarballsRefusal } from '@systemfsoftware/github-release-management/render'
import {
  ChangeEvidencePort,
  ChangesetsPort,
  Count,
  FsPath,
  GitRef,
  ManifestUnreadable,
  type Member,
  PackageManifest,
  PackageName,
  PackageVersion,
  RelativePath,
  RepoRoot,
  TarballPort,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { TarballLive } from '@systemfsoftware/tarball-adapter'
import { Effect, Layer, Ref, Result } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import * as Match from 'effect/Match'
import { Path } from 'effect/Path'
import * as Stream from 'effect/Stream'
import { ChildProcess } from 'effect/unstable/process'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const NAME = PackageName.make('@scope/alpha')
const VERSION = PackageVersion.make('1.0.0')
const TAG = `${NAME}@v${VERSION}`

const member: Member = {
  name: NAME,
  dir: RelativePath.make('packages/alpha'),
  manifest: { name: NAME, version: VERSION },
  publishable: true,
}

interface Repo {
  readonly scratch: string
  readonly root: string
  readonly tarballs: string
}

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* ChildProcess.make('git', [
        '-c',
        'commit.gpgsign=false',
        '-c',
        'tag.gpgsign=false',
        '-c',
        'user.name=seed',
        '-c',
        'user.email=seed@example.invalid',
        ...args,
      ], { cwd })
      const [stdout, code] = yield* Effect.all([
        Stream.mkString(Stream.decodeText(handle.stdout)),
        handle.exitCode,
      ], { concurrency: 'unbounded' })
      if (code !== 0) return yield* Effect.die(new Error(`git ${args.join(' ')} exited ${code}`))
      return stdout.trim()
    }),
  )

const packAlpha = (repo: Repo) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    yield* fs.remove(repo.tarballs, { recursive: true, force: true })
    yield* fs.makeDirectory(repo.tarballs, { recursive: true })
    yield* git(
      repo.root,
      'archive',
      '--format=tar.gz',
      '--prefix=package/',
      '--mtime=@0',
      '-o',
      path.join(repo.tarballs, 'alpha.tgz'),
      'HEAD:packages/alpha',
    )
  })

const write = (repo: Repo, file: string, text: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    yield* fs.makeDirectory(path.dirname(path.join(repo.root, file)), { recursive: true })
    yield* fs.writeFileString(path.join(repo.root, file), text)
  })

const releasedRepo = Effect.gen(function*() {
  const fs = yield* FileSystem
  const path = yield* Path
  const scratch = yield* fs.makeTempDirectory({ prefix: 'unreleased-tarballs-' })
  const repo: Repo = { scratch, root: path.join(scratch, 'work'), tarballs: path.join(scratch, 'tarballs') }
  const remote = path.join(scratch, 'origin.git')
  yield* fs.makeDirectory(repo.root, { recursive: true })
  yield* git(scratch, 'init', '-q', '--bare', remote)
  yield* git(repo.root, 'init', '-q', '-b', 'main')
  yield* git(repo.root, 'remote', 'add', 'origin', remote)
  yield* write(repo, 'packages/alpha/package.json', JSON.stringify({ name: NAME, version: VERSION }))
  yield* write(repo, 'packages/alpha/index.js', 'export const alpha = 1\n')
  yield* git(repo.root, 'add', '-A')
  yield* git(repo.root, 'commit', '-q', '-m', 'feat: alpha 1.0.0')
  yield* packAlpha(repo)
  const [released] = yield* Effect.flatMap(TarballPort, (port) => port.read(FsPath.make(repo.tarballs)))
  if (released === undefined) return yield* Effect.die(new Error('no tarball packed for the release'))
  const annotation = JSON.stringify({ integrity: released.integrity, files: released.files })
  yield* git(repo.root, 'tag', '-a', TAG, '-m', annotation)
  yield* git(repo.root, 'push', '-q', 'origin', 'main', '--tags')
  return repo
}).pipe(Effect.provide(TarballLive))

const RELEASES = {
  none: [],
  minor: [{
    name: NAME,
    type: 'minor' as const,
    oldVersion: VERSION,
    newVersion: PackageVersion.make('1.1.0'),
    summary: 'alpha grows a public export',
  }],
} as const

const adaptersOf = (repo: Repo, releases: (typeof RELEASES)[keyof typeof RELEASES]) =>
  Layer.mergeAll(
    GitLive,
    TarballLive,
    LedgerLive(RepoRoot.make(repo.root)),
    Layer.succeed(WorkspaceStore, {
      root: RepoRoot.make(repo.root),
      listMembers: () => Effect.succeed([member]),
      readManifest: () => Effect.succeed(PackageManifest.make({ name: NAME, version: VERSION })),
      readFileFromRoot: () => Effect.fail(ManifestUnreadable.make({ path: FsPath.make('/') })),
      changelogStorage: () => Effect.succeed('registry' as const),
    }),
    Layer.succeed(ChangeEvidencePort, {
      pathsEvidence: () => Effect.succeed({ members: [member], touched: [NAME], deleted: [], raw: null }),
      turboEvidence: () => Effect.die(new Error('the repository gates by paths')),
    }),
    Layer.succeed(ChangesetsPort, {
      plan: () => Effect.succeed({ changesets: Count.make(1), releases }),
      apply: () => Effect.void,
    }),
  ).pipe(Layer.provide(NodeServices.layer))

const tarballsOf = (repo: Repo, packed: boolean): FsPath | undefined => {
  if (packed) return FsPath.make(repo.tarballs)
  return undefined
}

const compare = (repo: Repo, options: { readonly bump: keyof typeof RELEASES; readonly packed: boolean }) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.cwd()
      process.chdir(repo.root)
      return previous
    }),
    () =>
      Effect.result(
        Cell.run(Cell.provide(unreleasedTarballsCell, adaptersOf(repo, RELEASES[options.bump])), {
          root: RepoRoot.make(repo.root),
          ref: GitRef.make('main'),
          strategy: 'paths' as const,
          tarballs: tarballsOf(repo, options.packed),
        }),
      ),
    (previous) => Effect.sync(() => process.chdir(previous)),
  )

const decisionOf = (decision: UnreleasedTarballsDecision): string =>
  Match.value(decision).pipe(
    Match.tagsExhaustive({
      UnreleasedVacant: () => 'nothing to compare',
      UnreleasedListed: (listed) => `listed ${listed.packages.join(' ')}`,
      UnreleasedMatched: (matched) => `matched ${matched.packages.join(' ')}`,
    }),
  )

const refusalLine = <E extends Parameters<typeof renderUnreleasedTarballsRefusal>[0]>(refusal: E) =>
  Effect.gen(function*() {
    const errors = yield* Ref.make<ReadonlyArray<string>>([])
    yield* renderUnreleasedTarballsRefusal(refusal).pipe(Effect.provide(Layer.succeed(Reporter, {
      emit: () => Effect.void,
      note: () => Effect.void,
      annotateError: (text: string) => Ref.update(errors, (all) => [...all, text]),
      exitCode: () => Effect.void,
    })))
    return (yield* Ref.get(errors)).join('\n')
  })

const removeRepository = (repo: Repo) =>
  Effect.flatMap(FileSystem, (fs) => fs.remove(repo.scratch, { recursive: true }).pipe(Effect.orDie))

const CHANGES = {
  'a file outside the package': ['README.md', '# fixture\n'],
  'a file the package packs': ['packages/alpha/index.js', 'export const alpha = 2\n'],
} as const

const changedAfterRelease = (change: keyof typeof CHANGES) =>
  Effect.gen(function*() {
    const repo = yield* releasedRepo
    const [file, text] = CHANGES[change]
    yield* write(repo, file, text)
    yield* git(repo.root, 'add', '-A')
    yield* git(repo.root, 'commit', '-q', '-m', 'chore: change after the release')
    yield* packAlpha(repo)
    return repo
  })

Feature('Comparing the tarballs of released packages a pull request changes without releasing').body(
  ({ scenario, scenarioOutline }) => {
    scenarioOutline(
      'A pull request that changes <change> after alpha 1.0.0 is tagged, under a <bump> intent, <outcome>',
      [
        { change: 'a file outside the package', bump: 'none', packed: true, outcome: 'matched @scope/alpha' },
        { change: 'a file the package packs', bump: 'none', packed: false, outcome: 'listed @scope/alpha' },
        { change: 'a file the package packs', bump: 'minor', packed: true, outcome: 'nothing to compare' },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given(`alpha released as an annotated ${TAG} and then ${row.change} changed`)(
            'repo',
            () => changedAfterRelease(row.change),
          ),
          When('the unreleased tarballs are compared')('outcome', (s) =>
            compare(s.repo, { bump: row.bump, packed: row.packed })),
          Then(`the comparison is ${row.outcome}`)((s) =>
            Effect.gen(function*() {
              if (Result.isFailure(s.outcome)) {
                throw new Error(`expected a decision, got ${JSON.stringify(s.outcome.failure)}`)
              }
              expect(decisionOf(s.outcome.success)).toBe(row.outcome)
              yield* removeRepository(s.repo)
            })
          ),
        ),
      { scenarioLayer: NodeServices.layer },
    )

    scenario(
      'A pull request that changes a packed file of released alpha under a none intent is refused',
      { scenarioLayer: NodeServices.layer },
      Gherkin.Do.pipe(
        Given(`alpha released as an annotated ${TAG} and then a file it packs changed`)(
          'repo',
          () => changedAfterRelease('a file the package packs'),
        ),
        When('the unreleased tarballs are compared')(
          'outcome',
          (s) => compare(s.repo, { bump: 'none', packed: true }),
        ),
        Then('the refusal names the tag, the first differing file and the fix')((s) =>
          Effect.gen(function*() {
            if (Result.isSuccess(s.outcome)) {
              throw new Error(`expected a refusal, got ${decisionOf(s.outcome.success)}`)
            }
            const line = yield* refusalLine(s.outcome.failure)
            expect(line).toContain(`tag digests refused: ${TAG} changed without a release`)
            expect(line).toContain('first differing file package/index.js')
            expect(line).toContain(`give ${NAME} a real bump in its intent, or revert its change`)
            yield* removeRepository(s.repo)
          })
        ),
      ),
    )
  },
)
