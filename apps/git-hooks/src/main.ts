import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { program, ReporterLive } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { GitLive } from '@systemfsoftware/git-adapter'
import { commitMessageCell, stagedChecksCell } from '@systemfsoftware/git-hooks-engine'
import { ProcessLive } from '@systemfsoftware/process-adapter'
import { Effect, Layer } from 'effect'
import { Argument, Command } from 'effect/unstable/cli'
import { commitMessageRequest, stagedChecksRequest } from './boundary.js'
import {
  renderCommitMessage,
  renderCommitMessageRefusal,
  renderStagedChecks,
  renderStagedChecksRefusal,
} from './render.js'

const VERSION = '0.0.0'

const preCommit = Command.make('pre-commit', {}, () =>
  Effect.matchEffect(
    Effect.gen(function*() {
      const request = yield* stagedChecksRequest
      return yield* Cell.run(stagedChecksCell, request)
    }),
    { onFailure: renderStagedChecksRefusal, onSuccess: renderStagedChecks },
  ))

const commitMsg = Command.make(
  'commit-msg',
  { messageFile: Argument.string('path-to-commit-message').pipe(Argument.optional) },
  ({ messageFile }) =>
    Effect.matchEffect(
      Effect.gen(function*() {
        const request = yield* commitMessageRequest(messageFile)
        return yield* Cell.run(commitMessageCell, request)
      }),
      { onFailure: renderCommitMessageRefusal, onSuccess: renderCommitMessage },
    ),
)

const hooks = Command.make('hooks').pipe(
  Command.withDescription('Run the repo git hooks (format, lint, commit-message gate)'),
  Command.withSubcommands([preCommit, commitMsg]),
)

NodeRuntime.runMain(
  Effect.provide(
    program(hooks, VERSION),
    Layer.mergeAll(GitLive, ProcessLive, ReporterLive, NodeServices.layer),
  ),
)
