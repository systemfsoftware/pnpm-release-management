import * as S from 'effect/Schema'

export class CommitMessageCommand extends S.TaggedClass<CommitMessageCommand>()(
  'CommitMessageCommand',
  {
    raw: S.String,
    staged: S.Array(S.String),
  },
) {}
