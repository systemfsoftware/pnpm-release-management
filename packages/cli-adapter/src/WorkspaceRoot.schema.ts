import * as S from 'effect/Schema'

export const WorkspaceRootNotAbsolute = S.TaggedStruct('WorkspaceRootNotAbsolute', {
  given: S.String,
})
export type WorkspaceRootNotAbsolute = S.Schema.Type<typeof WorkspaceRootNotAbsolute>
