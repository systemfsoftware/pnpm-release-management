import type { GateReport } from '@systemfsoftware/changeset-engine'
import { Reporter, type WorkspaceRootNotAbsolute } from '@systemfsoftware/cli-adapter'
import type {
  ChangeEvidenceRefusal,
  ConfigRefusal,
  Intent,
  IntentRefusal,
  LedgerAppendRefusal,
  LedgerRefusal,
  MemberRefusal,
  NewIntentRefusal,
  RepoRoot,
} from '@systemfsoftware/release-language'
import { Effect, Path } from 'effect'
import * as Match from 'effect/Match'
import type { BaseRefInvalid, BaseRefMissing } from './boundary.schema.js'

export type AppRefusal =
  | ConfigRefusal
  | MemberRefusal
  | IntentRefusal
  | NewIntentRefusal
  | ChangeEvidenceRefusal
  | LedgerRefusal
  | LedgerAppendRefusal
  | WorkspaceRootNotAbsolute
  | BaseRefMissing
  | BaseRefInvalid

export const renderRefusal = (refusal: AppRefusal): Effect.Effect<void, never, Reporter> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    const line = Match.value(refusal).pipe(
      Match.tagsExhaustive({
        ConfigUnreadable: (unreadable) => `cannot read config ${unreadable.path}`,
        ConfigMalformed: (malformed) => `cannot parse config ${malformed.path}: ${malformed.reason}`,
        ConfigFieldMissing: (missing) => `config ${missing.path} is missing required field "${missing.field}"`,
        ConfigFieldInvalid: (invalid) =>
          `config ${invalid.path} field "${invalid.field}" is invalid: ${invalid.reason}`,
        ManifestUnreadable: (unreadable) => `cannot read workspace manifest ${unreadable.path}`,
        ManifestInvalid: (invalid) => `cannot parse workspace manifest ${invalid.path}: ${invalid.reason}`,
        IntentFrontmatterMalformed: (malformed) =>
          `cannot parse changeset intent ${malformed.path}: malformed frontmatter`,
        IntentUnknownPackage: (unknown) => `not workspace packages: ${unknown.package}`,
        IntentSlugTaken: (taken) => `changeset slug "${taken.slug}" is already taken`,
        NewIntentInvalidBump: () => '--bump must be one of none | patch | minor | major',
        NewIntentSummaryMissing: () => '--summary is required, and must be one line',
        NewIntentPackagesEmpty: () => 'name at least one package',
        NewIntentPackageNameMalformed: (malformed) => `not workspace packages: ${malformed.given}`,
        GateUnknownPackage: (unknown) => `${unknown.path} names non-member package "${unknown.package}"`,
        GateIntentMissing: (missing) => `no intent names: ${missing.packages.join(', ')}`,
        EvidenceFileUnreadable: (unreadable) => `cannot read ${unreadable.path}`,
        EvidenceCommandFailed: (failed) => `${failed.program} failed: ${failed.detail}`,
        TurboPinUnusable: (unusable) => `turbo pin unusable: ${unusable.detail}`,
        WorktreeUnavailable: (unavailable) => `worktree unavailable: ${unavailable.detail}`,
        ProcessUnstartable: (unstartable) => `cannot start ${unstartable.program}: ${unstartable.reason}`,
        ProcessUnobservable: (unobservable) => `cannot read ${unobservable.program} output: ${unobservable.reason}`,
        TurboDryRunUnreadable: (unreadable) => `turbo dry-run unreadable (${unreadable.context}): ${unreadable.reason}`,
        TurboDryRunDrifted: (drifted) => `turbo dry-run drifted (${drifted.context}): ${drifted.reason}`,
        WorkspaceRootNotAbsolute: (notAbsolute) => `repository root "${notAbsolute.given}" is not an absolute path`,
        LedgerUnreadable: (unreadable) => `cannot read release ledger ${unreadable.path}: ${unreadable.reason}`,
        LedgerMalformed: (malformed) => `cannot parse release ledger ${malformed.path}: ${malformed.reason}`,
        LedgerUnwritable: (unwritable) => `cannot write release ledger ${unwritable.path}: ${unwritable.reason}`,
        LedgerAppendRemoved: (removed) =>
          `release ledger entry removed at HEAD: ${removed.tag} — the ledger is append-only`,
        LedgerAppendChanged: (changed) =>
          `release ledger entry changed at HEAD: ${changed.tag}, recorded: ${changed.recorded}, current: ${changed.current} — the ledger is append-only`,
        BaseRefMissing: () => 'usage: changeset-management check <base-sha-or-ref>',
        BaseRefInvalid: (invalid) => `invalid base ref "${invalid.given}"`,
      }),
    )
    yield* reporter.annotateError(line)
    yield* reporter.exitCode(1)
  })

export const renderGate = (report: GateReport): Effect.Effect<void, never, Reporter> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    if (report.ok) {
      yield* reporter.emit(report.text)
      return
    }
    yield* reporter.annotateError(report.text)
    yield* reporter.exitCode(1)
  })

export const renderStaged = (root: RepoRoot, intent: Intent): Effect.Effect<void, never, Reporter | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const reporter = yield* Reporter
    yield* reporter.emit(path.join(root, intent.path))
  })
