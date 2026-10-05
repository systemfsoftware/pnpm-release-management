import type { CommitMessageInput, StagedChecksInput } from '@systemfsoftware/git-hooks-engine'
import { GitPort, type StagedChecksRefusal } from '@systemfsoftware/release-language'
import { Effect, FileSystem, Option } from 'effect'
import * as S from 'effect/Schema'
import { MessageFile, type MessageFileMissing, type MessageUnreadable } from './boundary.schema.js'

type CommitMessageRequest = S.Schema.Type<typeof CommitMessageInput>
type StagedChecksRequest = S.Schema.Type<typeof StagedChecksInput>

const isScript = (path: string): boolean => path.startsWith('scripts/') && path.endsWith('.ts')

const messageFileOf = (
  given: Option.Option<string>,
): Effect.Effect<MessageFile, MessageFileMissing | S.SchemaError> =>
  Option.match(given, {
    onNone: () => Effect.fail<MessageFileMissing>({ _tag: 'MessageFileMissing' }),
    onSome: (path) => S.decodeUnknownEffect(MessageFile)(path),
  })

const messageOf = (
  path: MessageFile,
): Effect.Effect<string, MessageUnreadable, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(path).pipe(
      Effect.mapError((cause): MessageUnreadable => ({
        _tag: 'MessageUnreadable',
        path,
        detail: cause.message,
      })),
    )
  })

export const stagedChecksRequest: Effect.Effect<StagedChecksRequest, StagedChecksRefusal, GitPort> = Effect.gen(
  function*() {
    const git = yield* GitPort
    const staged = yield* git.stagedPaths()
    return { scripts: staged.filter(isScript) }
  },
)

export const commitMessageRequest = (
  given: Option.Option<string>,
): Effect.Effect<
  CommitMessageRequest,
  MessageFileMissing | MessageUnreadable | StagedChecksRefusal | S.SchemaError,
  GitPort | FileSystem.FileSystem
> =>
  Effect.gen(function*() {
    const path = yield* messageFileOf(given)
    const raw = yield* messageOf(path)
    const git = yield* GitPort
    const staged = yield* git.stagedPaths()
    return { raw, staged }
  })
