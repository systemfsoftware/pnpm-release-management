import * as S from 'effect/Schema'
import { CommitSha } from './Tag.schema.js'
import { FsPath, HttpUrl, PackageName, PackageVersion, ReleaseTag } from './Workspace.schema.js'

export const PublishedState = S.TaggedStruct('published', {
  integrity: S.String,
  sha256: S.String,
  files: S.Record(S.String, S.String),
})
export type PublishedState = S.Schema.Type<typeof PublishedState>

export const UnpublishedState = S.TaggedStruct('unpublished', {
  url: HttpUrl,
  status: S.Number,
  fetchedAt: S.String,
})
export type UnpublishedState = S.Schema.Type<typeof UnpublishedState>

export const VersionState = S.Union([PublishedState, UnpublishedState])
export type VersionState = S.Schema.Type<typeof VersionState>

export const PublishedLedgerEntry = S.TaggedStruct('published', {
  tag: ReleaseTag,
  commit: CommitSha,
  package: PackageName,
  version: PackageVersion,
  integrity: S.String,
  sha256: S.String,
  files: S.Record(S.String, S.String),
})
export type PublishedLedgerEntry = S.Schema.Type<typeof PublishedLedgerEntry>

export const UnpublishedLedgerEntry = S.TaggedStruct('unpublished', {
  tag: ReleaseTag,
  commit: CommitSha,
  package: PackageName,
  version: PackageVersion,
  url: HttpUrl,
  status: S.Number,
  fetchedAt: S.String,
})
export type UnpublishedLedgerEntry = S.Schema.Type<typeof UnpublishedLedgerEntry>

export const MismatchedLedgerEntry = S.TaggedStruct('mismatched', {
  tag: ReleaseTag,
  commit: CommitSha,
  package: PackageName,
  claimedVersion: PackageVersion,
  manifestVersion: PackageVersion,
  claimed: VersionState,
  manifest: VersionState,
})
export type MismatchedLedgerEntry = S.Schema.Type<typeof MismatchedLedgerEntry>

export const ReleaseLedgerEntry = S.Union([
  PublishedLedgerEntry,
  UnpublishedLedgerEntry,
  MismatchedLedgerEntry,
])
export type ReleaseLedgerEntry = S.Schema.Type<typeof ReleaseLedgerEntry>

export const ReleaseLedger = S.Struct({
  entries: S.Array(ReleaseLedgerEntry),
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

export const VersionBurned = S.TaggedStruct('VersionBurned', {
  package: PackageName,
  version: PackageVersion,
  url: HttpUrl,
  status: S.Number,
  fetchedAt: S.String,
})
export type VersionBurned = S.Schema.Type<typeof VersionBurned>

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
