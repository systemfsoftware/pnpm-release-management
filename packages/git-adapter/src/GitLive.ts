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
  GateRefusal,
  PrTitle,
  PullRequestRefusal,
  RemoteName,
  RepoSlug,
  StagedChecksRefusal,
  TagRefusal,
} from '@systemfsoftware/release-language'
import { Effect, Layer, Option, Result } from 'effect'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

const currentBranchPath = FsPath.make('git:current-branch')
const headShaPath = FsPath.make('git:head-sha')
const remoteTagsPath = FsPath.make('git:remote-tags')
const commitPath = FsPath.make('git:commit')
const pushTagsPath = FsPath.make('git:push-tags')
const writeTagPath = FsPath.make('git:write-tag')
const repoSlugPath = FsPath.make('git:repo-slug')
const tagAnnotationPath = FsPath.make('git:tag-annotation')
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
      () => TagCapturedMalformed.make({ path }),
      (stdout) =>
        Result.mapError(
          S.decodeUnknownResult(schema)(shape(stdout)),
          () => TagExcludedMalformed.make({ path }),
        ),
    )

  const readRepoSlug = (): Effect.Effect<RepoSlug, TagRefusal> =>
    Effect.gen(function*() {
      const captured = yield* git(['remote', 'get-url', 'origin'])
      if (Result.isFailure(captured)) {
        return yield* Effect.fail(TagCapturedMalformed.make({ path: repoSlugPath }))
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
    commitAll: (message: PrTitle): Effect.Effect<CommitSha, PullRequestRefusal> =>
      Effect.gen(function*() {
        yield* run(['add', '-A'], () => PullRequestBodyUnreadable.make({ path: commitPath }))
        yield* run(['commit', '-m', message], () => PullRequestBodyUnreadable.make({ path: commitPath }))
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
    ): Effect.Effect<void, PullRequestRefusal> =>
      run(['push', '--force', remote, `HEAD:refs/heads/${branch}`], () => PullRequestHeadInvalid.make({ branch })),
    deleteRemoteBranch: (
      branch: GitRef,
      remote: RemoteName,
    ): Effect.Effect<BranchDeleted, PullRequestRefusal> =>
      Effect.gen(function*() {
        const captured = yield* git(['push', remote, '--delete', branch])
        if (Result.isFailure(captured)) {
          if (branchAlreadyGone(captured.failure)) {
            return BranchDeleted.make({ branch, deleted: false })
          }
          return yield* Effect.fail(PullRequestHeadInvalid.make({ branch }))
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
        yield* run(['push', remote, ...tags.map((tag) => `refs/tags/${tag}`)], () =>
          TagCapturedMalformed.make({ path: pushTagsPath }))
        return Count.make(tags.length)
      }),
    writeTag: (tag: ReleaseTag, message: string): Effect.Effect<ReleaseTag, TagRefusal> =>
      Effect.gen(function*() {
        yield* run(['tag', '-a', tag, '-m', message], () => TagCapturedMalformed.make({ path: writeTagPath }))
        return tag
      }),
    tagAnnotation: (
      remote: RemoteName,
      tag: ReleaseTag,
    ): Effect.Effect<Option.Option<string>, TagRefusal> =>
      Effect.gen(function*() {
        yield* run(
          ['fetch', '--force', '--no-tags', remote, `+refs/tags/${tag}:refs/tags/${tag}`],
          () => TagCapturedMalformed.make({ path: tagAnnotationPath }),
        )
        const kind = yield* git(['cat-file', '-t', `refs/tags/${tag}`])
        if (Result.isFailure(kind)) {
          return yield* Effect.fail(TagCapturedMalformed.make({ path: tagAnnotationPath }))
        }
        if (kind.success.trim() !== 'tag') {
          return Option.none()
        }
        const body = yield* git(['cat-file', '-p', `refs/tags/${tag}`])
        if (Result.isFailure(body)) {
          return yield* Effect.fail(TagCapturedMalformed.make({ path: tagAnnotationPath }))
        }
        return Option.some(annotationOf(body.success))
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
