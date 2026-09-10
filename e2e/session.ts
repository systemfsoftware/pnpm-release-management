import { basename, join } from '@std/path'
import { type CommandRecord, IMAGE, startWorld, type World } from './harness.ts'

export interface PhaseResult {
  name: string
  status: 'passed' | 'failed' | 'skipped'
  durationMs: number
  error?: string
}

export interface SessionOptions {
  repoRoot: string
  artifacts: string
  filter?: string
  keep: boolean
}

const firstLine = (value: string): string => value.split('\n').find((line) => line.trim().length > 0) ?? ''

const drawable = (command: string): string => {
  const line = firstLine(command)
  const script = /'([^']*\/tools\/[^']*\.ts)'/.exec(line)
  if (script !== null) return line.replace(script[0], basename(script[1]))
  return line.length > 100 ? `${line.slice(0, 97)}...` : line
}

const rule = (label: string): string => {
  const head = `── ${label} `
  return head + '─'.repeat(Math.max(0, 72 - head.length))
}

class Writer {
  private readonly encoder = new TextEncoder()

  constructor(
    private readonly transcript: Deno.FsFile,
    private readonly commands: Deno.FsFile,
  ) {}

  say(text: string): void {
    this.transcript.writeSync(this.encoder.encode(`${text}\n`))
  }

  command(record: CommandRecord): void {
    const head = `${record.code === 0 ? '→' : '✗'} ${drawable(record.command)}  exit ${record.code}  ` +
      `${record.durationMs}ms  cwd ${record.cwd}`
    const lines = [head]
    if (record.stdout.trim().length > 0) {
      lines.push(...record.stdout.trimEnd().split('\n').map((line) => `    | ${line}`))
    }
    if (record.stderr.trim().length > 0) {
      lines.push(...record.stderr.trimEnd().split('\n').map((line) => `    ! ${line}`))
    }
    this.say(lines.join('\n'))
    this.commands.writeSync(this.encoder.encode(`${JSON.stringify(record)}\n`))
  }

  close(): void {
    this.transcript.close()
    this.commands.close()
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
    const writer = new Writer(
      Deno.openSync(join(options.artifacts, 'transcript.log'), { create: true, append: true, write: true }),
      Deno.openSync(join(options.artifacts, 'commands.jsonl'), { create: true, append: true, write: true }),
    )
    const world = await startWorld(options.repoRoot, { command: (record) => writer.command(record) })
    const session = new Session(options, world, writer)
    world.currentPhase = 'startup'
    writer.say(
      [
        `container ${world.containerId} up (image ${IMAGE})`,
        `transcript: ${join(options.artifacts, 'transcript.log')}`,
        options.filter === undefined
          ? ''
          : `filter: only phases containing "${options.filter}" run, the rest are skipped`,
      ].filter((line) => line.length > 0).join('\n'),
    )
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
      const message = error instanceof Error ? error.message : String(error)
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
    const keep = this.options.keep || (failed && Deno.env.get('CI') === undefined)

    if (keep) {
      this.world.keepAlive()
      try {
        const snapshot = await this.world.snapshot()
        await Deno.writeTextFile(
          join(this.options.artifacts, 'state.json'),
          `${JSON.stringify(snapshot, null, 2)}\n`,
        )
        await Deno.writeTextFile(
          join(this.options.artifacts, 'fixture.tar.gz.b64'),
          `${await this.world.archive()}\n`,
        )
      } catch (error) {
        this.writer.say(`state capture failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    await Deno.writeTextFile(
      join(this.options.artifacts, 'summary.json'),
      `${
        JSON.stringify(
          {
            image: IMAGE,
            container: this.world.containerId,
            kept: keep,
            phases: this.results,
            failed: this.failure?.name ?? null,
          },
          null,
          2,
        )
      }\n`,
    )

    const passed = this.results.filter((result) => result.status === 'passed').length
    const skipped = this.results.filter((result) => result.status === 'skipped').length

    this.writer.say(
      [
        '',
        rule(failed ? `failed: ${this.failure?.name}` : 'passed'),
        ...this.results.map((result) =>
          `   ${result.status === 'passed' ? '✓' : result.status === 'skipped' ? '–' : '✗'} ` +
          `${result.name} (${result.durationMs}ms)`
        ),
        `   ${passed} passed, ${this.results.length - passed - skipped} failed, ${skipped} skipped`,
        '',
        `artifacts: ${this.options.artifacts}`,
        '  transcript.log   every command with its exit code, output and stream position',
        '  commands.jsonl   the same, machine readable',
        '  summary.json     phases, statuses and timings',
        ...(keep
          ? [
            '  state.json       git log, versions, changesets, registry and emulated GitHub at the end',
            '  fixture.tar.gz.b64  the fixture that produced this result',
          ]
          : []),
        '',
        `container: ${this.world.containerId}${keep ? ' (kept alive)' : ''}`,
        keep ? `  reattach: docker exec -it ${this.world.containerId} sh  (this host routes docker to podman)` : '',
        `  one phase: E2E_FILTER='${this.failure?.name ?? '<substring>'}' deno task e2e`,
        '  keep a passing world: E2E_KEEP=1 deno task e2e',
      ].filter((line) => line.length > 0).join('\n'),
    )

    this.writer.say('   (end of transcript)')
    this.writer.close()
    await this.world.stop()
  }

  get failed(): boolean {
    return this.failure !== null
  }
}
