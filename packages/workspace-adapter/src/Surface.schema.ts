import * as S from 'effect/Schema'

export const PackageSection = S.Struct({
  package: S.Struct({ version: S.Unknown }),
})
export type PackageSection = S.Schema.Type<typeof PackageSection>

export const WorkspaceSection = S.Struct({
  workspace: S.Struct({ package: S.Struct({ version: S.Unknown }) }),
})
export type WorkspaceSection = S.Schema.Type<typeof WorkspaceSection>
