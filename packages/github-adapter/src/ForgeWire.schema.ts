import { GitRef, PullRequestNumber, ReleaseId, ReleaseLabel } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const ReleaseAnswer = S.Struct({ id: ReleaseId })
export const PullRequestAnswer = S.Struct({ number: PullRequestNumber })
export const OpenPullAnswers = S.Array(
  S.Struct({
    number: PullRequestNumber,
    head: S.Struct({
      ref: S.String,
      repo: S.NullOr(S.Struct({ owner: S.Struct({ login: S.String }) })),
    }),
  }),
)
export const PullSummaryAnswers = S.Array(
  S.Struct({ number: PullRequestNumber, title: S.String, head: S.Struct({ ref: GitRef }) }),
)
export const LabelAnswers = S.Array(S.Struct({ name: ReleaseLabel }))
export const DefaultBranchAnswer = S.Struct({ default_branch: GitRef })
