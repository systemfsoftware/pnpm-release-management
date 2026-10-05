import * as S from 'effect/Schema'

export const PackageSection = S.Struct({
  package: S.Struct({ version: S.Unknown }),
})
export type PackageSection = S.Schema.Type<typeof PackageSection>

export const WorkspaceSection = S.Struct({
  workspace: S.Struct({ package: S.Struct({ version: S.Unknown }) }),
})
export type WorkspaceSection = S.Schema.Type<typeof WorkspaceSection>

export const JsonVersion = S.fromJsonString(S.Struct({ version: S.Unknown }))
export type JsonVersion = S.Schema.Type<typeof JsonVersion>

export const JsonDocument = S.fromJsonString(S.Record(S.String, S.Unknown))
export type JsonDocument = S.Schema.Type<typeof JsonDocument>
