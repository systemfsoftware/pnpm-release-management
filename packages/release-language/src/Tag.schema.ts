import * as S from 'effect/Schema'
import { FsPath, OwnerName, RepoName } from './Workspace.schema.js'

export const RepoSlug = S.Struct({
  owner: OwnerName,
  repo: RepoName,
})
export type RepoSlug = S.Schema.Type<typeof RepoSlug>

export const CommitSha = S.String.pipe(
  S.check(S.isPattern(/^[0-9a-f]{4,64}$/)),
  S.brand('CommitSha'),
)
export type CommitSha = S.Schema.Type<typeof CommitSha>

export const RemoteName = S.NonEmptyString.pipe(S.brand('RemoteName'))
export type RemoteName = S.Schema.Type<typeof RemoteName>

export const TagCapturedMalformed = S.TaggedStruct('TagCapturedMalformed', {
  path: FsPath,
})
export type TagCapturedMalformed = S.Schema.Type<typeof TagCapturedMalformed>

export const TagExcludedMalformed = S.TaggedStruct('TagExcludedMalformed', {
  path: FsPath,
})
export type TagExcludedMalformed = S.Schema.Type<typeof TagExcludedMalformed>

export const TagRefusal = S.Union([TagCapturedMalformed, TagExcludedMalformed])
export type TagRefusal = S.Schema.Type<typeof TagRefusal>
