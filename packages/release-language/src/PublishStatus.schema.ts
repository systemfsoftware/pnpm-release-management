import * as S from 'effect/Schema'

export const StatusClass = S.Literals([
  'unpublished',
  'no-oidc',
  'stuck',
  'ok',
  'error',
])
export type StatusClass = S.Schema.Type<typeof StatusClass>
