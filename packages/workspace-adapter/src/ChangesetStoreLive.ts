import { join } from '@std/path'
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
    entries[match[1] ?? ''] = match[2] ?? ''
  }
  return seen ? entries : undefined
}

export const ChangesetStoreLive = (options: {
  readonly root: RepoRoot
  readonly changesetDir: RelativePath
}): Layer.Layer<ChangesetStore> => {
  const { root, changesetDir } = options

  const listIntents = (): Effect.Effect<ReadonlyArray<RelativePath>, IntentRefusal> =>
    Effect.gen(function*() {
      const names = yield* Effect.tryPromise({
        try: async () => {
          const found: Array<string> = []
          for await (const entry of Deno.readDir(join(root, changesetDir))) {
            if (entry.isFile && entry.name.endsWith(INTENT_GLOB) && entry.name !== README_FILE) {
              found.push(entry.name)
            }
          }
          return found
        },
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) => error instanceof Deno.errors.NotFound ? Effect.succeed([]) : Effect.die(error)),
      )
      const paths: Array<RelativePath> = []
      for (const name of [...names].sort()) {
        paths.push(yield* S.decodeUnknownEffect(RelativePath)(`${changesetDir}/${name}`).pipe(Effect.orDie))
      }
      return paths
    })

  const readIntent = (path: RelativePath): Effect.Effect<Intent, IntentRefusal> =>
    Effect.gen(function*() {
      const text = yield* Effect.tryPromise({
        try: () => Deno.readTextFile(join(root, path)),
        catch: (): IntentRefusal => ({ _tag: 'IntentFrontmatterMalformed', path }),
      })
      const split = splitIntent(text)
      if (split === undefined) {
        return yield* Effect.fail({ _tag: 'IntentFrontmatterMalformed', path } as const)
      }
      const raw = parseFrontmatter(split.frontmatter)
      if (raw === undefined) {
        return yield* Effect.fail({ _tag: 'IntentFrontmatterMalformed', path } as const)
      }
      const frontmatter = yield* S.decodeUnknownEffect(IntentFrontmatter)(raw).pipe(
        Effect.mapError((): IntentRefusal => ({ _tag: 'IntentFrontmatterMalformed', path })),
      )
      const summary = yield* S.decodeUnknownEffect(IntentSummary)(
        split.body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0).join(' '),
      ).pipe(
        Effect.mapError((): IntentRefusal => ({ _tag: 'IntentFrontmatterMalformed', path })),
      )
      const packages: Array<{ readonly name: PackageName; readonly bump: Bump }> = []
      for (const [rawName, bump] of Object.entries(frontmatter)) {
        const name = yield* S.decodeUnknownEffect(PackageName)(rawName).pipe(
          Effect.mapError((): IntentRefusal => ({ _tag: 'IntentFrontmatterMalformed', path })),
        )
        packages.push({ name, bump })
      }
      return { path, packages, summary }
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
      const slug = request.slug ??
        (yield* S.decodeUnknownEffect(IntentSlug)(derived || 'changeset').pipe(Effect.orDie))
      const rel = yield* S.decodeUnknownEffect(RelativePath)(
        `${changesetDir}/${slug}-${Date.now().toString(36)}.md`,
      ).pipe(Effect.orDie)
      const full = join(root, rel)
      const taken = yield* Effect.tryPromise({
        try: async () => {
          await Deno.stat(full)
          return true
        },
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) => error instanceof Deno.errors.NotFound ? Effect.succeed(false) : Effect.die(error)),
      )
      if (taken) {
        return yield* Effect.fail({ _tag: 'IntentSlugTaken', slug } as const)
      }
      const frontmatter = request.packages.map((name) => `"${name}": ${request.bump}`).join('\n')
      yield* Effect.tryPromise({
        try: () => Deno.writeTextFile(full, `---\n${frontmatter}\n---\n\n${request.summary}\n`),
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          error instanceof Deno.errors.AlreadyExists
            ? Effect.fail({ _tag: 'IntentSlugTaken', slug } as const)
            : Effect.die(error)
        ),
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
      for (const path of paths) {
        const removed = yield* Effect.tryPromise({
          try: async () => {
            await Deno.remove(join(root, path))
            return true
          },
          catch: (error) => error,
        }).pipe(
          Effect.catch((error) => error instanceof Deno.errors.NotFound ? Effect.succeed(false) : Effect.die(error)),
        )
        if (removed) deleted += 1
      }
      return yield* S.decodeUnknownEffect(Count)(deleted).pipe(Effect.orDie)
    })

  const readReadme = (): Effect.Effect<RootFile, IntentRefusal> =>
    Effect.gen(function*() {
      const rel = yield* S.decodeUnknownEffect(RelativePath)(`${changesetDir}/${README_FILE}`).pipe(Effect.orDie)
      const text = yield* Effect.tryPromise({
        try: () => Deno.readTextFile(join(root, rel)),
        catch: (): IntentRefusal => ({ _tag: 'IntentFrontmatterMalformed', path: rel }),
      })
      return { path: rel, text }
    })

  return Layer.succeed(ChangesetStore)({ listIntents, readIntent, writeIntent, deleteIntents, readReadme })
}
