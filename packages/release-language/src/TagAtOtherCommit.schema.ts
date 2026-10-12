import * as S from 'effect/Schema'
import { CommitSha } from './Tag.schema.js'
import { ReleaseTag } from './Workspace.schema.js'

export const TagAtOtherCommit = S.TaggedStruct('TagAtOtherCommit', {
  tag: ReleaseTag,
  expected: CommitSha,
  found: S.String,
})
export type TagAtOtherCommit = S.Schema.Type<typeof TagAtOtherCommit>
