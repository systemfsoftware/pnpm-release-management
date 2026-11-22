import { NodeServices } from '@effect/platform-node'
import { ChangeEvidencePort } from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as HttpClient from 'effect/unstable/http/HttpClient'
import { deletedAt, refuseUnderTurbo } from './evidence-io.js'
import { changesBetween, commitsOf, fileAt, filesIn, rangeOf } from './history-io.js'
import { compareTurboRuns } from './turbo-evidence.js'
import { turboPin } from './turbo-pin.js'

const evidencePort = (client: HttpClient.HttpClient): ChangeEvidencePort => ({
  range: (root, base) => rangeOf(root, base).pipe(Effect.provide(NodeServices.layer)),
  refuseUnderTurbo: (root, range) =>
    refuseUnderTurbo(root, range.base, range.head).pipe(Effect.provide(NodeServices.layer)),
  commits: (root, range) => commitsOf(root, range).pipe(Effect.provide(NodeServices.layer)),
  changes: (root, from, to) => changesBetween(root, from, to).pipe(Effect.provide(NodeServices.layer)),
  filesIn: (root, rev, dir) => filesIn(root, rev, dir).pipe(Effect.provide(NodeServices.layer)),
  fileAt: (root, rev, path) => fileAt(root, rev, path).pipe(Effect.provide(NodeServices.layer)),
  deletedMembers: (root, range) =>
    Effect.gen(function*() {
      const changed = yield* changesBetween(root, range.mergeBase, range.head)
      return yield* deletedAt(root, range.mergeBase, changed.map((change) => change.path))
    }).pipe(Effect.provide(NodeServices.layer)),
  turbo: (root, range, task) =>
    Effect.gen(function*() {
      const pinned = yield* turboPin(root)
      return yield* compareTurboRuns(root, range.mergeBase, task, pinned)
    }).pipe(Effect.provideService(HttpClient.HttpClient, client), Effect.provide(NodeServices.layer)),
})

export const ChangeEvidenceLive: Layer.Layer<ChangeEvidencePort, never, HttpClient.HttpClient> = Layer.effect(
  ChangeEvidencePort,
  Effect.map(HttpClient.HttpClient, evidencePort),
)
