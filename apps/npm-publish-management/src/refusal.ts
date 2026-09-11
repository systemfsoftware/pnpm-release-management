import { type WorkspaceRootNotAbsolute } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { stageNpmTrustCell, type StatusMode } from '@systemfsoftware/npm-publish-engine'
import {
  type ConfigRefusal,
  type MemberRefusal,
  type PackageName,
  type PlanRefusal,
  type PublishRefusal,
  type PublishStatusRefusal,
  type TrustRefusal,
} from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import type { BoundaryRefusal } from './boundary.schema.js'

const DEBUT_GUIDANCE = 'OIDC cannot debut a package; bootstrap each one, then re-run.'

const rootNotAbsoluteText = (refusal: WorkspaceRootNotAbsolute): string =>
  `workspace root "${refusal.given}" is not an absolute path`

const configRefusalText = (refusal: ConfigRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('ConfigUnreadable', (unreadable) => `${unreadable.path}: cannot be read`),
    Match.tag('ConfigMalformed', (malformed) => `${malformed.path}: ${malformed.reason}`),
    Match.tag('ConfigFieldMissing', (missing) => `${missing.path}: missing field ${missing.field}`),
    Match.tag(
      'ConfigFieldInvalid',
      (invalid) => `${invalid.path}: invalid field ${invalid.field}: ${invalid.reason}`,
    ),
    Match.exhaustive,
  )

const boundaryRefusalText = (refusal: BoundaryRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('RequestInvalid', (invalid) => invalid.reason),
    Match.tag('EmitUnwritable', (unwritable) => `${unwritable.path}: ${unwritable.reason}`),
    Match.exhaustive,
  )

const planRefusalText = (refusal: PlanRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('PlanDeferredUnknown', (unknown) => `unknown deferred packages: ${unknown.packages.join(', ')}`),
    Match.tag(
      'PlanCapturedMalformed',
      (malformed) => `${malformed.path}: captured file is malformed or unreadable`,
    ),
    Match.exhaustive,
  )

const publishRefusalText = (refusal: PublishRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag(
      'PublishCapturedRequired',
      () => '--unpublished needs --captured <file> to know which versions this cycle owns',
    ),
    Match.tag('PublishFiltersUnreadable', (unreadable) => `${unreadable.path}: unable to read filters file`),
    Match.tag('PublishCommandRefused', (refused) => refused.reason),
    Match.exhaustive,
  )

const trustOnlyUnmatchedText = (unmatched: { readonly only: ReadonlyArray<PackageName> }): string =>
  `--only matched no publishable package: ${unmatched.only.join(', ')}`

const trustWorkspaceEmptyText = (): string => 'no publishable packages discovered (did the workspace resolve?)'

const trustRegistryUnreadableText = (unreadable: { readonly packages: ReadonlyArray<PackageName> }): string =>
  `registry unreadable: ${unreadable.packages.join(', ')}`

const trustPublishRefusedText = (refused: { readonly packages: ReadonlyArray<PackageName> }): string =>
  `failed: ${refused.packages.join(', ')}`

const trustLauncherMissingText = (missing: { readonly package: PackageName }): string =>
  `${missing.package} needs a distribution launcher manifest to be staged`

const trustRefusalText = (refusal: TrustRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('TrustOnlyUnmatched', trustOnlyUnmatchedText),
    Match.tag('TrustWorkspaceEmpty', trustWorkspaceEmptyText),
    Match.tag('TrustRegistryUnreadable', trustRegistryUnreadableText),
    Match.tag('TrustPublishRefused', trustPublishRefusedText),
    Match.tag('TrustLauncherMissing', trustLauncherMissingText),
    Match.exhaustive,
  )

const memberRefusalText = (refusal: MemberRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('ManifestUnreadable', (unreadable) => `${unreadable.path}: unable to read package manifest`),
    Match.tag('ManifestInvalid', (invalid) => `${invalid.path}: ${invalid.reason}`),
    Match.exhaustive,
  )

const preflightFailedText = (summary: string): string => `preflight failed — ${summary}. ${DEBUT_GUIDANCE}`

const statusRefusalText = (refusal: PublishStatusRefusal, mode: StatusMode): string =>
  Match.value(refusal).pipe(
    Match.tag('PublishStatusEmpty', () => 'no publishable packages discovered — did the workspace resolve?'),
    Match.tag('PublishStatusUnreadable', (unreadable) =>
      Match.value(mode).pipe(
        Match.when('preflight', () =>
          preflightFailedText(
            `0 package(s) have never been published, ${unreadable.packages.length} unqueryable`,
          )),
        Match.when(
          'check',
          () => `FAIL: 0 unpublished, 0 without OIDC attestation, ${unreadable.packages.length} unqueryable`,
        ),
        Match.orElse(() => trustRegistryUnreadableText(unreadable)),
      )),
    Match.tag('PublishStatusUnpublished', (unpublished) =>
      Match.value(mode).pipe(
        Match.when('preflight', () =>
          preflightFailedText(
            `${unpublished.packages.length} package(s) have never been published, 0 unqueryable`,
          )),
        Match.orElse(() =>
          `FAIL: ${unpublished.packages.length} unpublished, 0 without OIDC attestation, 0 unqueryable`
        ),
      )),
    Match.tag(
      'PublishStatusUnattested',
      (unattested) => `FAIL: 0 unpublished, ${unattested.packages.length} without OIDC attestation, 0 unqueryable`,
    ),
    Match.exhaustive,
  )

type CellRefusal<C> = C extends Cell.Cell<infer _Input, infer _Output, infer Refusal, infer _Services> ? Refusal
  : never

export type PublishFailure =
  | ConfigRefusal
  | WorkspaceRootNotAbsolute
  | BoundaryRefusal
  | PlanRefusal
  | PublishRefusal
  | TrustRefusal

export type StatusFailure =
  | ConfigRefusal
  | WorkspaceRootNotAbsolute
  | BoundaryRefusal
  | MemberRefusal
  | TrustRefusal
  | PublishStatusRefusal

export type TrustFailure =
  | ConfigRefusal
  | WorkspaceRootNotAbsolute
  | BoundaryRefusal
  | CellRefusal<typeof stageNpmTrustCell>

export const publishFailureText = (refusal: PublishFailure): string =>
  Match.value(refusal).pipe(
    Match.tag('PlanDeferredUnknown', planRefusalText),
    Match.tag('PlanCapturedMalformed', planRefusalText),
    Match.tag('PublishCapturedRequired', publishRefusalText),
    Match.tag('PublishFiltersUnreadable', publishRefusalText),
    Match.tag('PublishCommandRefused', publishRefusalText),
    Match.tag('TrustOnlyUnmatched', trustRefusalText),
    Match.tag('TrustWorkspaceEmpty', trustRefusalText),
    Match.tag('TrustRegistryUnreadable', trustRefusalText),
    Match.tag('TrustPublishRefused', trustRefusalText),
    Match.tag('TrustLauncherMissing', trustRefusalText),
    Match.tag('ConfigUnreadable', configRefusalText),
    Match.tag('ConfigMalformed', configRefusalText),
    Match.tag('ConfigFieldMissing', configRefusalText),
    Match.tag('ConfigFieldInvalid', configRefusalText),
    Match.tag('WorkspaceRootNotAbsolute', rootNotAbsoluteText),
    Match.tag('RequestInvalid', boundaryRefusalText),
    Match.tag('EmitUnwritable', boundaryRefusalText),
    Match.exhaustive,
  )

export const statusFailureText = (refusal: StatusFailure, mode: StatusMode): string =>
  Match.value(refusal).pipe(
    Match.tag('PublishStatusEmpty', (empty) => statusRefusalText(empty, mode)),
    Match.tag('PublishStatusUnreadable', (unreadable) => statusRefusalText(unreadable, mode)),
    Match.tag('PublishStatusUnpublished', (unpublished) => statusRefusalText(unpublished, mode)),
    Match.tag('PublishStatusUnattested', (unattested) => statusRefusalText(unattested, mode)),
    Match.tag('ManifestUnreadable', memberRefusalText),
    Match.tag('ManifestInvalid', memberRefusalText),
    Match.tag('TrustOnlyUnmatched', trustRefusalText),
    Match.tag('TrustWorkspaceEmpty', trustRefusalText),
    Match.tag('TrustRegistryUnreadable', trustRefusalText),
    Match.tag('TrustPublishRefused', trustRefusalText),
    Match.tag('TrustLauncherMissing', trustRefusalText),
    Match.tag('ConfigUnreadable', configRefusalText),
    Match.tag('ConfigMalformed', configRefusalText),
    Match.tag('ConfigFieldMissing', configRefusalText),
    Match.tag('ConfigFieldInvalid', configRefusalText),
    Match.tag('WorkspaceRootNotAbsolute', rootNotAbsoluteText),
    Match.tag('RequestInvalid', boundaryRefusalText),
    Match.tag('EmitUnwritable', boundaryRefusalText),
    Match.exhaustive,
  )

export const trustFailureText = (refusal: TrustFailure): string =>
  Match.value(refusal).pipe(
    Match.tag('ManifestUnreadable', memberRefusalText),
    Match.tag('ManifestInvalid', memberRefusalText),
    Match.tag('TrustOnlyUnmatched', trustOnlyUnmatchedText),
    Match.tag('TrustWorkspaceEmpty', trustWorkspaceEmptyText),
    Match.tag('TrustRegistryUnreadable', trustRegistryUnreadableText),
    Match.tag('TrustPublishRefused', trustPublishRefusedText),
    Match.tag('TrustLauncherMissing', trustLauncherMissingText),
    Match.tag('ConfigUnreadable', configRefusalText),
    Match.tag('ConfigMalformed', configRefusalText),
    Match.tag('ConfigFieldMissing', configRefusalText),
    Match.tag('ConfigFieldInvalid', configRefusalText),
    Match.tag('WorkspaceRootNotAbsolute', rootNotAbsoluteText),
    Match.tag('RequestInvalid', boundaryRefusalText),
    Match.tag('EmitUnwritable', boundaryRefusalText),
    Match.exhaustive,
  )
