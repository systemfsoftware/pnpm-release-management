import * as S from 'effect/Schema'

export const BaseRefMissing = S.TaggedStruct('BaseRefMissing', {})
export type BaseRefMissing = S.Schema.Type<typeof BaseRefMissing>

export const BaseRefInvalid = S.TaggedStruct('BaseRefInvalid', { given: S.String })
export type BaseRefInvalid = S.Schema.Type<typeof BaseRefInvalid>
