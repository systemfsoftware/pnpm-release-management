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
import * as Option from 'effect/Option'
import { Path } from 'effect/Path'
import * as S from 'effect/Schema'
import { isRegularFile, readDirectoryEntries, readTextFile, removeFile, writeTextFile } from './StoreFile.js'

const FENCE = /^---\s*$/
const ENTRY = /^\s*["']?([^"'\s:]+)["']?\s*:\s*([^\s]+)\s*$/
const INTENT_SUFFIX = '.md'
const README_FILE = 'README.md'
const SLUG_LIMIT = 48

const splitDocument = (text: string): Option.Option<{ readonly frontmatter: string; readonly body: string }> => {
  const [first, ...rest] = text.split('\n')
  if (first === undefined || !FENCE.test(first)) return Option.none()
  const closing = rest.findIndex((line) => FENCE.test(line))
  if (closing === -1) return Option.none()
  return Option.some({
    frontmatter: rest.slice(0, closing).join('\n'),
    body: rest.slice(closing + 1).join('\n'),
  })
}

const parseFrontmatter = (frontmatter: string): Option.Option<Record<string, string>> => {
  const entries: Record<string, string> = {}
  let seen = false
  for (const line of frontmatter.split('\n')) {
    if (line.trim() === '') continue
    const match = ENTRY.exec(line)
    if (match === null) return Option.none()
    const name = match.at(1)
    const bump = match.at(2)
    if (name === undefined || bump === undefined) return Option.none()
    entries[name] = bump
    seen = true
  }
  if (!seen) return Option.none()
  return Option.some(entries)
}

const parseIntent = (file: RelativePath, text: string): Option.Option<Intent> => {
  const document = splitDocument(text)
  if (Option.isNone(document)) return Option.none()
  const raw = parseFrontmatter(document.value.frontmatter)
  if (Option.isNone(raw)) return Option.none()
  const frontmatter = S.decodeUnknownOption(IntentFrontmatter)(raw.value)
  if (Option.isNone(frontmatter)) return Option.none()
  const packages: Array<{ readonly name: PackageName; readonly bump: Bump }> = []
  for (const [given, bump] of Object.entries(frontmatter.value)) {
    const name = S.decodeUnknownOption(PackageName)(given)
    if (Option.isNone(name)) return Option.none()
    packages.push({ name: name.value, bump })
  }
  const body: Array<string> = []
  for (const line of document.value.body.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed !== '') body.push(trimmed)
  }
  const summary = S.decodeUnknownOption(IntentSummary)(body.join(' '))
  if (Option.isNone(summary)) return Option.none()
  return Option.some({ path: file, packages, summary: summary.value })
}

const derivedSlug = (packages: ReadonlyArray<PackageName>): IntentSlug => {
  const kebab = packages.join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const capped = kebab.slice(0, SLUG_LIMIT).replace(/-+$/, '')
  if (capped.length === 0) return IntentSlug.make('changeset')
  return IntentSlug.make(capped)
}

const intentDocument = (request: NewIntentRequest): string =>
  `---\n${request.packages.map((name) => `"${name}": ${request.bump}`).join('\n')}\n---\n\n${request.summary}\n`

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

      const unreadable = (file: RelativePath): IntentRefusal => ({ _tag: 'IntentFrontmatterMalformed', path: file })

      const listIntents = (): Effect.Effect<ReadonlyArray<RelativePath>, IntentRefusal> =>
        Effect.gen(function*() {
          const dir = path.join(root, changesetDir)
          const absent: ReadonlyArray<string> = []
          const names = yield* readDirectoryEntries(fs, dir).pipe(
            Effect.catchTag('Missing', () => Effect.succeed(absent)),
            Effect.mapError(() => unreadable(changesetDir)),
          )
          const intents: Array<RelativePath> = []
          for (const name of names) {
            if (!name.endsWith(INTENT_SUFFIX)) continue
            if (name === README_FILE) continue
            const file = yield* S.decodeUnknownEffect(RelativePath)(`${changesetDir}/${name}`).pipe(
              Effect.mapError(() => unreadable(changesetDir)),
            )
            const regular = yield* isRegularFile(fs, path.join(dir, name)).pipe(
              Effect.catchTag('Missing', () => Effect.succeed(false)),
              Effect.mapError(() => unreadable(file)),
            )
            if (regular) intents.push(file)
          }
          return intents.sort()
        })

      const readIntent = (intentPath: RelativePath): Effect.Effect<Intent, IntentRefusal> =>
        Effect.gen(function*() {
          const text = yield* readTextFile(fs, path.join(root, intentPath)).pipe(
            Effect.mapError(() => unreadable(intentPath)),
          )
          const parsed = parseIntent(intentPath, text)
          if (Option.isNone(parsed)) {
            return yield* Effect.fail(unreadable(intentPath))
          }
          return parsed.value
        })

      const writeIntent = (request: NewIntentRequest): Effect.Effect<NewIntentDecision, NewIntentRefusal> =>
        Effect.gen(function*() {
          const slug = request.slug ?? derivedSlug(request.packages)
          const now = yield* currentTimeMillis
          const file = RelativePath.make(`${changesetDir}/${slug}-${now.toString(36)}.md`)
          yield* writeTextFile(fs, path.join(root, file), intentDocument(request), 'exclusive').pipe(
            Effect.matchEffect({
              onFailure: (fault): Effect.Effect<void, NewIntentRefusal> =>
                Match.value(fault).pipe(
                  Match.tag('AlreadyExists', () => Effect.fail<NewIntentRefusal>({ _tag: 'IntentSlugTaken', slug })),
                  Match.orElse(() => Effect.die(new Error(`cannot stage intent ${file}: ${fault.reason}`))),
                ),
              onSuccess: () => Effect.void,
            }),
          )
          const packages = request.packages.map((name) => ({ name, bump: request.bump }))
          if (request.slug !== undefined) {
            return IntentStagedNamed.make({ path: file, packages, bump: request.bump, summary: request.summary })
          }
          return IntentStagedDerived.make({ path: file, packages, bump: request.bump, summary: request.summary })
        })

      const deleteIntents = (intents: ReadonlyArray<RelativePath>): Effect.Effect<Count, IntentRefusal> =>
        Effect.gen(function*() {
          let deleted = 0
          for (const intentPath of intents) {
            const full = path.join(root, intentPath)
            const removed = yield* removeFile(fs, full).pipe(
              Effect.mapError((fault) => new Error(`cannot delete ${full}: ${fault.reason}`)),
              Effect.orDie,
            )
            if (removed) deleted += 1
          }
          return Count.make(deleted)
        })

      const readReadme = (): Effect.Effect<RootFile, IntentRefusal> =>
        Effect.gen(function*() {
          const file = RelativePath.make(`${changesetDir}/${README_FILE}`)
          const text = yield* readTextFile(fs, path.join(root, file)).pipe(
            Effect.mapError(() => unreadable(file)),
          )
          return { path: file, text }
        })

      return { listIntents, readIntent, writeIntent, deleteIntents, readReadme }
    }),
  )
