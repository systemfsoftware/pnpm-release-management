import * as S from 'effect/Schema'

export const PullWrite = S.fromJsonString(S.Struct({
  head: S.optional(S.String),
  title: S.optional(S.String),
  body: S.optional(S.String),
  state: S.optional(S.String),
  labels: S.optional(S.Array(S.String)),
}))
