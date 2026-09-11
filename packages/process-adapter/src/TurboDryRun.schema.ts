import { PackageName, RelativePath } from '@systemfsoftware/release-language'
import * as HashMap from 'effect/HashMap'
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

export interface DryRun {
  readonly packages: ReadonlyArray<PackageName>
  readonly matrix: HashMap.HashMap<string, string>
  readonly dirs: HashMap.HashMap<string, RelativePath>
  readonly engineVersion: string | null
}

export class TurboDryRunUnreadable extends S.TaggedError<TurboDryRunUnreadable>()('TurboDryRunUnreadable', {
  context: S.String,
  reason: S.String,
}) {}

export class TurboDryRunDrifted extends S.TaggedError<TurboDryRunDrifted>()('TurboDryRunDrifted', {
  context: S.String,
  reason: S.String,
}) {}

export type TurboDryRunFault = TurboDryRunUnreadable | TurboDryRunDrifted
