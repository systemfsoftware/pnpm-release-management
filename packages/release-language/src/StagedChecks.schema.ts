import * as S from 'effect/Schema'
import { WorkspaceCommand } from './Publish.schema.ts'
import { Count } from './Workspace.schema.ts'

export const StagedPath = S.String.pipe(
  S.check(S.isPattern(/^(?![/])(?!\s*$).+/)),
  S.brand('StagedPath'),
)
export type StagedPath = S.Schema.Type<typeof StagedPath>

export const CheckKind = S.Literals(['format', 'typecheck', 'lint'])
export type CheckKind = S.Schema.Type<typeof CheckKind>

export const CheckCommand = S.Struct({
  kind: CheckKind,
  command: WorkspaceCommand,
})
export type CheckCommand = S.Schema.Type<typeof CheckCommand>

export const PathFormattable = S.TaggedStruct('PathFormattable', {
  path: StagedPath,
})
export type PathFormattable = S.Schema.Type<typeof PathFormattable>

export const PathUnformattable = S.TaggedStruct('PathUnformattable', {
  path: StagedPath,
  reason: S.String,
})
export type PathUnformattable = S.Schema.Type<typeof PathUnformattable>

export const FormattablePath = S.Union([PathFormattable, PathUnformattable])
export type FormattablePath = S.Schema.Type<typeof FormattablePath>

const StagedChecksDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/StagedChecksDecision',
)
type StagedChecksDecisionTypeId = typeof StagedChecksDecisionTypeId

export class StagedChecksPassed extends S.TaggedClass<StagedChecksPassed>()(
  'StagedChecksPassed',
  {
    staged: Count,
    checks: S.NonEmptyArray(CheckKind),
  },
) {
  readonly [StagedChecksDecisionTypeId] = StagedChecksDecisionTypeId
}

export class StagedVacant extends S.TaggedClass<StagedVacant>()(
  'StagedVacant',
  {
    staged: Count,
  },
) {
  readonly [StagedChecksDecisionTypeId] = StagedChecksDecisionTypeId
}

export class MergeChecksSkipped extends S.TaggedClass<MergeChecksSkipped>()(
  'MergeChecksSkipped',
  {
    staged: Count,
  },
) {
  readonly [StagedChecksDecisionTypeId] = StagedChecksDecisionTypeId
}

export const StagedChecksDecision = S.Union([
  StagedChecksPassed,
  StagedVacant,
  MergeChecksSkipped,
])
export type StagedChecksDecision = S.Schema.Type<typeof StagedChecksDecision>

export const FormatRefused = S.TaggedStruct('FormatRefused', {
  command: CheckCommand,
  reason: S.String,
})
export type FormatRefused = S.Schema.Type<typeof FormatRefused>

export const TypecheckRefused = S.TaggedStruct('TypecheckRefused', {
  command: CheckCommand,
  reason: S.String,
})
export type TypecheckRefused = S.Schema.Type<typeof TypecheckRefused>

export const LintRefused = S.TaggedStruct('LintRefused', {
  command: CheckCommand,
  reason: S.String,
})
export type LintRefused = S.Schema.Type<typeof LintRefused>

export const StagedStateUnreadable = S.TaggedStruct('StagedStateUnreadable', {
  reason: S.String,
})
export type StagedStateUnreadable = S.Schema.Type<typeof StagedStateUnreadable>

export const StagedChecksRefusal = S.Union([
  FormatRefused,
  TypecheckRefused,
  LintRefused,
  StagedStateUnreadable,
])
export type StagedChecksRefusal = S.Schema.Type<typeof StagedChecksRefusal>
