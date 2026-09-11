import * as Lang from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as S from 'effect/Schema'

export interface FakeMemberSeed {
  readonly name: string
  readonly dir: string
  readonly version: string
  readonly provenance?: boolean
  readonly build?: boolean
}

export interface FakeWorkspaceSeed {
  readonly root?: string
  readonly members?: ReadonlyArray<FakeMemberSeed>
  readonly files?: Record<string, string>
  readonly unreadableManifests?: ReadonlyArray<string>
  readonly unreadableFiles?: ReadonlyArray<string>
}

export interface FakeWorkspace {
  readonly layer: Layer.Layer<Lang.WorkspaceStore>
}

const manifestOf = (member: FakeMemberSeed): Lang.PackageManifest => {
  let publishConfig: Lang.PackageManifest['publishConfig'] = undefined
  if (member.provenance !== undefined) {
    publishConfig = { provenance: member.provenance }
  }
  let scripts: Lang.PackageManifest['scripts'] = undefined
  if (member.build === true) {
    scripts = { build: S.decodeSync(Lang.ScriptCommand)('run build') }
  }
  return {
    name: S.decodeSync(Lang.PackageName)(member.name),
    version: S.decodeSync(Lang.PackageVersion)(member.version),
    publishConfig,
    scripts,
  }
}

export const makeFakeWorkspace = (seed: FakeWorkspaceSeed = {}): FakeWorkspace => {
  const root = S.decodeSync(Lang.RepoRoot)(seed.root ?? '/repo')
  const members = seed.members ?? []
  const files = seed.files ?? {}
  const badManifests: Record<string, true> = Object.fromEntries(
    (seed.unreadableManifests ?? []).map((dir): [string, true] => [dir, true]),
  )
  const badFiles: Record<string, true> = Object.fromEntries(
    (seed.unreadableFiles ?? []).map((path): [string, true] => [path, true]),
  )

  const missingOf = (path: string): Lang.ManifestUnreadable =>
    S.decodeSync(Lang.ManifestUnreadable)({
      _tag: 'ManifestUnreadable',
      path: S.decodeSync(Lang.FsPath)(path),
    })

  const layer = Layer.succeed(Lang.WorkspaceStore, {
    root,
    listMembers: () =>
      Effect.succeed(
        members.map((member) => ({
          name: S.decodeSync(Lang.PackageName)(member.name),
          dir: S.decodeSync(Lang.RelativePath)(member.dir),
          manifest: manifestOf(member),
          publishable: true,
        })),
      ),
    readManifest: (dir) => {
      const member = members.find((entry) => entry.dir === dir)
      if (member === undefined || dir in badManifests) {
        return Effect.fail(missingOf(`${dir}/package.json`))
      }
      return Effect.succeed(manifestOf(member))
    },
    readFileFromRoot: (path) => {
      if (!(path in files) || path in badFiles) {
        return Effect.fail(missingOf(path))
      }
      const text = files[path] ?? ''
      return Effect.succeed({ path, text })
    },
  })
  return { layer }
}
