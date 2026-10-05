import { PackageName, RelativePath } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const DryRunTask = S.Struct({
  taskId: S.NonEmptyString,
  package: S.NonEmptyString,
  hash: S.NonEmptyString,
  directory: S.optional(RelativePath),
})
export type DryRunTask = S.Schema.Type<typeof DryRunTask>

export const DryRunDocument = S.Struct({
  packages: S.Array(PackageName),
  tasks: S.Array(DryRunTask),
  turboVersion: S.optional(S.NonEmptyString),
})
export type DryRunDocument = S.Schema.Type<typeof DryRunDocument>
