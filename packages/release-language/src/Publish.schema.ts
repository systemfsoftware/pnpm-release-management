import * as S from 'effect/Schema'
import { PublishArg } from './Config.schema.ts'
import { Count, FsPath, RepoRoot } from './Workspace.schema.ts'

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

const PublishDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/PublishDecision',
)
type PublishDecisionTypeId = typeof PublishDecisionTypeId

export class PublishDispatched extends S.TaggedClass<PublishDispatched>()(
  'PublishDispatched',
  {
    command: WorkspaceCommand,
  },
) {
  readonly [PublishDecisionTypeId] = PublishDecisionTypeId
}

export class PublishNothingOwed extends S.TaggedClass<PublishNothingOwed>()(
  'PublishNothingOwed',
  {
    packages: Count,
  },
) {
  readonly [PublishDecisionTypeId] = PublishDecisionTypeId
}

export class PublishDryRun extends S.TaggedClass<PublishDryRun>()(
  'PublishDryRun',
  {
    command: WorkspaceCommand,
  },
) {
  readonly [PublishDecisionTypeId] = PublishDecisionTypeId
}

export const PublishDecision = S.Union([
  PublishDispatched,
  PublishNothingOwed,
  PublishDryRun,
])
export type PublishDecision = S.Schema.Type<typeof PublishDecision>

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
