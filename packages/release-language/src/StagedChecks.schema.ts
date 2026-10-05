import * as S from 'effect/Schema'
import { WorkspaceCommand } from './Command.schema.js'

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
