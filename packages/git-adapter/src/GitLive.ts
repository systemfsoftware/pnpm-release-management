import { NodeServices } from '@effect/platform-node'
import {
  BranchDeleted,
  CommitSha,
  Count,
  FsPath,
  GateIntentMissing,
  GateUnknownPackage,
  GitPort,
  GitRef,
  OwnerName,
  PackageManifest,
  PackageName,
  PullRequestGitFailed,
  PullRequestHeadInvalid,
  PullRequestTreeUnreadable,
  RelativePath,
  ReleaseTag,
  RepoName,
  StagedPath,
  StagedStateUnreadable,
  TagExcludedMalformed,
  TagGitFailed,
} from '@systemfsoftware/release-language'
import type {
  GateRefusal,
  PrTitle,
  PullRequestRefusal,
  RemoteName,
  RepoSlug,
  StagedChecksRefusal,
  TaggedManifest,
  TaggedTree,
  TagRefusal,
} from '@systemfsoftware/release-language'
import { Effect, Layer, Option, Result } from 'effect'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

const currentBranchPath = FsPath.make('git:current-branch')
const headShaPath = FsPath.make('git:head-sha')
const remoteTagsPath = FsPath.make('git:remote-tags')
const RELEASE_BOT_IDENTITY: ReadonlyArray<string> = [
  '-c',
  'user.name=github-actions[bot]',
  '-c',
  'user.email=41898282+github-actions[bot]@users.noreply.github.com',
]

const gitFailed = (args: ReadonlyArray<string>) => (stderr: string): PullRequestGitFailed =>
  PullRequestGitFailed.make({ command: `git ${args.join(' ')}`, stderr: stderr.trim() })
const tagGitFailed = (args: ReadonlyArray<string>) => (stderr: string): TagGitFailed =>
  TagGitFailed.make({ command: `git ${args.join(' ')}`, stderr: stderr.trim() })
const repoSlugPath = FsPath.make('git:repo-slug')
const diffPath = RelativePath.make('git:diff')

const headRef = GitRef.make('HEAD')
const unnamedPackage = PackageName.make('unknown')

const scpRemote = /^[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/
const httpsRemote = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?$/

const brandedSlug = (
  owner: string | undefined,
  repo: string | undefined,
): Option.Option<RepoSlug> => {
  if (owner === undefined || repo === undefined) {
    return Option.none()
  }
  return Option.all({
    owner: S.decodeUnknownOption(OwnerName)(owner),
    repo: S.decodeUnknownOption(RepoName)(repo),
  })
}

const declaredPair = (text: string): Option.Option<readonly [string, string]> => {
  const [owner, repo, extra] = text.split('/')
  if (extra !== undefined || owner === undefined || repo === undefined) {
    return Option.none()
  }
  return Option.some([owner, repo])
}

const remoteSlug = (url: string): Option.Option<RepoSlug> => {
  const match = scpRemote.exec(url) ?? httpsRemote.exec(url)
  if (match === null) {
    return Option.none()
  }
  return brandedSlug(match[1], match[2])
}

const declaredSlug = (): Option.Option<RepoSlug> => {
  const declared = process.env['GITHUB_REPOSITORY']
  if (declared === undefined) {
    return Option.none()
  }
  return Option.flatMap(declaredPair(declared), ([owner, repo]) => brandedSlug(owner, repo))
}

const nonEmptyLines = (text: string): ReadonlyArray<string> =>
  text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)

const annotationOf = (tagObject: string): string => {
  const separator = tagObject.indexOf('\n\n')
  if (separator === -1) return tagObject.trimEnd()
  return tagObject.slice(separator + 2).trimEnd()
}

const listedTags = (text: string): ReadonlyArray<string> =>
  text.split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/.*refs\/tags\//, '').replace(/\^\{\}$/, ''))
    .filter((tag) => tag.length > 0)

const branchAlreadyGone = (stderr: string): boolean =>
  stderr.includes('remote ref does not exist') || stderr.includes('does not exist')

const mergeHeadMissing = (stderr: string): boolean =>
  stderr.includes('Needed a single revision') || stderr.includes('unknown revision')

const makeGitPort = (
  spawner: ChildProcessSpawner.ChildProcessSpawner['Service'],
): GitPort => {
  const git = (
    args: ReadonlyArray<string>,
  ): Effect.Effect<Result.Result<string, string>> =>
    Effect.scoped(Effect.gen(function*() {
      const handle = yield* spawner.spawn(ChildProcess.make('git', args))
      const [stdout, stderr] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
        ],
        { concurrency: 'unbounded' },
      )
      const exitCode = yield* handle.exitCode
      if (exitCode === 0) {
        return Result.succeed(stdout)
      }
      return Result.fail(stderr)
    })).pipe(Effect.orElseSucceed(() => Result.fail('')))

  const capture = <A, E>(
    args: ReadonlyArray<string>,
    refuse: (failure: string) => E,
    decode: (stdout: string) => Result.Result<A, E>,
  ): Effect.Effect<A, E> =>
    Effect.flatMap(git(args), (outcome) => {
      if (Result.isFailure(outcome)) {
        return Effect.fail(refuse(outcome.failure))
      }
      return Effect.fromResult(decode(outcome.success))
    })

  const run = <E>(
    args: ReadonlyArray<string>,
    refuse: (failure: string) => E,
  ): Effect.Effect<void, E> => Effect.asVoid(capture(args, refuse, () => Result.succeed(undefined)))

  const tagValue = <A>(
    args: ReadonlyArray<string>,
    path: FsPath,
    schema: S.ConstraintDecoder<A>,
    shape: (stdout: string) => unknown,
  ): Effect.Effect<A, TagRefusal> =>
    capture<A, TagRefusal>(
      args,
      tagGitFailed(args),
      (stdout) =>
        Result.mapError(
          S.decodeUnknownResult(schema)(shape(stdout)),
          () => TagExcludedMalformed.make({ path }),
        ),
    )

  const readRepoSlug = (): Effect.Effect<RepoSlug, TagRefusal> =>
    Effect.gen(function*() {
      const args = ['remote', 'get-url', 'origin']
      const captured = yield* git(args)
      if (Result.isFailure(captured)) {
        return yield* Effect.fail(tagGitFailed(args)(captured.failure))
      }
      const slug = remoteSlug(captured.success.trim())
      if (Option.isNone(slug)) {
        return yield* Effect.fail(TagExcludedMalformed.make({ path: repoSlugPath }))
      }
      return slug.value
    })

  return {
    currentBranch: (): Effect.Effect<GitRef, TagRefusal> =>
      tagValue(['rev-parse', '--abbrev-ref', 'HEAD'], currentBranchPath, GitRef, (stdout) => stdout.trim()),
    headSha: (): Effect.Effect<CommitSha, TagRefusal> =>
      tagValue(['rev-parse', 'HEAD'], headShaPath, CommitSha, (stdout) => stdout.trim()),
    changedPaths: (
      base: GitRef,
      head: GitRef,
    ): Effect.Effect<ReadonlyArray<RelativePath>, GateRefusal> =>
      capture<ReadonlyArray<RelativePath>, GateRefusal>(
        ['diff', '--name-only', `${base}...${head}`],
        () => GateIntentMissing.make({ packages: [unnamedPackage] }),
        (stdout) =>
          Result.mapError(
            S.decodeUnknownResult(S.Array(RelativePath))(nonEmptyLines(stdout)),
            () => GateUnknownPackage.make({ path: diffPath, package: unnamedPackage }),
          ),
      ),
    remoteTags: (
      remote: RemoteName,
    ): Effect.Effect<ReadonlyArray<ReleaseTag>, TagRefusal> =>
      tagValue(['ls-remote', '--tags', remote], remoteTagsPath, S.Array(ReleaseTag), listedTags),
    trackedChanges: (): Effect.Effect<Count, PullRequestRefusal> =>
      capture(
        ['status', '--porcelain', '--untracked-files=no'],
        (failure) => PullRequestTreeUnreadable.make({ reason: failure.trim() }),
        (stdout) => Result.succeed(Count.make(nonEmptyLines(stdout).length)),
      ),
    commitRelease: (
      message: PrTitle,
      created: ReadonlyArray<RelativePath>,
    ): Effect.Effect<CommitSha, PullRequestRefusal> =>
      Effect.gen(function*() {
        const step = (args: ReadonlyArray<string>) => run(args, gitFailed(args))
        yield* step(['add', '--update'])
        if (created.length > 0) {
          const listArgs = ['--literal-pathspecs', 'ls-files', '-z', '--others', '--exclude-standard', '--', ...created]
          const untracked = yield* capture(
            listArgs,
            gitFailed(listArgs),
            (stdout) => Result.succeed(stdout.split('\0').filter((path) => path.length > 0)),
          )
          if (untracked.length > 0) {
            yield* step(['--literal-pathspecs', 'add', '--', ...untracked])
          }
        }
        yield* step([...RELEASE_BOT_IDENTITY, 'commit', '-m', message])
        return yield* capture(
          ['rev-parse', 'HEAD'],
          () => PullRequestHeadInvalid.make({ branch: headRef }),
          (stdout) =>
            Result.mapError(
              S.decodeUnknownResult(CommitSha)(stdout.trim()),
              () => PullRequestHeadInvalid.make({ branch: headRef }),
            ),
        )
      }),
    pushBranch: (
      branch: GitRef,
      remote: RemoteName,
    ): Effect.Effect<void, PullRequestRefusal> => {
      const args = ['push', '--force', remote, `HEAD:refs/heads/${branch}`]
      return run(args, gitFailed(args))
    },
    deleteRemoteBranch: (
      branch: GitRef,
      remote: RemoteName,
    ): Effect.Effect<BranchDeleted, PullRequestRefusal> =>
      Effect.gen(function*() {
        const args = ['push', remote, '--delete', branch]
        const captured = yield* git(args)
        if (Result.isFailure(captured)) {
          if (branchAlreadyGone(captured.failure)) {
            return BranchDeleted.make({ branch, deleted: false })
          }
          return yield* Effect.fail(gitFailed(args)(captured.failure))
        }
        return BranchDeleted.make({ branch, deleted: true })
      }),
    pushTags: (
      tags: ReadonlyArray<ReleaseTag>,
      remote: RemoteName,
    ): Effect.Effect<Count, TagRefusal> =>
      Effect.gen(function*() {
        if (tags.length === 0) {
          return Count.make(0)
        }
        const args = ['push', remote, ...tags.map((tag) => `refs/tags/${tag}`)]
        yield* run(args, tagGitFailed(args))
        return Count.make(tags.length)
      }),
    writeTag: (tag: ReleaseTag, message: string): Effect.Effect<ReleaseTag, TagRefusal> =>
      Effect.gen(function*() {
        const args = ['tag', '-a', tag, '-m', message]
        yield* run(args, tagGitFailed(args))
        return tag
      }),
    tagAnnotation: (
      remote: RemoteName,
      tag: ReleaseTag,
    ): Effect.Effect<Option.Option<string>, TagRefusal> =>
      Effect.gen(function*() {
        const fetchArgs = ['fetch', '--force', '--no-tags', remote, `+refs/tags/${tag}:refs/tags/${tag}`]
        yield* run(fetchArgs, tagGitFailed(fetchArgs))
        const kindArgs = ['cat-file', '-t', `refs/tags/${tag}`]
        const kind = yield* git(kindArgs)
        if (Result.isFailure(kind)) {
          return yield* Effect.fail(tagGitFailed(kindArgs)(kind.failure))
        }
        if (kind.success.trim() !== 'tag') {
          return Option.none()
        }
        const bodyArgs = ['cat-file', '-p', `refs/tags/${tag}`]
        const body = yield* git(bodyArgs)
        if (Result.isFailure(body)) {
          return yield* Effect.fail(tagGitFailed(bodyArgs)(body.failure))
        }
        return Option.some(annotationOf(body.success))
      }),
    tagCommit: (
      remote: RemoteName,
      tag: ReleaseTag,
    ): Effect.Effect<Option.Option<CommitSha>, TagRefusal> =>
      Effect.gen(function*() {
        const fetchArgs = ['fetch', '--force', '--no-tags', remote, `+refs/tags/${tag}:refs/tags/${tag}`]
        yield* run(fetchArgs, tagGitFailed(fetchArgs))
        const peeled = yield* git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`])
        if (Result.isFailure(peeled)) {
          return Option.none()
        }
        return S.decodeUnknownOption(CommitSha)(peeled.success.trim())
      }),
    tagTree: (
      remote: RemoteName,
      tag: ReleaseTag,
    ): Effect.Effect<Option.Option<TaggedTree>, TagRefusal> =>
      Effect.gen(function*() {
        const fetchArgs = ['fetch', '--force', '--no-tags', remote, `+refs/tags/${tag}:refs/tags/${tag}`]
        yield* run(fetchArgs, tagGitFailed(fetchArgs))
        const peeled = yield* git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`])
        if (Result.isFailure(peeled)) {
          return Option.none()
        }
        const decoded = S.decodeUnknownOption(CommitSha)(peeled.success.trim())
        if (Option.isNone(decoded)) {
          return Option.none()
        }
        const commit = decoded.value
        const listedArgs = ['ls-tree', '-r', '--name-only', commit]
        const listed = yield* git(listedArgs)
        if (Result.isFailure(listed)) {
          return yield* Effect.fail(tagGitFailed(listedArgs)(listed.failure))
        }
        const paths = listed.success
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.endsWith('package.json') && !line.includes('node_modules/'))
        const manifests: Array<TaggedManifest> = []
        for (const file of paths) {
          const shown = yield* git(['show', `${commit}:${file}`])
          if (Result.isFailure(shown)) continue
          const manifest = S.decodeUnknownOption(S.fromJsonString(PackageManifest))(shown.success)
          const relative = S.decodeUnknownOption(RelativePath)(file)
          if (Option.isNone(manifest) || Option.isNone(relative)) continue
          manifests.push({ path: relative.value, manifest: manifest.value })
        }
        return Option.some({ commit, manifests })
      }),
    repoSlug: (): Effect.Effect<RepoSlug, TagRefusal> =>
      Effect.gen(function*() {
        const declared = declaredSlug()
        if (Option.isSome(declared)) {
          return declared.value
        }
        return yield* readRepoSlug()
      }),
    stagedPaths: (): Effect.Effect<ReadonlyArray<StagedPath>, StagedChecksRefusal> =>
      capture(
        ['diff', '--cached', '--name-only'],
        () => StagedStateUnreadable.make({ reason: 'git staged paths unavailable' }),
        (stdout) =>
          Result.mapError(
            S.decodeUnknownResult(S.Array(StagedPath))(nonEmptyLines(stdout)),
            () => StagedStateUnreadable.make({ reason: 'git staged paths malformed' }),
          ),
      ),
    mergeInProgress: (): Effect.Effect<boolean, StagedChecksRefusal> =>
      Effect.gen(function*() {
        const captured = yield* git(['rev-parse', '--verify', 'MERGE_HEAD'])
        if (Result.isFailure(captured)) {
          if (mergeHeadMissing(captured.failure)) {
            return false
          }
          return yield* Effect.fail(
            StagedStateUnreadable.make({ reason: 'git merge state unavailable' }),
          )
        }
        return true
      }),
  }
}

export const GitLive: Layer.Layer<GitPort> = Layer.effect(
  GitPort,
  Effect.map(ChildProcessSpawner.ChildProcessSpawner, makeGitPort),
).pipe(Layer.provide(NodeServices.layer))
