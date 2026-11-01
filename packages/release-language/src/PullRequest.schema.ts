import * as S from 'effect/Schema'
import { Count, FsPath, GitRef } from './Workspace.schema.js'

export const ReleaseLabel = S.NonEmptyString.pipe(S.brand('ReleaseLabel'))
export type ReleaseLabel = S.Schema.Type<typeof ReleaseLabel>
export const PullRequestNumber = S.Int.pipe(
  S.check(S.isGreaterThanOrEqualTo(1)),
  S.brand('PullRequestNumber'),
)
export type PullRequestNumber = S.Schema.Type<typeof PullRequestNumber>

export const BranchDeleted = S.Struct({
  branch: GitRef,
  deleted: S.Boolean,
})
export type BranchDeleted = S.Schema.Type<typeof BranchDeleted>

export const PullRequestFound = S.TaggedStruct('PullRequestFound', {
  number: PullRequestNumber,
})
export type PullRequestFound = S.Schema.Type<typeof PullRequestFound>

export const PullRequestAbsent = S.TaggedStruct('PullRequestAbsent', {
  head: GitRef,
})
export type PullRequestAbsent = S.Schema.Type<typeof PullRequestAbsent>

export const PullRequestLookup = S.Union([
  PullRequestFound,
  PullRequestAbsent,
])
export type PullRequestLookup = S.Schema.Type<typeof PullRequestLookup>

export const PullRequestSummary = S.Struct({
  number: PullRequestNumber,
  title: S.String,
  head: GitRef,
})
export type PullRequestSummary = S.Schema.Type<typeof PullRequestSummary>

export const PullRequestBodyUnreadable = S.TaggedStruct(
  'PullRequestBodyUnreadable',
  {
    path: FsPath,
  },
)
export type PullRequestBodyUnreadable = S.Schema.Type<
  typeof PullRequestBodyUnreadable
>

export const PullRequestHeadInvalid = S.TaggedStruct('PullRequestHeadInvalid', {
  branch: GitRef,
})
export type PullRequestHeadInvalid = S.Schema.Type<
  typeof PullRequestHeadInvalid
>

export const PullRequestUnversioned = S.TaggedStruct('PullRequestUnversioned', {
  pending: Count,
})
export type PullRequestUnversioned = S.Schema.Type<typeof PullRequestUnversioned>

export const PullRequestTreeUnreadable = S.TaggedStruct('PullRequestTreeUnreadable', {
  reason: S.String,
})
export type PullRequestTreeUnreadable = S.Schema.Type<typeof PullRequestTreeUnreadable>

export const PullRequestGitFailed = S.TaggedStruct('PullRequestGitFailed', {
  command: S.String,
  stderr: S.String,
})
export type PullRequestGitFailed = S.Schema.Type<typeof PullRequestGitFailed>

export const PullRequestRefusal = S.Union([
  PullRequestBodyUnreadable,
  PullRequestHeadInvalid,
  PullRequestUnversioned,
  PullRequestTreeUnreadable,
  PullRequestGitFailed,
])
export type PullRequestRefusal = S.Schema.Type<typeof PullRequestRefusal>
