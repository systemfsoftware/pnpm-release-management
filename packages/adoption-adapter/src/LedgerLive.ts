import { NodeServices } from '@effect/platform-node'
import {
  FsPath,
  GitRef,
  LedgerMalformed,
  LedgerPort,
  LedgerUnreadable,
  LedgerUnwritable,
  type RelativePath,
  type ReleaseLedger,
  ReleaseLedger as ReleaseLedgerSchema,
  type ReleaseLedgerEntry,
  type RepoRoot,
} from '@systemfsoftware/release-language'
import { Effect, Layer, Option } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import * as Match from 'effect/Match'
import { Path } from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

const decodeLedger = (
  path: FsPath,
  text: string,
): Effect.Effect<ReleaseLedger, LedgerMalformed> =>
  Effect.fromResult(
    Result.mapError(
      S.decodeUnknownResult(S.fromJsonString(ReleaseLedgerSchema))(text),
      (error) => LedgerMalformed.make({ path, reason: error.message }),
    ),
  )

const compareTags = (left: ReleaseLedgerEntry, right: ReleaseLedgerEntry): number => {
  if (left.tag < right.tag) return -1
  if (left.tag > right.tag) return 1
  return 0
}

const comparePaths = (left: string, right: string): number => {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

const ordered = (files: Readonly<Record<string, string>>): Readonly<Record<string, string>> =>
  Object.fromEntries(Object.entries(files).sort(([left], [right]) => comparePaths(left, right)))

const canonicalEntry = (entry: ReleaseLedgerEntry): unknown =>
  Match.value(entry).pipe(
    Match.tag('published', (published) => ({
      _tag: 'published',
      tag: published.tag,
      commit: published.commit,
      package: published.package,
      version: published.version,
      integrity: published.integrity,
      sha256: published.sha256,
      files: ordered(published.files),
    })),
    Match.tag('unpublished', (unpublished) => ({
      _tag: 'unpublished',
      tag: unpublished.tag,
      commit: unpublished.commit,
      package: unpublished.package,
      version: unpublished.version,
      url: unpublished.url,
      status: unpublished.status,
      fetchedAt: unpublished.fetchedAt,
    })),
    Match.tag('mismatched', (mismatched) => ({
      _tag: 'mismatched',
      tag: mismatched.tag,
      commit: mismatched.commit,
      package: mismatched.package,
      claimedVersion: mismatched.claimedVersion,
      manifestVersion: mismatched.manifestVersion,
      claimed: mismatched.claimed,
      manifest: mismatched.manifest,
    })),
    Match.exhaustive,
  )

const canonical = (ledger: ReleaseLedger): string => {
  const entries = [...ledger.entries].sort(compareTags).map(canonicalEntry)
  return `${JSON.stringify({ entries }, null, 2)}\n`
}

export const LedgerLive = (root: RepoRoot): Layer.Layer<LedgerPort> =>
  Layer.effect(
    LedgerPort,
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const full = (rel: RelativePath): string => path.join(root, rel)

      const show = (ref: GitRef, rel: RelativePath): Effect.Effect<Result.Result<string, string>> =>
        Effect.scoped(Effect.gen(function*() {
          const handle = yield* spawner.spawn(
            ChildProcess.make('git', ['show', `${ref}:${rel}`], { cwd: root }),
          )
          const [stdout, stderr] = yield* Effect.all(
            [
              Stream.mkString(Stream.decodeText(handle.stdout)),
              Stream.mkString(Stream.decodeText(handle.stderr)),
            ],
            { concurrency: 'unbounded' },
          )
          const exitCode = yield* handle.exitCode
          if (exitCode === 0) {
            return Result.succeed(stdout)
          }
          return Result.fail(stderr)
        })).pipe(Effect.orElseSucceed(() => Result.fail('')))

      return {
        read: (rel: RelativePath) =>
          Effect.gen(function*() {
            const target = full(rel)
            const present = yield* fs.exists(target).pipe(Effect.orElseSucceed(() => false))
            if (!present) {
              return Option.none<ReleaseLedger>()
            }
            const text = yield* fs.readFileString(target).pipe(
              Effect.mapError((cause) => LedgerUnreadable.make({ path: FsPath.make(target), reason: cause.message })),
            )
            return Option.some(yield* decodeLedger(FsPath.make(target), text))
          }),
        readAt: (ref: GitRef, rel: RelativePath) =>
          Effect.gen(function*() {
            const shown = yield* show(ref, rel)
            if (Result.isFailure(shown)) {
              return Option.none<ReleaseLedger>()
            }
            return Option.some(yield* decodeLedger(FsPath.make(`${ref}:${rel}`), shown.success))
          }),
        write: (rel: RelativePath, ledger: ReleaseLedger) =>
          Effect.gen(function*() {
            const target = full(rel)
            yield* fs.writeFileString(target, canonical(ledger)).pipe(
              Effect.mapError((cause) => LedgerUnwritable.make({ path: FsPath.make(target), reason: cause.message })),
            )
          }),
      }
    }),
  ).pipe(Layer.provide(NodeServices.layer))
