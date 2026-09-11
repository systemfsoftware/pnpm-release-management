import * as S from 'effect/Schema'

export const Missing = S.TaggedStruct('Missing', { reason: S.String })
export type Missing = S.Schema.Type<typeof Missing>

export const AlreadyExists = S.TaggedStruct('AlreadyExists', { reason: S.String })
export type AlreadyExists = S.Schema.Type<typeof AlreadyExists>

export const Unavailable = S.TaggedStruct('Unavailable', { reason: S.String })
export type Unavailable = S.Schema.Type<typeof Unavailable>

export const StoreFault = S.Union([Missing, AlreadyExists, Unavailable])
export type StoreFault = S.Schema.Type<typeof StoreFault>
