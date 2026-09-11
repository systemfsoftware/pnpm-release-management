import * as S from 'effect/Schema'
import { Count } from './Workspace.schema.js'

export const CommitType = S.Literals([
  'ai',
  'api',
  'build',
  'chore',
  'ci',
  'deps',
  'docs',
  'e2e',
  'feat',
  'fix',
  'improvement',
  'perf',
  'refactor',
  'revert',
  'security',
  'style',
  'test',
])
export type CommitType = S.Schema.Type<typeof CommitType>

export const CommitScope = S.Literals([
  'ci',
  'deps',
  'docs',
  'e2e',
  'gate',
  'global',
  'nix',
  'plan',
  'publish',
  'release',
  'repo',
  'solutions',
  'tag',
  'version',
])
export type CommitScope = S.Schema.Type<typeof CommitScope>

export const CommitShape = S.Literals([
  'docs',
  'test',
  'CI',
  'lockfile',
  'tooling',
])
export type CommitShape = S.Schema.Type<typeof CommitShape>

export const CommitSubject = S.NonEmptyString.pipe(S.brand('CommitSubject'))
export type CommitSubject = S.Schema.Type<typeof CommitSubject>

export const CommitIgnoreKind = S.Literals([
  'merge',
  'revert',
  'fixup',
  'amend',
  'release',
])
export type CommitIgnoreKind = S.Schema.Type<typeof CommitIgnoreKind>

const CommitMessageDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/CommitMessageDecision',
)
type CommitMessageDecisionTypeId = typeof CommitMessageDecisionTypeId

export class CommitAccepted extends S.TaggedClass<CommitAccepted>()(
  'CommitAccepted',
  {
    type: CommitType,
    scope: S.optional(CommitScope),
    subject: CommitSubject,
  },
) {
  readonly [CommitMessageDecisionTypeId] = CommitMessageDecisionTypeId
}

export class CommitIgnored extends S.TaggedClass<CommitIgnored>()(
  'CommitIgnored',
  {
    kind: CommitIgnoreKind,
  },
) {
  readonly [CommitMessageDecisionTypeId] = CommitMessageDecisionTypeId
}

export const CommitMessageDecision = S.Union([CommitAccepted, CommitIgnored])
export type CommitMessageDecision = S.Schema.Type<typeof CommitMessageDecision>

export const CommitEmpty = S.TaggedStruct('CommitEmpty', {
  staged: Count,
})
export type CommitEmpty = S.Schema.Type<typeof CommitEmpty>

export const CommitHeaderMalformed = S.TaggedStruct('CommitHeaderMalformed', {
  header: S.String,
})
export type CommitHeaderMalformed = S.Schema.Type<typeof CommitHeaderMalformed>

export const CommitTypeUnknown = S.TaggedStruct('CommitTypeUnknown', {
  type: S.String,
})
export type CommitTypeUnknown = S.Schema.Type<typeof CommitTypeUnknown>

export const CommitScopeUnknown = S.TaggedStruct('CommitScopeUnknown', {
  scope: S.String,
})
export type CommitScopeUnknown = S.Schema.Type<typeof CommitScopeUnknown>

export const CommitSubjectEmpty = S.TaggedStruct('CommitSubjectEmpty', {
  header: S.String,
})
export type CommitSubjectEmpty = S.Schema.Type<typeof CommitSubjectEmpty>

export const CommitHeaderPunctuation = S.TaggedStruct(
  'CommitHeaderPunctuation',
  {
    header: S.String,
  },
)
export type CommitHeaderPunctuation = S.Schema.Type<
  typeof CommitHeaderPunctuation
>

export const CommitAiAttribution = S.TaggedStruct('CommitAiAttribution', {
  lines: Count,
})
export type CommitAiAttribution = S.Schema.Type<typeof CommitAiAttribution>

export const CommitShapeMismatched = S.TaggedStruct('CommitShapeMismatched', {
  type: CommitType,
  shape: CommitShape,
  allowed: S.NonEmptyArray(CommitType),
})
export type CommitShapeMismatched = S.Schema.Type<typeof CommitShapeMismatched>

export const CommitProductionUntouched = S.TaggedStruct(
  'CommitProductionUntouched',
  {
    type: S.Literals(['feat', 'fix']),
  },
)
export type CommitProductionUntouched = S.Schema.Type<
  typeof CommitProductionUntouched
>

export const CommitMessageRefusal = S.Union([
  CommitEmpty,
  CommitHeaderMalformed,
  CommitTypeUnknown,
  CommitScopeUnknown,
  CommitSubjectEmpty,
  CommitHeaderPunctuation,
  CommitAiAttribution,
  CommitShapeMismatched,
  CommitProductionUntouched,
])
export type CommitMessageRefusal = S.Schema.Type<typeof CommitMessageRefusal>
