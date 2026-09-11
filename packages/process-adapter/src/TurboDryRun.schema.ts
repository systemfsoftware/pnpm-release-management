import * as S from 'effect/Schema'

export const DryRunDocument = S.Struct({
  packages: S.optional(S.Unknown),
  tasks: S.optional(S.Unknown),
  turboVersion: S.optional(S.Unknown),
})
export type DryRunDocument = S.Schema.Type<typeof DryRunDocument>
