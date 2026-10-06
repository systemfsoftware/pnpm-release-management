import * as S from 'effect/Schema'
import { CommitSha } from './Tag.schema.js'
import { FsPath, PackageName, PackageVersion, ReleaseTag } from './Workspace.schema.js'

export const LedgerEntry = S.Struct({
  tag: ReleaseTag,
  commit: CommitSha,
  package: PackageName,
  version: PackageVersion,
  integrity: S.String,
  sha256: S.String,
  files: S.Record(S.String, S.String),
})
export type LedgerEntry = S.Schema.Type<typeof LedgerEntry>

export const ReleaseLedger = S.Struct({
  entries: S.Array(LedgerEntry),
})
export type ReleaseLedger = S.Schema.Type<typeof ReleaseLedger>

export const LedgerUnreadable = S.TaggedStruct('LedgerUnreadable', {
  path: FsPath,
  reason: S.String,
})
export type LedgerUnreadable = S.Schema.Type<typeof LedgerUnreadable>

export const LedgerMalformed = S.TaggedStruct('LedgerMalformed', {
  path: FsPath,
  reason: S.String,
})
export type LedgerMalformed = S.Schema.Type<typeof LedgerMalformed>

export const LedgerUnwritable = S.TaggedStruct('LedgerUnwritable', {
  path: FsPath,
  reason: S.String,
})
export type LedgerUnwritable = S.Schema.Type<typeof LedgerUnwritable>

export const LedgerRefusal = S.Union([LedgerUnreadable, LedgerMalformed, LedgerUnwritable])
export type LedgerRefusal = S.Schema.Type<typeof LedgerRefusal>

export const LedgerTagMissing = S.TaggedStruct('LedgerTagMissing', {
  tag: ReleaseTag,
})
export type LedgerTagMissing = S.Schema.Type<typeof LedgerTagMissing>

export const LedgerTagMoved = S.TaggedStruct('LedgerTagMoved', {
  tag: ReleaseTag,
  recorded: CommitSha,
  current: CommitSha,
})
export type LedgerTagMoved = S.Schema.Type<typeof LedgerTagMoved>

export const LedgerEntryMismatch = S.TaggedStruct('LedgerEntryMismatch', {
  tag: ReleaseTag,
  recorded: S.String,
  current: S.String,
})
export type LedgerEntryMismatch = S.Schema.Type<typeof LedgerEntryMismatch>

export const LedgerIdentityRefusal = S.Union([LedgerTagMissing, LedgerTagMoved, LedgerEntryMismatch])
export type LedgerIdentityRefusal = S.Schema.Type<typeof LedgerIdentityRefusal>

export const LedgerAppendRemoved = S.TaggedStruct('LedgerAppendRemoved', {
  tag: ReleaseTag,
})
export type LedgerAppendRemoved = S.Schema.Type<typeof LedgerAppendRemoved>

export const LedgerAppendChanged = S.TaggedStruct('LedgerAppendChanged', {
  tag: ReleaseTag,
  recorded: S.String,
  current: S.String,
})
export type LedgerAppendChanged = S.Schema.Type<typeof LedgerAppendChanged>

export const LedgerAppendRefusal = S.Union([LedgerAppendRemoved, LedgerAppendChanged])
export type LedgerAppendRefusal = S.Schema.Type<typeof LedgerAppendRefusal>
