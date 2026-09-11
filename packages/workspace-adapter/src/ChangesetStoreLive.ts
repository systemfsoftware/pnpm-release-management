import {
  type Bump,
  ChangesetStore,
  Count,
  type Intent,
  IntentFrontmatter,
  type IntentRefusal,
  IntentSlug,
  IntentStagedDerived,
  IntentStagedNamed,
  IntentSummary,
  type NewIntentDecision,
  type NewIntentRefusal,
  type NewIntentRequest,
  PackageName,
  RelativePath,
  type RepoRoot,
  type RootFile,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import { currentTimeMillis } from 'effect/Clock'
import { FileSystem } from 'effect/FileSystem'
import * as Match from 'effect/Match'
import { Path } from 'effect/Path'
import * as S from 'effect/Schema'

const FRONTMATTER_FENCE = /^---\s*$/
const FRONTMATTER_ENTRY = /^\s*["']?([^"'\s:]+)["']?\s*:\s*([^\s]+)\s*$/
const INTENT_GLOB = '.md'
const README_FILE = 'README.md'

const splitIntent = (text: string): { readonly frontmatter: string; readonly body: string } | undefined => {
  const lines = text.split('\n')
  const first: string = lines[0] ?? ''
  if (!FRONTMATTER_FENCE.test(first)) return undefined
  const closing = lines.findIndex((line, index) => index > 0 && FRONTMATTER_FENCE.test(line))
  if (closing === -1) return undefined
  return { frontmatter: lines.slice(1, closing).join('\n'), body: lines.slice(closing + 1).join('\n') }
}

const parseFrontmatter = (frontmatter: string): Record<string, string> | undefined => {
  const entries: Record<string, string> = {}
  let seen = false
  for (const line of frontmatter.split('\n')) {
    if (line.trim() === '') continue
    const match = FRONTMATTER_ENTRY.exec(line)
    if (match === null) return undefined
    seen = true
    entries[match.at(1) ?? ''] = match.at(2) ?? ''
  }
  if (seen) {
    return entries
  }
  return undefined
}
export const ChangesetStoreLive = (options: {
  readonly root: RepoRoot
  readonly changesetDir: RelativePath
}): Layer.Layer<ChangesetStore, never, FileSystem | Path> =>
  Layer.effect(
    ChangesetStore,
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const { root, changesetDir } = options

      const listIntents = (): Effect.Effect<ReadonlyArray<RelativePath>, IntentRefusal> =>
        Effect.gen(function*() {
          const dir = path.join(root, changesetDir)
          const names = yield* fs.readDirectory(dir).pipe(
            Effect.catchTag('PlatformError', (error) =>
              Match.value(error.reason).pipe(
                Match.tag('NotFound', () => Effect.succeed(new Array<string>())),
                Match.orElse(() => Effect.die(error)),
              )),
          )
          const files: Array<string> = []
          for (const name of names) {
            if (!name.endsWith(INTENT_GLOB)) continue
            if (name === README_FILE) continue
            const info = yield* fs.stat(path.join(dir, name)).pipe(
              Effect.catchTag('PlatformError', (error) =>
                Match.value(error.reason).pipe(
                  Match.tag('NotFound', () => Effect.succeed(undefined)),
                  Match.orElse(() => Effect.die(error)),
                )),
            )
            if (info === undefined) continue
            if (info.type !== 'File') continue
            files.push(name)
          }
          const paths: Array<RelativePath> = []
          for (const name of [...files].sort()) {
            paths.push(yield* S.decodeUnknownEffect(RelativePath)(`${changesetDir}/${name}`).pipe(Effect.orDie))
          }
          return paths
        })

      const readIntent = (intentPath: RelativePath): Effect.Effect<Intent, IntentRefusal> =>
        Effect.gen(function*() {
          const text = yield* fs.readFileString(path.join(root, intentPath)).pipe(
            Effect.catchTag(
              'PlatformError',
              (): Effect.Effect<never, IntentRefusal> =>
                Effect.fail({ _tag: 'IntentFrontmatterMalformed', path: intentPath } as const),
            ),
          )
          const split = splitIntent(text)
          if (split === undefined) {
            return yield* Effect.fail({ _tag: 'IntentFrontmatterMalformed', path: intentPath } as const)
          }
          const raw = parseFrontmatter(split.frontmatter)
          if (raw === undefined) {
            return yield* Effect.fail({ _tag: 'IntentFrontmatterMalformed', path: intentPath } as const)
          }
          const frontmatter = yield* S.decodeUnknownEffect(IntentFrontmatter)(raw).pipe(
            Effect.mapError((): IntentRefusal => ({ _tag: 'IntentFrontmatterMalformed', path: intentPath })),
          )
          const summary = yield* S.decodeUnknownEffect(IntentSummary)(
            split.body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0).join(' '),
          ).pipe(
            Effect.mapError((): IntentRefusal => ({ _tag: 'IntentFrontmatterMalformed', path: intentPath })),
          )
          const packages: Array<{ readonly name: PackageName; readonly bump: Bump }> = []
          for (const [rawName, bump] of Object.entries(frontmatter)) {
            const name = yield* S.decodeUnknownEffect(PackageName)(rawName).pipe(
              Effect.mapError((): IntentRefusal => ({ _tag: 'IntentFrontmatterMalformed', path: intentPath })),
            )
            packages.push({ name, bump })
          }
          return { path: intentPath, packages, summary }
        })

      const writeIntent = (request: NewIntentRequest): Effect.Effect<NewIntentDecision, NewIntentRefusal> =>
        Effect.gen(function*() {
          if (request.packages.length === 0) {
            return yield* Effect.fail(
              { _tag: 'NewIntentPackagesEmpty', bump: request.bump, summary: request.summary } as const,
            )
          }
          const derived = request.packages.join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
            .slice(0, 48)
          const now = yield* currentTimeMillis
          const slug = request.slug ??
            (yield* S.decodeUnknownEffect(IntentSlug)(derived || 'changeset').pipe(Effect.orDie))
          const rel = yield* S.decodeUnknownEffect(RelativePath)(
            `${changesetDir}/${slug}-${now.toString(36)}.md`,
          ).pipe(Effect.orDie)
          const full = path.join(root, rel)
          const info = yield* fs.stat(full).pipe(
            Effect.catchTag('PlatformError', (error) =>
              Match.value(error.reason).pipe(
                Match.tag('NotFound', () => Effect.succeed(undefined)),
                Match.orElse(() => Effect.die(error)),
              )),
          )
          if (info !== undefined) {
            return yield* Effect.fail({ _tag: 'IntentSlugTaken', slug } as const)
          }
          const frontmatter = request.packages.map((name) => `"${name}": ${request.bump}`).join('\n')
          yield* fs.writeFileString(full, `---\n${frontmatter}\n---\n\n${request.summary}\n`).pipe(
            Effect.catchTag('PlatformError', (error) =>
              Match.value(error.reason).pipe(
                Match.tag('AlreadyExists', () => Effect.fail({ _tag: 'IntentSlugTaken', slug } as const)),
                Match.orElse(() => Effect.die(error)),
              )),
          )
          const packages = request.packages.map((name) => ({ name, bump: request.bump }))
          if (request.slug !== undefined) {
            return IntentStagedNamed.make({ path: rel, packages, bump: request.bump, summary: request.summary })
          }
          return IntentStagedDerived.make({ path: rel, packages, bump: request.bump, summary: request.summary })
        })

      const deleteIntents = (paths: ReadonlyArray<RelativePath>): Effect.Effect<Count, IntentRefusal> =>
        Effect.gen(function*() {
          let deleted = 0
          for (const intentPath of paths) {
            const removed = yield* fs.remove(path.join(root, intentPath)).pipe(
              Effect.as(true),
              Effect.catchTag('PlatformError', (error) =>
                Match.value(error.reason).pipe(
                  Match.tag('NotFound', () => Effect.succeed(false)),
                  Match.orElse(() => Effect.die(error)),
                )),
            )
            if (removed) deleted += 1
          }
          return yield* S.decodeUnknownEffect(Count)(deleted).pipe(Effect.orDie)
        })

      const readReadme = (): Effect.Effect<RootFile, IntentRefusal> =>
        Effect.gen(function*() {
          const rel = yield* S.decodeUnknownEffect(RelativePath)(`${changesetDir}/${README_FILE}`).pipe(Effect.orDie)
          const text = yield* fs.readFileString(path.join(root, rel)).pipe(
            Effect.catchTag(
              'PlatformError',
              (): Effect.Effect<never, IntentRefusal> =>
                Effect.fail({ _tag: 'IntentFrontmatterMalformed', path: rel } as const),
            ),
          )
          return { path: rel, text }
        })

      return { listIntents, readIntent, writeIntent, deleteIntents, readReadme }
    }),
  )
