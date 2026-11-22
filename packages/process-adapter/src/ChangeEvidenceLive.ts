import { NodeServices } from '@effect/platform-node'
import {
  type ChangeEvidence,
  ChangeEvidencePort,
  EvidenceCommandFailed,
  GitPort,
  RelativePath,
  type TagRefusal,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as Match from 'effect/Match'
import * as HttpClient from 'effect/unstable/http/HttpClient'
import { pathsTouched } from './change-verdict.js'
import { consumedIntentsAt, deletedAt, gitLines, MANIFEST_GLOB, membersAt, refuseUnderTurbo } from './evidence-io.js'
import { collectTurboEvidence } from './turbo-evidence.js'
import { turboPin } from './turbo-pin.js'

const DEFAULT_CHANGESET_DIR = RelativePath.make('.changeset')

const refusalDetail = (refusal: TagRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('TagGitFailed', (failed) => `git command failed: ${failed.command}\n${failed.stderr}`),
    Match.orElse((other) => other.path),
  )

const branchFault = (refusal: TagRefusal): EvidenceCommandFailed =>
  new EvidenceCommandFailed({
    program: 'git',
    detail: `current branch unreadable: ${refusalDetail(refusal)}`,
  })

const evidencePort = (git: GitPort, client: HttpClient.HttpClient): ChangeEvidencePort => ({
  pathsEvidence: (root, ref, changesetDir = DEFAULT_CHANGESET_DIR) =>
    Effect.gen(function*() {
      const head = yield* git.currentBranch().pipe(Effect.mapError(branchFault))
      yield* refuseUnderTurbo(root, ref, head)
      const changed = yield* git.changedPaths(ref, head)
      const members = yield* membersAt(root, yield* gitLines(root, MANIFEST_GLOB))
      const [mergeBase = ref] = yield* gitLines(root, ['merge-base', ref, head])
      const evidence: ChangeEvidence = {
        members: [...members],
        deleted: [...(yield* deletedAt(root, mergeBase, changed))],
        touched: pathsTouched(members, changed),
        changed: [...changed],
        consumed: [...(yield* consumedIntentsAt(root, mergeBase, changesetDir, changed))],
        raw: { strategy: 'paths', base: ref, changedPaths: [...changed] },
      }
      return evidence
    }).pipe(Effect.provide(NodeServices.layer)),

  turboEvidence: (root, ref, task, changesetDir = DEFAULT_CHANGESET_DIR) =>
    Effect.gen(function*() {
      const head = yield* git.currentBranch().pipe(Effect.mapError(branchFault))
      const pinned = yield* turboPin(root)
      const parsed = yield* gitLines(
        root,
        ['rev-parse', '--verify', `${ref}^{commit}`],
      )
      const baseSha = parsed[0]
      if (baseSha === undefined) {
        return yield* Effect.fail(
          new EvidenceCommandFailed({
            program: 'git',
            detail: `git rev-parse printed no sha for ${ref}`,
          }),
        )
      }
      const changed = yield* git.changedPaths(ref, head)
      return yield* collectTurboEvidence(root, baseSha, task, pinned, changed, changesetDir)
    }).pipe(Effect.provideService(HttpClient.HttpClient, client), Effect.provide(NodeServices.layer)),
})

export const ChangeEvidenceLive: Layer.Layer<ChangeEvidencePort, never, GitPort | HttpClient.HttpClient> = Layer
  .effect(
    ChangeEvidencePort,
    Effect.gen(function*() {
      return evidencePort(yield* GitPort, yield* HttpClient.HttpClient)
    }),
  )
