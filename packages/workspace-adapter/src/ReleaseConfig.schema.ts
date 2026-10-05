import * as S from 'effect/Schema'

export const ConfigDocument = S.Record(S.String, S.Unknown)
export type ConfigDocument = S.Schema.Type<typeof ConfigDocument>
