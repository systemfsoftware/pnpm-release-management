import { NodeServices } from '@effect/platform-node'
import {
  CommitSha,
  Count,
  FsPath,
  GateIntentMissing,
  GateUnknownPackage,
  GitPort,
  GitRef,
  OwnerName,
  PackageName,
  PullRequestBodyUnreadable,
  PullRequestHeadInvalid,
  RelativePath,
  ReleaseTag,
  RepoName,
  StagedPath,
  StagedStateUnreadable,
  TagCapturedMalformed,
  TagExcludedMalformed,
} from '@systemfsoftware/release-language'
import type {
  BranchDeleted,
  GateRefusal,
  PrTitle,
  PullRequestRefusal,
  RemoteName,
  RepoSlug,
  StagedChecksRefusal,
  TagRefusal,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

const opPath = {
  currentBranch: FsPath.make('git:current-branch'),
  headSha: FsPath.make('git:head-sha'),
  remoteTags: FsPath.make('git:remote-tags'),
  commit: FsPath.make('git:commit'),
  pushTags: FsPath.make('git:push-tags'),
  writeTag: FsPath.make('git:write-tag'),
  repoSlug: FsPath.make('git:repo-slug'),
}

const headRef = GitRef.make('HEAD')

const changedPathsLabel = RelativePath.make('git:diff')

const unnamedPackage = PackageName.make('unknown')

const scpRemote = /^[^:]+:([^/]+)\/([^/]+?)(\.git)?$/
const httpsRemote = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(\.git)?$/

const splitOnce = (
  text: string,
  separator: string,
): Option.Option<readonly [string, string]> => {
  const parts = text.split(separator)
  const first = parts[0]
  const second = parts[1]
  if (parts.length !== 2 || first === undefined || second === undefined) {
    return Option.none()
  }
  return Option.some([first, second])
}

const slugOf = (owner: string, repo: string): Option.Option<RepoSlug> =>
  Option.all({
    owner: S.decodeUnknownOption(OwnerName)(owner),
    repo: S.decodeUnknownOption(RepoName)(repo),
  })

const slugFromEnvironment = (declared: string | undefined): Option.Option<RepoSlug> =>
  Option.flatMap(
    Option.fromNullishOr(declared),
    (value) => Option.flatMap(splitOnce(value, '/'), ([owner, repo]) => slugOf(owner, repo)),
  )

const ownerAndRepo = (
  remoteUrlPattern: RegExp,
  url: string,
): Option.Option<readonly [string, string]> => {
  const match = remoteUrlPattern.exec(url)
  const owner = match?.[1]
  const repo = match?.[2]
  if (owner === undefined || repo === undefined) {
    return Option.none()
  }
  return Option.some([owner, repo])
}

const slugFromRemoteUrl = (url: string): Option.Option<RepoSlug> =>
  Option.flatMap(
    Option.orElse(
      ownerAndRepo(scpRemote, url),
      () => ownerAndRepo(httpsRemote, url),
    ),
    ([owner, repo]) => slugOf(owner, repo),
  )

const lines = (text: string): ReadonlyArray<string> =>
  text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)

const listedTags = (text: string): ReadonlyArray<string> =>
  text.split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/.*refs\/tags\//, '').replace(/\^\{\}$/, ''))
    .filter((tag) => tag.length > 0)

const branchAlreadyAbsent = (stderr: string): boolean =>
  stderr.includes('remote ref does not exist') || stderr.includes('does not exist')

const noMergeInProgress = (stderr: string): boolean =>
  stderr.includes('Needed a single revision') || stderr.includes('unknown revision')

const noOutput = (): Result.Result<void, never> => Result.succeed(undefined)

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

  const readPort = <A, E>(
    args: ReadonlyArray<string>,
    onFailure: (stderr: string) => Result.Result<A, E>,
    onSuccess: (stdout: string) => Result.Result<A, E>,
  ): Effect.Effect<A, E> =>
    Effect.flatMap(git(args), (outcome) => Effect.fromResult(Result.match(outcome, { onFailure, onSuccess })))

  const decode = <A, E>(
    schema: S.ConstraintDecoder<A>,
    input: unknown,
    refusal: E,
  ): Result.Result<A, E> => Result.mapError(S.decodeUnknownResult(schema)(input), () => refusal)

  const currentBranch = (): Effect.Effect<GitRef, TagRefusal, never> =>
    readPort<GitRef, TagRefusal>(
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      () => Result.fail(TagCapturedMalformed.make({ path: opPath.currentBranch })),
      (stdout) =>
        decode(
          GitRef,
          stdout.trim(),
          TagExcludedMalformed.make({ path: opPath.currentBranch }),
        ),
    )

  const headSha = (): Effect.Effect<CommitSha, TagRefusal, never> =>
    readPort<CommitSha, TagRefusal>(
      ['rev-parse', 'HEAD'],
      () => Result.fail(TagCapturedMalformed.make({ path: opPath.headSha })),
      (stdout) =>
        decode(
          CommitSha,
          stdout.trim(),
          TagExcludedMalformed.make({ path: opPath.headSha }),
        ),
    )

  const changedPaths = (
    base: GitRef,
    head: GitRef,
  ): Effect.Effect<ReadonlyArray<RelativePath>, GateRefusal, never> =>
    readPort<ReadonlyArray<RelativePath>, GateRefusal>(
      ['diff', '--name-only', `${base}...${head}`],
      () => Result.fail(GateIntentMissing.make({ packages: [unnamedPackage] })),
      (stdout) =>
        decode(
          S.Array(RelativePath),
          lines(stdout),
          GateUnknownPackage.make({
            path: changedPathsLabel,
            package: unnamedPackage,
          }),
        ),
    )

  const remoteTags = (
    remote: RemoteName,
  ): Effect.Effect<ReadonlyArray<ReleaseTag>, TagRefusal, never> =>
    readPort<ReadonlyArray<ReleaseTag>, TagRefusal>(
      ['ls-remote', '--tags', remote],
      () => Result.fail(TagCapturedMalformed.make({ path: opPath.remoteTags })),
      (stdout) =>
        decode(
          S.Array(ReleaseTag),
          listedTags(stdout),
          TagExcludedMalformed.make({ path: opPath.remoteTags }),
        ),
    )

  const commitAll = (
    message: PrTitle,
  ): Effect.Effect<CommitSha, PullRequestRefusal, never> =>
    readPort(
      ['add', '-A'],
      () => Result.fail(PullRequestBodyUnreadable.make({ path: opPath.commit })),
      noOutput,
    ).pipe(
      Effect.andThen(readPort(
        ['commit', '-m', message],
        () => Result.fail(PullRequestBodyUnreadable.make({ path: opPath.commit })),
        noOutput,
      )),
      Effect.andThen(readPort(
        ['rev-parse', 'HEAD'],
        () => Result.fail(PullRequestHeadInvalid.make({ branch: headRef })),
        (stdout) =>
          decode(
            CommitSha,
            stdout.trim(),
            PullRequestHeadInvalid.make({ branch: headRef }),
          ),
      )),
    )

  const pushBranch = (
    branch: GitRef,
    remote: RemoteName,
  ): Effect.Effect<void, PullRequestRefusal, never> =>
    readPort(
      ['push', '--force', remote, `HEAD:refs/heads/${branch}`],
      () => Result.fail(PullRequestHeadInvalid.make({ branch })),
      noOutput,
    )

  const deleteRemoteBranch = (
    branch: GitRef,
    remote: RemoteName,
  ): Effect.Effect<BranchDeleted, PullRequestRefusal, never> =>
    readPort(
      ['push', remote, '--delete', branch],
      (stderr): Result.Result<BranchDeleted, PullRequestRefusal> => {
        if (branchAlreadyAbsent(stderr)) {
          return Result.succeed({ branch, deleted: false })
        }
        return Result.fail(PullRequestHeadInvalid.make({ branch }))
      },
      () => Result.succeed({ branch, deleted: true }),
    )

  const pushTags = (
    tags: ReadonlyArray<ReleaseTag>,
    remote: RemoteName,
  ): Effect.Effect<Count, TagRefusal, never> => {
    if (tags.length === 0) {
      return Effect.succeed(Count.make(0))
    }
    return readPort(
      ['push', remote, ...tags.map((tag) => `refs/tags/${tag}`)],
      () => Result.fail(TagCapturedMalformed.make({ path: opPath.pushTags })),
      () => Result.succeed(Count.make(tags.length)),
    )
  }

  const writeTag = (
    tag: ReleaseTag,
  ): Effect.Effect<ReleaseTag, TagRefusal, never> =>
    readPort(
      ['tag', tag],
      () => Result.fail(TagCapturedMalformed.make({ path: opPath.writeTag })),
      () => Result.succeed(tag),
    )

  const originSlug = (): Effect.Effect<RepoSlug, TagRefusal, never> =>
    readPort(
      ['remote', 'get-url', 'origin'],
      () => Result.fail(TagCapturedMalformed.make({ path: opPath.repoSlug })),
      (stdout): Result.Result<RepoSlug, TagRefusal> =>
        Option.match(slugFromRemoteUrl(stdout.trim()), {
          onNone: () => Result.fail(TagExcludedMalformed.make({ path: opPath.repoSlug })),
          onSome: (slug) => Result.succeed(slug),
        }),
    )

  const repoSlug = (): Effect.Effect<RepoSlug, TagRefusal, never> =>
    Effect.flatMap(
      Effect.sync(() => slugFromEnvironment(process.env['GITHUB_REPOSITORY'])),
      (declared) =>
        Option.match(declared, {
          onNone: originSlug,
          onSome: (slug) => Effect.succeed(slug),
        }),
    )

  const stagedPaths = (): Effect.Effect<
    ReadonlyArray<StagedPath>,
    StagedChecksRefusal,
    never
  > =>
    readPort(
      ['diff', '--cached', '--name-only'],
      () =>
        Result.fail(StagedStateUnreadable.make({
          reason: 'git staged paths unavailable',
        })),
      (stdout) =>
        decode(
          S.Array(StagedPath),
          lines(stdout),
          StagedStateUnreadable.make({
            reason: 'git staged paths malformed',
          }),
        ),
    )

  const mergeInProgress = (): Effect.Effect<
    boolean,
    StagedChecksRefusal,
    never
  > =>
    readPort(
      ['rev-parse', '--verify', 'MERGE_HEAD'],
      (stderr): Result.Result<boolean, StagedChecksRefusal> => {
        if (noMergeInProgress(stderr)) {
          return Result.succeed(false)
        }
        return Result.fail(StagedStateUnreadable.make({
          reason: 'git merge state unavailable',
        }))
      },
      () => Result.succeed(true),
    )

  return {
    currentBranch,
    headSha,
    changedPaths,
    remoteTags,
    commitAll,
    pushBranch,
    deleteRemoteBranch,
    pushTags,
    writeTag,
    repoSlug,
    stagedPaths,
    mergeInProgress,
  }
}

export const GitLive: Layer.Layer<GitPort> = Layer.effect(
  GitPort,
  Effect.map(ChildProcessSpawner.ChildProcessSpawner, makeGitPort),
).pipe(Layer.provide(NodeServices.layer))
