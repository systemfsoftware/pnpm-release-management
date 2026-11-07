import type {
  EvidenceCommandFailed,
  EvidenceFileUnreadable,
  GateIntentMissing,
  GateUnknownPackage,
  PathsGateUnderTurbo,
  ProcessUnobservable,
  ProcessUnstartable,
  TurboDryRunDrifted,
  TurboDryRunUnreadable,
  TurboPinUnusable,
  WorktreeUnavailable,
} from '@systemfsoftware/release-language'

export const evidenceRefusalLines = {
  GateUnknownPackage: (unknown: GateUnknownPackage): string =>
    `${unknown.path} names non-member package "${unknown.package}"`,
  GateIntentMissing: (missing: GateIntentMissing): string => `no intent names: ${missing.packages.join(', ')}`,
  EvidenceFileUnreadable: (unreadable: EvidenceFileUnreadable): string => `cannot read ${unreadable.path}`,
  EvidenceCommandFailed: (failed: EvidenceCommandFailed): string => `${failed.program} failed: ${failed.detail}`,
  TurboPinUnusable: (unusable: TurboPinUnusable): string => `turbo pin unusable: ${unusable.detail}`,
  PathsGateUnderTurbo: (refused: PathsGateUnderTurbo): string =>
    `paths gate refused: ${refused.turboConfig} makes turbo the source of change evidence — set "gate": { "strategy": "turbo" } in release.jsonc`,
  WorktreeUnavailable: (unavailable: WorktreeUnavailable): string => `worktree unavailable: ${unavailable.detail}`,
  ProcessUnstartable: (unstartable: ProcessUnstartable): string =>
    `cannot start ${unstartable.program}: ${unstartable.reason}`,
  ProcessUnobservable: (unobservable: ProcessUnobservable): string =>
    `cannot read ${unobservable.program} output: ${unobservable.reason}`,
  TurboDryRunUnreadable: (unreadable: TurboDryRunUnreadable): string =>
    `turbo dry-run unreadable (${unreadable.context}): ${unreadable.reason}`,
  TurboDryRunDrifted: (drifted: TurboDryRunDrifted): string =>
    `turbo dry-run drifted (${drifted.context}): ${drifted.reason}`,
}
