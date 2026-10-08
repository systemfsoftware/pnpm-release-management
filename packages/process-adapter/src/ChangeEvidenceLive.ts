import { NodeServices } from '@effect/platform-node'
import {
  type ChangeEvidence,
  ChangeEvidencePort,
  EvidenceCommandFailed,
  GitPort,
  type TagRefusal,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as Match from 'effect/Match'
import { pathsTouched } from './change-verdict.js'
import { deletedAt, gitLines, MANIFEST_GLOB, membersAt } from './evidence-io.js'
import { collectTurboEvidence } from './turbo-evidence.js'
import { turboPin } from './turbo-pin.js'

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

const evidencePort = (git: GitPort): ChangeEvidencePort => ({
  pathsEvidence: (root, ref) =>
    Effect.gen(function*() {
      const head = yield* git.currentBranch().pipe(Effect.mapError(branchFault))
      const changed = yield* git.changedPaths(ref, head)
      const members = yield* membersAt(root, yield* gitLines(root, MANIFEST_GLOB))
      const [mergeBase = ref] = yield* gitLines(root, ['merge-base', ref, head])
      const evidence: ChangeEvidence = {
        members: [...members],
        deleted: [...(yield* deletedAt(root, mergeBase, changed))],
        touched: pathsTouched(members, changed),
        raw: { strategy: 'paths', base: ref, changedPaths: [...changed] },
      }
      return evidence
    }).pipe(Effect.provide(NodeServices.layer)),

  turboEvidence: (root, ref, task) =>
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
      return yield* collectTurboEvidence(root, baseSha, task, pinned, changed)
    }).pipe(Effect.provide(NodeServices.layer)),
})

export const ChangeEvidenceLive: Layer.Layer<ChangeEvidencePort, never, GitPort> = Layer.effect(
  ChangeEvidencePort,
  Effect.map(GitPort, evidencePort),
)
