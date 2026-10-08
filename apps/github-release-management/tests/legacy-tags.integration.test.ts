import { NodeServices } from '@effect/platform-node'
import { LedgerLive } from '@systemfsoftware/adoption-adapter'
import { Reporter } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { GitLive } from '@systemfsoftware/git-adapter'
import { planCell, type PlanDecision, tagCell } from '@systemfsoftware/github-release-engine'
import { renderPlanRefusal } from '@systemfsoftware/github-release-management/render'
import {
  ChangesetsPort,
  ChangesetStore,
  Count,
  CycleStore,
  FsPath,
  LegacyTags,
  LegacyTagTemplate,
  ManifestUnreadable,
  type Member,
  PackageManifest,
  PackageName,
  PackageVersion,
  RelativePath,
  RepoRoot,
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
const OWN_TAG = (version: string): string => `${NAME}@v${version}`
const changelogDir = RelativePath.make('.changeset/changelogs')
const legacy = LegacyTags.make({
  tag: LegacyTagTemplate.make('v{version}'),
  through: PackageVersion.make('1.0.0'),
})

interface Commit {
  readonly version: string
  readonly tags: ReadonlyArray<string>
}

interface Repo {
  readonly scratch: string
  readonly root: string
  readonly tarballs: string
  readonly member: Member
}

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* ChildProcess.make('git', args, { cwd })
      const [stdout, code] = yield* Effect.all([
        Stream.mkString(Stream.decodeText(handle.stdout)),
        handle.exitCode,
      ], { concurrency: 'unbounded' })
      if (code !== 0) return yield* Effect.die(new Error(`git ${args.join(' ')} exited ${code}`))
      return stdout.trim()
    }),
  )

const releasedRepo = (commits: ReadonlyArray<Commit>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const scratch = yield* fs.makeTempDirectory({ prefix: 'legacy-tags-' })
    const root = path.join(scratch, 'work')
    const remote = path.join(scratch, 'origin.git')
    const tarballs = path.join(scratch, 'tarballs')
    yield* fs.makeDirectory(path.join(root, 'packages', 'alpha'), { recursive: true })
    yield* fs.makeDirectory(tarballs, { recursive: true })
    yield* git(scratch, 'init', '-q', '--bare', remote)
    yield* git(root, 'init', '-q', '-b', 'main')
    yield* git(root, 'config', 'commit.gpgsign', 'false')
    yield* git(root, 'config', 'tag.gpgsign', 'false')
    yield* git(root, 'remote', 'add', 'origin', remote)
    for (const commit of commits) {
      yield* fs.writeFileString(
        path.join(root, 'packages', 'alpha', 'package.json'),
        JSON.stringify({ name: NAME, version: commit.version }),
      )
      yield* git(root, 'add', '-A')
      yield* git(
        root,
        '-c',
        'user.name=seed',
        '-c',
        'user.email=seed@example.invalid',
        'commit',
        '-q',
        '-m',
        `chore: alpha ${commit.version}`,
      )
      for (const tag of commit.tags) {
        yield* git(root, 'tag', tag)
      }
    }
    yield* git(root, 'push', '-q', 'origin', 'main', '--tags')
    const repo: Repo = {
      scratch,
      root,
      tarballs,
      member: {
        name: NAME,
        dir: RelativePath.make('packages/alpha'),
        manifest: { name: NAME, version: PackageVersion.make(commits.at(-1)?.version ?? '0.0.0') },
        publishable: true,
      },
    }
    return repo
  })

const unused = () => Effect.die(new Error('unused store operation'))

const adaptersOf = (root: string, member: Member) =>
  Layer.mergeAll(
    GitLive,
    TarballLive,
    LedgerLive(RepoRoot.make(root)),
    Layer.succeed(WorkspaceStore, {
      root: RepoRoot.make(root),
      listMembers: () => Effect.succeed([member]),
      readManifest: (dir: RelativePath) => {
        if (dir !== member.dir) return Effect.fail(ManifestUnreadable.make({ path: FsPath.make(dir) }))
        return Effect.succeed(PackageManifest.make({ name: member.name, version: member.manifest.version }))
      },
      readFileFromRoot: () => Effect.fail(ManifestUnreadable.make({ path: FsPath.make('/') })),
      changelogStorage: () => Effect.succeed('registry' as const),
    }),
    Layer.succeed(ChangesetsPort, {
      plan: () => Effect.succeed({ changesets: Count.make(0), releases: [] }),
      apply: () => Effect.void,
    }),
    Layer.succeed(ChangesetStore, {
      listIntents: () => Effect.succeed([]),
      readIntent: unused,
      writeIntent: unused,
      deleteIntents: unused,
      readReadme: unused,
    }),
    Layer.succeed(CycleStore, {
      readCaptured: () => Effect.succeed([]),
      writeCaptured: () => Effect.succeed(Count.make(0)),
      readDeferred: () => Effect.succeed([]),
      writeDeferred: () => Effect.succeed(Count.make(0)),
    }),
  ).pipe(Layer.provide(NodeServices.layer))

const insideRepo = <A, E, R>(root: string, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.cwd()
      process.chdir(root)
      return previous
    }),
    () => effect,
    (previous) => Effect.sync(() => process.chdir(previous)),
  )

const plan = (repo: Repo, legacyTags: LegacyTags | undefined) =>
  insideRepo(
    repo.root,
    Effect.result(
      Cell.run(Cell.provide(planCell, adaptersOf(repo.root, repo.member)), {
        tarballs: FsPath.make(repo.tarballs),
        changelogDir,
        legacyTags,
      }),
    ),
  )

const succeeded = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw new Error(`expected success, got ${JSON.stringify(result.failure)}`)
  return result.success
}

const refused = <A, E>(result: Result.Result<A, E>): E => {
  if (Result.isSuccess(result)) throw new Error(`expected a refusal, got ${JSON.stringify(result.success)}`)
  return result.failure
}

const cycleTags = (decision: PlanDecision): ReadonlyArray<string> =>
  Match.value(decision).pipe(
    Match.tagsExhaustive({
      PlanVersion: () => [],
      PlanRelease: (release) => release.cycle.map((entry) => entry.tag),
      PlanSettled: () => [],
    }),
  )

const cleanUp = (scratch: string) =>
  Effect.flatMap(FileSystem, (fs) => fs.remove(scratch, { recursive: true }).pipe(Effect.orDie))

Feature('Recognising releases cut under a legacy tag scheme').body(({ scenario }) => {
  scenario(
    'A version released as a lightweight v-tag before the toolchain is not released again',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('alpha 1.0.0 released as the lightweight tag v1.0.0 and a legacy scheme through 1.0.0')(
        'repo',
        () => releasedRepo([{ version: '0.9.0', tags: ['v0.9.0'] }, { version: '1.0.0', tags: ['v1.0.0'] }]),
      ),
      When('planning and then dry-run tagging the release')('run', (s) =>
        Effect.gen(function*() {
          const planned = yield* plan(s.repo, legacy)
          const tagged = yield* insideRepo(
            s.repo.root,
            Effect.result(
              Cell.run(Cell.provide(tagCell, adaptersOf(s.repo.root, s.repo.member)), {
                tarballs: FsPath.make(s.repo.tarballs),
                dryRun: true,
                json: false,
                changelogDir,
                legacyTags: legacy,
              }),
            ),
          )
          const remoteTags = yield* git(s.repo.root, 'ls-remote', '--tags', 'origin')
          return { planned, tagged, remoteTags }
        })),
      Then('the plan settles, the dry run would tag nothing, and the origin gains no alpha@v1.0.0 tag')((s) =>
        Effect.ensuring(
          Effect.sync(() => {
            const planned = succeeded(s.run.planned)
            expect(planned.phase).toEqual('none')
            expect(planned.thisCycle).toEqual(Count.make(0))
            expect(succeeded(s.run.tagged)).toMatchObject({ _tag: 'TagPreview', tags: [] })
            expect(s.run.remoteTags).not.toContain(OWN_TAG('1.0.0'))
          }),
          cleanUp(s.repo.scratch),
        )
      ),
    ),
  )

  scenario(
    'Without a legacy scheme the same history owes the toolchain tag',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('alpha 1.0.0 released only as the lightweight tag v1.0.0')(
        'repo',
        () => releasedRepo([{ version: '1.0.0', tags: ['v1.0.0'] }]),
      ),
      When('planning the release with no legacy scheme')('planned', (s) => plan(s.repo, undefined)),
      Then('the cycle owes alpha@v1.0.0')((s) =>
        Effect.ensuring(
          Effect.sync(() => {
            const planned = succeeded(s.planned)
            expect(planned.phase).toEqual('release')
            expect(cycleTags(planned.decision)).toEqual([OWN_TAG('1.0.0')])
          }),
          cleanUp(s.repo.scratch),
        )
      ),
    ),
  )

  scenario(
    'A version past the legacy scheme is released under the toolchain tag even when a v-tag exists',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('alpha 1.1.0 tagged v1.1.0 while the legacy scheme ends at 1.0.0')(
        'repo',
        () => releasedRepo([{ version: '1.0.0', tags: ['v1.0.0'] }, { version: '1.1.0', tags: ['v1.1.0'] }]),
      ),
      When('planning the release')('planned', (s) => plan(s.repo, legacy)),
      Then('the cycle owes alpha@v1.1.0')((s) =>
        Effect.ensuring(
          Effect.sync(() => {
            expect(cycleTags(succeeded(s.planned).decision)).toEqual([OWN_TAG('1.1.0')])
          }),
          cleanUp(s.repo.scratch),
        )
      ),
    ),
  )

  scenario(
    'A legacy tag on a commit that declares another version is refused rather than trusted',
    { scenarioLayer: NodeServices.layer },
    Gherkin.Do.pipe(
      Given('the lightweight tag v1.0.0 sits on the commit that declares alpha 0.9.0')(
        'repo',
        () => releasedRepo([{ version: '0.9.0', tags: ['v1.0.0'] }, { version: '1.0.0', tags: [] }]),
      ),
      When('planning the release and rendering the refusal')('run', (s) =>
        Effect.gen(function*() {
          const planned = yield* plan(s.repo, legacy)
          const annotations = yield* Ref.make<ReadonlyArray<string>>([])
          const exitCodes = yield* Ref.make<ReadonlyArray<number>>([])
          if (Result.isFailure(planned)) {
            yield* renderPlanRefusal(planned.failure).pipe(
              Effect.provide(Layer.succeed(Reporter, {
                emit: () => Effect.void,
                note: () => Effect.void,
                annotateError: (text: string) => Ref.update(annotations, (lines) => [...lines, text]),
                exitCode: (code: number) => Ref.update(exitCodes, (codes) => [...codes, code]),
              })),
            )
          }
          return {
            planned,
            annotated: (yield* Ref.get(annotations)).join('\n'),
            exitCodes: yield* Ref.get(exitCodes),
          }
        })),
      Then('the plan refuses with the tag, the package and the version the tagged commit declares')((s) =>
        Effect.ensuring(
          Effect.sync(() => {
            expect(refused(s.run.planned)).toMatchObject({ _tag: 'LegacyTagUnverified', tag: 'v1.0.0' })
            expect(s.run.annotated).toContain('refused: legacy-tag-unverified, tag: v1.0.0')
            expect(s.run.annotated).toContain(`package: ${NAME}@1.0.0`)
            expect(s.run.annotated).toContain(`declares ${NAME}@0.9.0`)
            expect(s.run.exitCodes).toEqual([1])
          }),
          cleanUp(s.repo.scratch),
        )
      ),
    ),
  )
})
