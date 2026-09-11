import { Reporter } from '@systemfsoftware/cli-adapter'
import { FsPath } from '@systemfsoftware/release-language'
import { Effect, FileSystem } from 'effect'
import * as Match from 'effect/Match'
import { Append, Contents, Err, Line, Out } from './Lines.schema.js'
import { type BoundaryRefusal, OutputUnreadable, OutputUnwritable } from './Refusal.schema.js'

export const out = (text: string): Line => Out.make({ text })

export const err = (text: string): Line => Err.make({ text })

export const contents = (path: string): Line => Contents.make({ path })

export const append = (path: string, text: string): Line => Append.make({ path, text })

export const tell = (
  lines: ReadonlyArray<Line>,
): Effect.Effect<void, BoundaryRefusal, Reporter | FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    const fs = yield* FileSystem.FileSystem
    yield* Effect.forEach(
      lines,
      (line) =>
        Match.value(line).pipe(
          Match.tag('Out', (item) => reporter.emit(item.text)),
          Match.tag('Err', (item) => reporter.note(item.text)),
          Match.tag('Contents', (item) =>
            fs.readFileString(item.path).pipe(
              Effect.flatMap((text) => reporter.emit(text.trimEnd())),
              Effect.mapError((cause) =>
                OutputUnreadable.make({ path: FsPath.make(item.path), reason: cause.message })
              ),
            )),
          Match.tag('Append', (item) =>
            fs.writeFileString(item.path, `${item.text}\n`, { flag: 'a' }).pipe(
              Effect.mapError((cause) =>
                OutputUnwritable.make({ path: FsPath.make(item.path), reason: cause.message })
              ),
            )),
          Match.exhaustive,
        ),
      { discard: true },
    )
  })

export const refuse = (text: string): Effect.Effect<void, never, Reporter> =>
  Effect.flatMap(Reporter, (reporter) => Effect.andThen(reporter.annotateError(text), () => reporter.exitCode(1)))
