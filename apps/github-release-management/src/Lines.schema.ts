import * as S from 'effect/Schema'

export const Out = S.TaggedStruct('Out', { text: S.String })
export type Out = S.Schema.Type<typeof Out>

export const Err = S.TaggedStruct('Err', { text: S.String })
export type Err = S.Schema.Type<typeof Err>

export const Contents = S.TaggedStruct('Contents', { path: S.String })
export type Contents = S.Schema.Type<typeof Contents>

export const Append = S.TaggedStruct('Append', { path: S.String, text: S.String })
export type Append = S.Schema.Type<typeof Append>

export const Line = S.Union([Out, Err, Contents, Append])
export type Line = S.Schema.Type<typeof Line>
