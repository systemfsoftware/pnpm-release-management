import * as S from 'effect/Schema'

export const ManifestPathRefused = S.TaggedStruct('ManifestPathRefused', {
  given: S.String,
})
export type ManifestPathRefused = S.Schema.Type<typeof ManifestPathRefused>

export const SyncActionMissing = S.TaggedStruct('SyncActionMissing', {})
export type SyncActionMissing = S.Schema.Type<typeof SyncActionMissing>
