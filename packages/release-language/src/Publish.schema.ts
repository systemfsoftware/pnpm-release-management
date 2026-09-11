import * as S from 'effect/Schema'
import { PublishArg } from './Config.schema.js'
import { FsPath, RepoRoot } from './Workspace.schema.js'

export const CommandName = S.NonEmptyString.pipe(S.brand('CommandName'))
export type CommandName = S.Schema.Type<typeof CommandName>

export const WorkspaceCommand = S.Struct({
  program: CommandName,
  args: S.Array(PublishArg),
  cwd: S.optional(RepoRoot),
})
export type WorkspaceCommand = S.Schema.Type<typeof WorkspaceCommand>

export const ProcessCompleted = S.TaggedStruct('ProcessCompleted', {
  command: WorkspaceCommand,
})
export type ProcessCompleted = S.Schema.Type<typeof ProcessCompleted>

export const PublishCapturedRequired = S.TaggedStruct(
  'PublishCapturedRequired',
  {
    flag: S.Literal('--captured'),
  },
)
export type PublishCapturedRequired = S.Schema.Type<
  typeof PublishCapturedRequired
>

export const PublishFiltersUnreadable = S.TaggedStruct(
  'PublishFiltersUnreadable',
  {
    path: FsPath,
  },
)
export type PublishFiltersUnreadable = S.Schema.Type<
  typeof PublishFiltersUnreadable
>

export const PublishCommandRefused = S.TaggedStruct('PublishCommandRefused', {
  command: WorkspaceCommand,
  reason: S.String,
})
export type PublishCommandRefused = S.Schema.Type<typeof PublishCommandRefused>

export const PublishRefusal = S.Union([
  PublishCapturedRequired,
  PublishFiltersUnreadable,
  PublishCommandRefused,
])
export type PublishRefusal = S.Schema.Type<typeof PublishRefusal>
