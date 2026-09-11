import * as S from 'effect/Schema'

export const WorkspaceRootRefused = S.TaggedStruct('WorkspaceRootRefused', {
  given: S.String,
  reason: S.String,
})
export type WorkspaceRootRefused = S.Schema.Type<typeof WorkspaceRootRefused>

export const ManifestPathRefused = S.TaggedStruct('ManifestPathRefused', {
  given: S.String,
})
export type ManifestPathRefused = S.Schema.Type<typeof ManifestPathRefused>

export const SyncActionMissing = S.TaggedStruct('SyncActionMissing', {})
export type SyncActionMissing = S.Schema.Type<typeof SyncActionMissing>
