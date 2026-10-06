import { NodeFileSystem } from '@effect/platform-node'
import { Effect, FileSystem } from 'effect'
import { type CommandRecord, IMAGE, startWorld, type World } from './harness.js'

export interface PhaseResult {
  name: string
  status: 'passed' | 'failed' | 'skipped'
  durationMs: number
  error?: string
}

export interface SessionOptions {
  repoRoot: string
  artifacts: string
  filter?: string | undefined
  keep: boolean
}

const firstLine = (value: string): string => value.split('\n').find((line) => line.trim().length > 0) ?? ''

const drawable = (command: string): string => {
  const line = firstLine(command)
  const script = /'([^']*\/tools\/[^']*\.ts)'/.exec(line)
  if (script !== null) {
    const captured = script[1] ?? script[0]
    const segments = captured.split('/')
    const last = segments[segments.length - 1] ?? captured
    return line.replace(script[0], last)
  }
  if (line.length > 100) return `${line.slice(0, 97)}...`
  return line
}

const rule = (label: string): string => {
  const head = `── ${label} `
  return head + '─'.repeat(Math.max(0, 72 - head.length))
}

class Writer {
  private transcript = ''
  private commands: string[] = []

  say(text: string): void {
    this.transcript += `${text}\n`
  }

  command(record: CommandRecord): void {
    let mark = '✗'
    if (record.code === 0) mark = '→'
    const lines = [
      `${mark} ${drawable(record.command)}  exit ${record.code}  ${record.durationMs}ms  cwd ${record.cwd}`,
    ]
    if (record.stdout.trim().length > 0) {
      lines.push(...record.stdout.trimEnd().split('\n').map((line) => `    | ${line}`))
    }
    if (record.stderr.trim().length > 0) {
      lines.push(...record.stderr.trimEnd().split('\n').map((line) => `    ! ${line}`))
    }
    this.say(lines.join('\n'))
    this.commands.push(`${JSON.stringify(record)}\n`)
  }

  writeAll(artifacts: string, extra: ReadonlyArray<readonly [string, string]>): Promise<void> {
    const files: Array<[string, string]> = [
      [`${artifacts}/transcript.log`, this.transcript],
      [`${artifacts}/commands.jsonl`, this.commands.join('')],
    ]
    for (const [name, content] of extra) files.push([name, content])
    const program = Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      yield* fs.makeDirectory(artifacts, { recursive: true })
      for (const [name, content] of files) yield* fs.writeFileString(name, content)
    })
    return Effect.runPromise(Effect.provide(program, NodeFileSystem.layer))
  }
}

export class Session {
  private readonly results: PhaseResult[] = []
  private failure: PhaseResult | null = null
  private closed = false

  private constructor(
    private readonly options: SessionOptions,
    public readonly world: World,
    private readonly writer: Writer,
  ) {}

  static async open(options: SessionOptions): Promise<Session> {
    const writer = new Writer()
    const world = await startWorld(options.repoRoot, { command: (record) => writer.command(record) })
    const session = new Session(options, world, writer)
    world.currentPhase = 'startup'
    const header = [
      `container ${world.containerId} up (image ${IMAGE})`,
      `transcript: ${options.artifacts}/transcript.log`,
    ]
    if (options.filter !== undefined) {
      header.push(`filter: only phases containing "${options.filter}" run, the rest are skipped`)
    }
    writer.say(header.join('\n'))
    return session
  }

  async phase(name: string, body: (world: World) => Promise<void>): Promise<void> {
    if (this.failure !== null) {
      this.results.push({ name, status: 'skipped', durationMs: 0 })
      return
    }

    if (this.options.filter !== undefined && !name.includes(this.options.filter)) {
      this.results.push({ name, status: 'skipped', durationMs: 0 })
      this.writer.say(`   – skipped ${name}`)
      return
    }

    this.world.currentPhase = name
    this.writer.say(`\n${rule(name)}`)
    const started = performance.now()

    try {
      await body(this.world)
      const durationMs = Math.round(performance.now() - started)
      this.results.push({ name, status: 'passed', durationMs })
      this.writer.say(`   ✓ ${durationMs}ms`)
    } catch (error) {
      const durationMs = Math.round(performance.now() - started)
      let message = 'unknown error'
      if (error instanceof Error) message = error.message
      const failure: PhaseResult = { name, status: 'failed', durationMs, error: message }
      this.results.push(failure)
      this.failure = failure
      this.writer.say(`   ✗ ${durationMs}ms — ${firstLine(message)}`)
      throw error
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true

    const failed = this.failure !== null
    const keep = this.options.keep || (failed && process.env['CI'] === undefined)

    const extra: Array<[string, string]> = []
    if (keep) {
      this.world.keepAlive()
      try {
        const snapshot = await this.world.snapshot()
        extra.push([`${this.options.artifacts}/state.json`, `${JSON.stringify(snapshot, null, 2)}\n`])
        extra.push([`${this.options.artifacts}/fixture.tar.gz.b64`, `${await this.world.archive()}\n`])
      } catch (error) {
        if (error instanceof Error) this.writer.say(`state capture failed: ${error.message}`)
        else this.writer.say('state capture failed: unknown error')
      }
    }

    let failedName: string | null = null
    if (this.failure !== null) failedName = this.failure.name
    extra.push([
      `${this.options.artifacts}/summary.json`,
      `${
        JSON.stringify(
          { image: IMAGE, container: this.world.containerId, kept: keep, phases: this.results, failed: failedName },
          null,
          2,
        )
      }\n`,
    ])
    await this.writer.writeAll(this.options.artifacts, extra)

    const passed = this.results.filter((result) => result.status === 'passed').length
    const skipped = this.results.filter((result) => result.status === 'skipped').length

    let title = 'passed'
    if (failed) title = `failed: ${this.failure?.name ?? 'unknown phase'}`
    const lines = ['', rule(title)]
    for (const result of this.results) {
      if (result.status === 'passed') lines.push(`   ✓ ${result.name} (${result.durationMs}ms)`)
      else if (result.status === 'skipped') lines.push(`   – ${result.name} (${result.durationMs}ms)`)
      else lines.push(`   ✗ ${result.name} (${result.durationMs}ms)`)
    }
    lines.push(
      `   ${passed} passed, ${this.results.length - passed - skipped} failed, ${skipped} skipped`,
      '',
      `artifacts: ${this.options.artifacts}`,
      '  transcript.log   every command with its exit code, output and stream position',
      '  commands.jsonl   the same, machine readable',
      '  summary.json     phases, statuses and timings',
    )
    if (keep) {
      lines.push(
        '  state.json       git log, versions, changesets, registry and emulated GitHub at the end',
        '  fixture.tar.gz.b64  the fixture that produced this result',
      )
    }
    lines.push('')
    let containerLine = `container: ${this.world.containerId}`
    if (keep) containerLine += ' (kept alive)'
    lines.push(containerLine)
    if (keep) {
      lines.push(`  reattach: docker exec -it ${this.world.containerId} sh  (this host routes docker to podman)`)
    }
    lines.push(
      `  one phase: E2E_FILTER='${failedName ?? '<substring>'}' pnpm --filter @systemfsoftware/e2e test`,
      '  keep a passing world: E2E_KEEP=1 pnpm --filter @systemfsoftware/e2e test',
    )
    this.writer.say(lines.join('\n'))

    this.writer.say('   (end of transcript)')
    await this.world.stop()
  }

  get failed(): boolean {
    return this.failure !== null
  }
}
