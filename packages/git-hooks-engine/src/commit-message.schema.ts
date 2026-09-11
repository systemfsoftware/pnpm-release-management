import { CommitMessageRefusal } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export class CommitRejected extends S.TaggedClass<CommitRejected>()(
  'CommitRejected',
  {
    refusal: CommitMessageRefusal,
    problem: S.String,
  },
) {}
