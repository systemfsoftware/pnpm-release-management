import * as Lang from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'

export interface FakeProcess {
  readonly layer: Layer.Layer<Lang.ProcessPort>
  readonly calls: Array<Lang.WorkspaceCommand>
}

export const makeFakeProcess = (
  failWith?: (command: Lang.WorkspaceCommand) => Lang.PublishRefusal | null,
): FakeProcess => {
  const calls: Array<Lang.WorkspaceCommand> = []
  const layer = Layer.succeed(Lang.ProcessPort, {
    runCommand: (command) => {
      calls.push(command)
      const refusal = failWith?.(command) ?? null
      if (refusal === null) {
        return Effect.succeed({ _tag: 'ProcessCompleted', command })
      }
      return Effect.fail(refusal)
    },
  })
  return { layer, calls }
}
