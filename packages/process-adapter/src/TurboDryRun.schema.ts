import { PackageName, RelativePath } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const DryRunTask = S.Struct({
  taskId: S.NonEmptyString,
  package: S.NonEmptyString,
  hash: S.NonEmptyString,
  directory: S.optional(RelativePath),
  dependencies: S.optional(S.Array(S.String)),
  inputs: S.optional(S.Record(S.String, S.String)),
  hashOfExternalDependencies: S.optional(S.String),
})
export type DryRunTask = S.Schema.Type<typeof DryRunTask>

export const DryRunDocument = S.Struct({
  packages: S.Array(PackageName),
  tasks: S.Array(DryRunTask),
  turboVersion: S.optional(S.NonEmptyString),
  globalCacheInputs: S.optional(S.Unknown),
})
export type DryRunDocument = S.Schema.Type<typeof DryRunDocument>

export const GlobalInputs = S.Record(S.String, S.Unknown)

export const GlobalFiles = S.Record(S.String, S.String)
