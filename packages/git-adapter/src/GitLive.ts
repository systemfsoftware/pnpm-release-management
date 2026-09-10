import {
  CommitSha,
  Count,
  FsPath,
  GitPort,
  GitRef,
  OwnerName,
  PackageName,
  RelativePath,
  ReleaseTag,
  RepoName,
  StagedPath,
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
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const currentBranch = (): Effect.Effect<GitRef, TagRefusal, never> =>
  Effect.gen(function*() {
    const opPathResult = S.decodeUnknownResult(FsPath)('git:current-branch')
    if (Result.isFailure(opPathResult)) {
      return yield* Effect.die(
        new Error('impossible: git:current-branch must decode as FsPath'),
      )
    }
    const opPath = opPathResult.success
    const output = yield* Effect.tryPromise({
      try: () =>
        new Deno.Command('git', {
          args: ['rev-parse', '--abbrev-ref', 'HEAD'],
          stdout: 'piped',
          stderr: 'piped',
        }).output(),
      catch: (): TagRefusal => ({ _tag: 'TagCapturedMalformed', path: opPath }),
    })
    if (!output.success) {
      return yield* Effect.fail<TagRefusal>({
        _tag: 'TagCapturedMalformed',
        path: opPath,
      })
    }
    const raw = new TextDecoder().decode(output.stdout).trim()
    const branchResult = S.decodeUnknownResult(GitRef)(raw)
    if (Result.isFailure(branchResult)) {
      return yield* Effect.fail<TagRefusal>({
        _tag: 'TagExcludedMalformed',
        path: opPath,
      })
    }
    return branchResult.success
  })

const headSha = (): Effect.Effect<CommitSha, TagRefusal, never> =>
  Effect.gen(function*() {
    const opPathResult = S.decodeUnknownResult(FsPath)('git:head-sha')
    if (Result.isFailure(opPathResult)) {
      return yield* Effect.die(
        new Error('impossible: git:head-sha must decode as FsPath'),
      )
    }
    const opPath = opPathResult.success
    const output = yield* Effect.tryPromise({
      try: () =>
        new Deno.Command('git', {
          args: ['rev-parse', 'HEAD'],
          stdout: 'piped',
          stderr: 'piped',
        }).output(),
      catch: (): TagRefusal => ({ _tag: 'TagCapturedMalformed', path: opPath }),
    })
    if (!output.success) {
      return yield* Effect.fail<TagRefusal>({
        _tag: 'TagCapturedMalformed',
        path: opPath,
      })
    }
    const raw = new TextDecoder().decode(output.stdout).trim()
    const shaResult = S.decodeUnknownResult(CommitSha)(raw)
    if (Result.isFailure(shaResult)) {
      return yield* Effect.fail<TagRefusal>({
        _tag: 'TagExcludedMalformed',
        path: opPath,
      })
    }
    return shaResult.success
  })

const changedPaths = (
  base: GitRef,
  head: GitRef,
): Effect.Effect<ReadonlyArray<RelativePath>, GateRefusal, never> =>
  Effect.gen(function*() {
    const unknownResult = S.decodeUnknownResult(PackageName)('unknown')
    if (Result.isFailure(unknownResult)) {
      return yield* Effect.die(
        new Error('impossible: unknown must decode as PackageName'),
      )
    }
    const unknownPkg = unknownResult.success
    const diffResult = S.decodeUnknownResult(RelativePath)('git:diff')
    if (Result.isFailure(diffResult)) {
      return yield* Effect.die(
        new Error('impossible: git:diff must decode as RelativePath'),
      )
    }
    const diffPath = diffResult.success
    const output = yield* Effect.tryPromise({
      try: () =>
        new Deno.Command('git', {
          args: ['diff', '--name-only', `${base}...${head}`],
          stdout: 'piped',
          stderr: 'piped',
        }).output(),
      catch: (): GateRefusal => ({
        _tag: 'GateIntentMissing',
        packages: [unknownPkg],
      }),
    })
    if (!output.success) {
      return yield* Effect.fail<GateRefusal>({
        _tag: 'GateIntentMissing',
        packages: [unknownPkg],
      })
    }
    const text = new TextDecoder().decode(output.stdout)
    const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
    const pathsResult = S.decodeUnknownResult(S.Array(RelativePath))(lines)
    if (Result.isFailure(pathsResult)) {
      return yield* Effect.fail<GateRefusal>({
        _tag: 'GateUnknownPackage',
        path: diffPath,
        package: unknownPkg,
      })
    }
    return pathsResult.success
  })

const remoteTags = (
  remote: RemoteName,
): Effect.Effect<ReadonlyArray<ReleaseTag>, TagRefusal, never> =>
  Effect.gen(function*() {
    const opPathResult = S.decodeUnknownResult(FsPath)('git:remote-tags')
    if (Result.isFailure(opPathResult)) {
      return yield* Effect.die(
        new Error('impossible: git:remote-tags must decode as FsPath'),
      )
    }
    const opPath = opPathResult.success
    const output = yield* Effect.tryPromise({
      try: () =>
        new Deno.Command('git', {
          args: ['ls-remote', '--tags', remote],
          stdout: 'piped',
          stderr: 'piped',
        }).output(),
      catch: (): TagRefusal => ({ _tag: 'TagCapturedMalformed', path: opPath }),
    })
    if (!output.success) {
      return yield* Effect.fail<TagRefusal>({
        _tag: 'TagCapturedMalformed',
        path: opPath,
      })
    }
    const text = new TextDecoder().decode(output.stdout)
    const tags = text.split('\n').filter((line) => line.length > 0).map(
      (line) => line.replace(/.*refs\/tags\//, '').replace(/\^\{\}$/, ''),
    ).filter((tag) => tag.length > 0)
    const tagsResult = S.decodeUnknownResult(S.Array(ReleaseTag))(tags)
    if (Result.isFailure(tagsResult)) {
      return yield* Effect.fail<TagRefusal>({
        _tag: 'TagExcludedMalformed',
        path: opPath,
      })
    }
    return tagsResult.success
  })

const commitAll = (
  message: PrTitle,
): Effect.Effect<CommitSha, PullRequestRefusal, never> =>
  Effect.gen(function*() {
    const commitResult = S.decodeUnknownResult(FsPath)('git:commit')
    if (Result.isFailure(commitResult)) {
      return yield* Effect.die(
        new Error('impossible: git:commit must decode as FsPath'),
      )
    }
    const commitPath = commitResult.success
    const headResult = S.decodeUnknownResult(GitRef)('HEAD')
    if (Result.isFailure(headResult)) {
      return yield* Effect.die(
        new Error('impossible: HEAD must decode as GitRef'),
      )
    }
    const headRef = headResult.success
    const added = yield* Effect.tryPromise({
      try: () =>
        new Deno.Command('git', {
          args: ['add', '-A'],
          stdout: 'piped',
          stderr: 'piped',
        }).output(),
      catch: (): PullRequestRefusal => ({
        _tag: 'PullRequestBodyUnreadable',
        path: commitPath,
      }),
    })
    if (!added.success) {
      return yield* Effect.fail<PullRequestRefusal>({
        _tag: 'PullRequestBodyUnreadable',
        path: commitPath,
      })
    }
    const committed = yield* Effect.tryPromise({
      try: () =>
        new Deno.Command('git', {
          args: ['commit', '-m', message],
          stdout: 'piped',
          stderr: 'piped',
        }).output(),
      catch: (): PullRequestRefusal => ({
        _tag: 'PullRequestBodyUnreadable',
        path: commitPath,
      }),
    })
    if (!committed.success) {
      return yield* Effect.fail<PullRequestRefusal>({
        _tag: 'PullRequestBodyUnreadable',
        path: commitPath,
      })
    }
    const revoked = yield* Effect.tryPromise({
      try: () =>
        new Deno.Command('git', {
          args: ['rev-parse', 'HEAD'],
          stdout: 'piped',
          stderr: 'piped',
        }).output(),
      catch: (): PullRequestRefusal => ({
        _tag: 'PullRequestHeadInvalid',
        branch: headRef,
      }),
    })
    if (!revoked.success) {
      return yield* Effect.fail<PullRequestRefusal>({
        _tag: 'PullRequestHeadInvalid',
        branch: headRef,
      })
    }
    const raw = new TextDecoder().decode(revoked.stdout).trim()
    const shaResult = S.decodeUnknownResult(CommitSha)(raw)
    if (Result.isFailure(shaResult)) {
      return yield* Effect.fail<PullRequestRefusal>({
        _tag: 'PullRequestHeadInvalid',
        branch: headRef,
      })
    }
    return shaResult.success
  })

const pushBranch = (
  branch: GitRef,
  remote: RemoteName,
): Effect.Effect<void, PullRequestRefusal, never> =>
  Effect.gen(function*() {
    const output = yield* Effect.tryPromise({
      try: () =>
        new Deno.Command('git', {
          args: ['push', '--force', remote, `HEAD:refs/heads/${branch}`],
          stdout: 'piped',
          stderr: 'piped',
        }).output(),
      catch: (): PullRequestRefusal => ({
        _tag: 'PullRequestHeadInvalid',
        branch,
      }),
    })
    if (!output.success) {
      return yield* Effect.fail<PullRequestRefusal>({
        _tag: 'PullRequestHeadInvalid',
        branch,
      })
    }
  })

const deleteRemoteBranch = (
  branch: GitRef,
  remote: RemoteName,
): Effect.Effect<BranchDeleted, PullRequestRefusal, never> =>
  Effect.gen(function*() {
    const output = yield* Effect.tryPromise({
      try: () =>
        new Deno.Command('git', {
          args: ['push', remote, '--delete', branch],
          stdout: 'piped',
          stderr: 'piped',
        }).output(),
      catch: (): PullRequestRefusal => ({
        _tag: 'PullRequestHeadInvalid',
        branch,
      }),
    })
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr)
      if (
        stderr.includes('remote ref does not exist') ||
        stderr.includes('does not exist')
      ) {
        return { branch, deleted: false }
      }
      return yield* Effect.fail<PullRequestRefusal>({
        _tag: 'PullRequestHeadInvalid',
        branch,
      })
    }
    return { branch, deleted: true }
  })

const pushTags = (
  tags: ReadonlyArray<ReleaseTag>,
  remote: RemoteName,
): Effect.Effect<Count, TagRefusal, never> =>
  Effect.gen(function*() {
    const opPathResult = S.decodeUnknownResult(FsPath)('git:push-tags')
    if (Result.isFailure(opPathResult)) {
      return yield* Effect.die(
        new Error('impossible: git:push-tags must decode as FsPath'),
      )
    }
    const opPath = opPathResult.success
    if (tags.length === 0) {
      const zeroResult = S.decodeUnknownResult(Count)(0)
      if (Result.isFailure(zeroResult)) {
        return yield* Effect.die(
          new Error('impossible: 0 must decode as Count'),
        )
      }
      return zeroResult.success
    }
    const refspecs = tags.map((tag) => `refs/tags/${tag}`)
    const output = yield* Effect.tryPromise({
      try: () =>
        new Deno.Command('git', {
          args: ['push', remote, ...refspecs],
          stdout: 'piped',
          stderr: 'piped',
        }).output(),
      catch: (): TagRefusal => ({ _tag: 'TagCapturedMalformed', path: opPath }),
    })
    if (!output.success) {
      return yield* Effect.fail<TagRefusal>({
        _tag: 'TagCapturedMalformed',
        path: opPath,
      })
    }
    const countResult = S.decodeUnknownResult(Count)(tags.length)
    if (Result.isFailure(countResult)) {
      return yield* Effect.fail<TagRefusal>({
        _tag: 'TagCapturedMalformed',
        path: opPath,
      })
    }
    return countResult.success
  })

const writeTag = (
  tag: ReleaseTag,
): Effect.Effect<ReleaseTag, TagRefusal, never> =>
  Effect.gen(function*() {
    const opPathResult = S.decodeUnknownResult(FsPath)('git:write-tag')
    if (Result.isFailure(opPathResult)) {
      return yield* Effect.die(
        new Error('impossible: git:write-tag must decode as FsPath'),
      )
    }
    const opPath = opPathResult.success
    const output = yield* Effect.tryPromise({
      try: () =>
        new Deno.Command('git', {
          args: ['tag', tag],
          stdout: 'piped',
          stderr: 'piped',
        }).output(),
      catch: (): TagRefusal => ({ _tag: 'TagCapturedMalformed', path: opPath }),
    })
    if (!output.success) {
      return yield* Effect.fail<TagRefusal>({
        _tag: 'TagCapturedMalformed',
        path: opPath,
      })
    }
    return tag
  })

const repoSlug = (): Effect.Effect<RepoSlug, TagRefusal, never> =>
  Effect.gen(function*() {
    const opPathResult = S.decodeUnknownResult(FsPath)('git:repo-slug')
    if (Result.isFailure(opPathResult)) {
      return yield* Effect.die(
        new Error('impossible: git:repo-slug must decode as FsPath'),
      )
    }
    const opPath = opPathResult.success
    const envSlug = Deno.env.get('GITHUB_REPOSITORY')
    if (envSlug !== undefined) {
      const slash = envSlug.indexOf('/')
      if (slash !== -1) {
        const envOwner = S.decodeUnknownResult(OwnerName)(envSlug.slice(0, slash))
        const envRepo = S.decodeUnknownResult(RepoName)(envSlug.slice(slash + 1))
        if (Result.isSuccess(envOwner) && Result.isSuccess(envRepo)) {
          return { owner: envOwner.success, repo: envRepo.success }
        }
      }
    }
    const output = yield* Effect.tryPromise({
      try: () =>
        new Deno.Command('git', {
          args: ['remote', 'get-url', 'origin'],
          stdout: 'piped',
          stderr: 'piped',
        }).output(),
      catch: (): TagRefusal => ({ _tag: 'TagCapturedMalformed', path: opPath }),
    })
    if (!output.success) {
      return yield* Effect.fail<TagRefusal>({
        _tag: 'TagCapturedMalformed',
        path: opPath,
      })
    }
    const url = new TextDecoder().decode(output.stdout).trim()
    const scp = /^[^:]+:([^/]+)\/([^/]+?)(\.git)?$/.exec(url)
    const https = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(\.git)?$/.exec(url)
    const owner = scp?.[1] ?? https?.[1]
    const repo = scp?.[2] ?? https?.[2]
    if (owner === undefined || repo === undefined) {
      return yield* Effect.fail<TagRefusal>({
        _tag: 'TagExcludedMalformed',
        path: opPath,
      })
    }
    const ownerResult = S.decodeUnknownResult(OwnerName)(owner)
    if (Result.isFailure(ownerResult)) {
      return yield* Effect.fail<TagRefusal>({
        _tag: 'TagExcludedMalformed',
        path: opPath,
      })
    }
    const repoResult = S.decodeUnknownResult(RepoName)(repo)
    if (Result.isFailure(repoResult)) {
      return yield* Effect.fail<TagRefusal>({
        _tag: 'TagExcludedMalformed',
        path: opPath,
      })
    }
    return { owner: ownerResult.success, repo: repoResult.success }
  })

const stagedPaths = (): Effect.Effect<
  ReadonlyArray<StagedPath>,
  StagedChecksRefusal,
  never
> =>
  Effect.gen(function*() {
    const output = yield* Effect.tryPromise({
      try: () =>
        new Deno.Command('git', {
          args: ['diff', '--cached', '--name-only'],
          stdout: 'piped',
          stderr: 'piped',
        }).output(),
      catch: (): StagedChecksRefusal => ({
        _tag: 'StagedStateUnreadable',
        reason: 'git staged paths unavailable',
      }),
    })
    if (!output.success) {
      return yield* Effect.fail<StagedChecksRefusal>({
        _tag: 'StagedStateUnreadable',
        reason: 'git staged paths unavailable',
      })
    }
    const text = new TextDecoder().decode(output.stdout)
    const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
    const pathsResult = S.decodeUnknownResult(S.Array(StagedPath))(lines)
    if (Result.isFailure(pathsResult)) {
      return yield* Effect.fail<StagedChecksRefusal>({
        _tag: 'StagedStateUnreadable',
        reason: 'git staged paths malformed',
      })
    }
    return pathsResult.success
  })

const mergeInProgress = (): Effect.Effect<
  boolean,
  StagedChecksRefusal,
  never
> =>
  Effect.gen(function*() {
    const output = yield* Effect.tryPromise({
      try: () =>
        new Deno.Command('git', {
          args: ['rev-parse', '--verify', 'MERGE_HEAD'],
          stdout: 'piped',
          stderr: 'piped',
        }).output(),
      catch: (): StagedChecksRefusal => ({
        _tag: 'StagedStateUnreadable',
        reason: 'git merge state unavailable',
      }),
    })
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr)
      if (
        stderr.includes('Needed a single revision') ||
        stderr.includes('unknown revision')
      ) {
        return false
      }
      return yield* Effect.fail<StagedChecksRefusal>({
        _tag: 'StagedStateUnreadable',
        reason: 'git merge state unavailable',
      })
    }
    return true
  })

export const GitLive: Layer.Layer<GitPort> = Layer.succeed(GitPort, {
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
})
