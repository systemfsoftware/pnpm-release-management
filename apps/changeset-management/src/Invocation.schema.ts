import * as S from 'effect/Schema'

export const RootNotAbsolute = S.TaggedStruct('RootNotAbsolute', { given: S.String })
export type RootNotAbsolute = S.Schema.Type<typeof RootNotAbsolute>

export const BaseRefMissing = S.TaggedStruct('BaseRefMissing', {})
export type BaseRefMissing = S.Schema.Type<typeof BaseRefMissing>

export const BaseRefInvalid = S.TaggedStruct('BaseRefInvalid', { given: S.String })
export type BaseRefInvalid = S.Schema.Type<typeof BaseRefInvalid>
