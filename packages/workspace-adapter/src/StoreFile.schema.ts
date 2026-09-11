import * as S from 'effect/Schema'

const Missing = S.TaggedStruct('Missing', { reason: S.String })
const AlreadyExists = S.TaggedStruct('AlreadyExists', { reason: S.String })
const Unavailable = S.TaggedStruct('Unavailable', { reason: S.String })

export const StoreFault = S.Union([Missing, AlreadyExists, Unavailable])
export type StoreFault = S.Schema.Type<typeof StoreFault>
