import * as S from 'effect/Schema'
import { RepoRoot } from './Workspace.schema.js'

export const CommandName = S.NonEmptyString.pipe(S.brand('CommandName'))
export type CommandName = S.Schema.Type<typeof CommandName>

export const CommandArg = S.NonEmptyString.pipe(S.brand('CommandArg'))
export type CommandArg = S.Schema.Type<typeof CommandArg>

export const WorkspaceCommand = S.Struct({
  program: CommandName,
  args: S.Array(CommandArg),
  cwd: S.optional(RepoRoot),
})
export type WorkspaceCommand = S.Schema.Type<typeof WorkspaceCommand>

export const ProcessCompleted = S.TaggedStruct('ProcessCompleted', {
  command: WorkspaceCommand,
})
export type ProcessCompleted = S.Schema.Type<typeof ProcessCompleted>

export const CommandRefused = S.TaggedStruct('CommandRefused', {
  command: WorkspaceCommand,
  reason: S.String,
})
export type CommandRefused = S.Schema.Type<typeof CommandRefused>

export const CommandRefusal = S.Union([CommandRefused])
export type CommandRefusal = S.Schema.Type<typeof CommandRefusal>
