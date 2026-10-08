import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect } from 'effect'
import * as S from 'effect/Schema'
import { expect } from 'vitest'
import { headSha, MEMBERS, packTarballs, setupFixture } from '../fixture.js'
import {
  CI_WORKFLOW,
  FIXTURE,
  GH_DISPATCHES,
  parseJson,
  REGISTRY,
  REGISTRY_LOG,
  REGISTRY_STORAGE,
  WORKSPACE_TARBALLS,
  type World,
} from '../harness.js'
import { Session } from '../session.js'
import { CapturedEntry, Manifest, Pulls, Release, Releases } from './__fixtures__/pipeline.schema.js'

const Feature = makeFeature({ it, layer })

const repoRoot = decodeURIComponent(new URL('../..', import.meta.url).pathname)
const artifacts = `${repoRoot}e2e/.artifacts/${new Date().toISOString().replace(/[:.]/g, '-')}`

const CARGO_MANIFEST = `[workspace]
members = ["crates/*"]

[workspace.package]
version = "1.1.0"
edition = "2021"
`

const CARGO_MEMBER = `[package]
name = "core"
version.workspace = true
edition = "2021"
`

const CARGO_RELEASE_JSONC = `{
  "base": "main",
  "branch": "changeset-release/main",
  "changesetDir": ".changeset",
  "changelogDir": ".changeset/changelogs",
  "versioning": {
    "strategy": "surfaces",
    "manifest": "package.json",
    "changelog": "CHANGELOG.md",
    "surfaces": [
      { "kind": "json", "path": "packages/alpha/package.json" },
      { "kind": "json", "path": "packages/beta/package.json" },
      { "kind": "cargo", "path": "Cargo.toml", "package": "@e2e/alpha" }
    ]
  },
  "gate": { "strategy": "paths" },
  "pr": {
    "title": "chore(release): version packages",
    "body": "Consumes the pending .changeset intents."
  }
}
`

const CHANGESETS_RELEASE_JSONC = `{
  "base": "main",
  "branch": "changeset-release/main",
  "changesetDir": ".changeset",
  "changelogDir": ".changeset/changelogs",
  "versioning": { "strategy": "changesets" },
  "gate": { "strategy": "paths" }
}
`

const readVersion = async (world: World, name: string): Promise<string> => {
  const raw = await world.read(`${FIXTURE}/packages/${name}/package.json`)
  return S.decodeUnknownSync(Manifest)(parseJson(raw)).version
}

const nextMinor = (version: string): string => {
  const [major, minor] = version.split('.').map(Number)
  return `${major}.${(minor ?? 0) + 1}.0`
}

const nextPatch = (version: string): string => {
  const [major, minor, patch] = version.split('.').map(Number)
  return `${major}.${minor}.${(patch ?? 0) + 1}`
}

const capturedTags = (text: string): ReadonlyArray<string> => {
  const entries = S.decodeUnknownSync(S.Array(CapturedEntry))(parseJson(text))
  return entries.map((entry) => entry.tag)
}

const fetchRelease = (world: World, tag: string) => {
  const path = `/repos/admin/fixture/releases/tags/${encodeURIComponent(tag)}`
  return world.github(path, S.decodeUnknownSync(Release))
}

const fetchReleases = (world: World) => {
  return world.github('/repos/admin/fixture/releases?per_page=100', S.decodeUnknownSync(Releases))
}

const fetchOpenPulls = (world: World) => {
  return world.github('/repos/admin/fixture/pulls?state=open', S.decodeUnknownSync(Pulls))
}

const registryPings = (log: string): number =>
  log.split('\n').filter((line) => line.includes("req: 'GET /-/ping'")).length

const registryPublishes = (log: string): ReadonlyArray<string> =>
  log.split('\n').filter((line) => line.includes("req: 'PUT "))

const runPhases = async (session: Session): Promise<void> => {
  let base = ''
  let release111 = ''
  let release120 = ''
  let releasedAlpha = ''
  let releasedBeta = ''

  await session.phase('fixture is a two package pnpm workspace with tags for 1.0.0', async (world) => {
    await setupFixture(world)
    base = await headSha(world)
  })

  await session.phase('gate refuses a publishable change with no intent', async (world) => {
    await world.write(`${FIXTURE}/packages/alpha/index.js`, 'export const alpha = 2\n')
    await world.must('git add -A && git commit -q -m "feat: alpha grows"', { cwd: FIXTURE })

    const blocked = await world.tool('changeset-management', 'check', base)
    expect(blocked.code).toBe(1)
    expect(`${blocked.stdout}${blocked.stderr}`).toContain('@e2e/alpha')
  })

  await session.phase('gate passes once an intent names the package', async (world) => {
    const created = await world.tool(
      'changeset-management',
      'new',
      '@e2e/alpha --bump minor --summary "alpha grows a public export" --slug alpha-grows',
    )
    expect(created.code).toBe(0)
    await world.must('git add -A && git commit -q -m "chore: changeset"', { cwd: FIXTURE })

    const passed = await world.tool('changeset-management', 'check', base)
    expect(passed.code).toBe(0)
    expect(`${passed.stdout}${passed.stderr}`).toContain('@e2e/alpha')
  })

  await session.phase('plan asks for a version step', async (world) => {
    const tarballs = await packTarballs(world)
    const planned = await world.tool('github-release-management', 'plan', `--tarballs ${tarballs}`)
    const output = `${planned.stdout}${planned.stderr}`
    expect(planned.code).toBe(0)
    expect(output).toContain('pending_intents=1')
    expect(output).toContain('this_cycle=0')
    expect(output).toContain('phase=version')
  })

  await session.phase('version step bumps surfaces, writes changelogs, consumes intents', async (world) => {
    const versioned = await world.tool('version-management', 'bump')
    expect(versioned.code).toBe(0)

    expect(await readVersion(world, 'alpha')).toBe('1.1.0')
    expect(await readVersion(world, 'beta')).toBe('1.1.0')

    const rootManifest = await world.read(`${FIXTURE}/package.json`)
    expect(rootManifest).toContain('"version": "1.1.0"')

    const alphaChangelog = await world.read(`${FIXTURE}/.changeset/changelogs/@e2e!alpha@1.1.0.md`)
    expect(alphaChangelog).toContain('alpha grows a public export')

    const betaChangelog = await world.read(`${FIXTURE}/.changeset/changelogs/@e2e!beta@1.1.0.md`)
    expect(betaChangelog.trim().split('\n').length).toBeGreaterThan(1)

    expect(await world.read(`${FIXTURE}/CHANGELOG.md`)).toContain('## 1.1.0')

    const leftover = (await world.must('ls .changeset', { cwd: FIXTURE })).stdout
    expect(leftover.trim().split('\n').sort().join(',')).toBe('README.md,changelogs')

    await world.must('git add -A && git commit -q -m "chore(release): version packages"', {
      cwd: FIXTURE,
    })
  })

  await session.phase('plan asks for a release step', async (world) => {
    const tarballs = await packTarballs(world)
    const planned = await world.tool('github-release-management', 'plan', `--tarballs ${tarballs}`)
    const output = `${planned.stdout}${planned.stderr}`
    expect(planned.code).toBe(0)
    expect(output).toContain('pending_intents=0')
    expect(output).toContain(`this_cycle=${MEMBERS.length}`)
    expect(output).toContain('phase=release')
  })

  await session.phase('captured set is written for the later steps', async (world) => {
    const tarballs = await packTarballs(world)
    const captured = await world.tool(
      'github-release-management',
      'tag',
      `--tarballs ${tarballs} --output /tmp/captured.json`,
    )
    const output = `${captured.stdout}${captured.stderr}`
    expect(captured.code).toBe(0)
    expect(output).toContain(`wrote ${MEMBERS.length} captured package(s)`)

    const tags = (await world.must('git ls-remote --tags origin', { cwd: FIXTURE })).stdout
    expect(tags.includes('@v1.1.0')).toBe(false)

    const written = capturedTags(await world.read('/tmp/captured.json'))
    expect(written).toEqual(MEMBERS.map((member) => `${member}@v1.1.0`))
  })

  await session.phase('GitHub releases carry the generated changelog', async (world) => {
    const created = await world.tool(
      'github-release-management',
      'release',
      '--captured /tmp/captured.json',
    )
    const output = `${created.stdout}${created.stderr}`
    expect(created.code).toBe(0)
    expect(output).toContain(`created ${MEMBERS.length} release(s)`)

    const release = await fetchRelease(world, '@e2e/alpha@v1.1.0')
    expect(release.status).toBe(200)
    expect(release.body?.body).toContain('alpha grows a public export')

    const all = await fetchReleases(world)
    expect(all.body?.length).toBe(MEMBERS.length)

    for (const member of MEMBERS) {
      const found = await fetchRelease(world, `${member}@v1.1.0`)
      expect(found.status).toBe(200)
    }
  })

  await session.phase('creating releases twice creates nothing', async (world) => {
    const again = await world.tool(
      'github-release-management',
      'release',
      '--captured /tmp/captured.json',
    )
    const output = `${again.stdout}${again.stderr}`
    expect(again.code).toBe(0)
    expect(output).toContain(`created 0 release(s), skipped ${MEMBERS.length}`)

    const all = await fetchReleases(world)
    expect(all.body?.length).toBe(MEMBERS.length)
  })

  await session.phase('tagging pushes one tag per captured package', async (world) => {
    const tarballs = await packTarballs(world)
    const tagged = await world.tool(
      'github-release-management',
      'tag',
      `--captured /tmp/captured.json --tarballs ${tarballs}`,
    )
    expect(tagged.code).toBe(0)

    const tags = (await world.must('git ls-remote --tags origin', { cwd: FIXTURE })).stdout
    for (const member of MEMBERS) expect(tags).toContain(`${member}@v1.1.0`)
  })

  await session.phase('plan is empty once tags exist', async (world) => {
    const tarballs = await packTarballs(world)
    const planned = await world.tool('github-release-management', 'plan', `--tarballs ${tarballs}`)
    const output = `${planned.stdout}${planned.stderr}`
    expect(planned.code).toBe(0)
    expect(output).toContain('this_cycle=0')
    expect(output).toContain('phase=none')
  })

  await session.phase(
    'version job runs its own revision of the tools over a caller lock pinned to an older one, opens the release PR and dispatches CI on its branch',
    async (world) => {
      const created = await world.tool(
        'changeset-management',
        'new',
        '@e2e/beta --bump patch --summary "beta stops dropping the last frame" --slug beta-fix',
      )
      expect(created.code).toBe(0)

      const steps = await world.job('version')
      expect(steps.filter((step) => step.code !== 0)).toEqual([])
      const opened = steps.find((step) => step.step === 'pr')
      expect(`${opened?.stdout}${opened?.stderr}`).toContain('created release PR #')
      expect(await world.read(GH_DISPATCHES)).toBe(`workflow run ${CI_WORKFLOW} --ref changeset-release/main\n`)

      const pulls = await fetchOpenPulls(world)
      expect(pulls.body?.length).toBe(1)
      expect(pulls.body?.[0]?.title).toBe('chore(release): version packages')
      expect(pulls.body?.[0]?.labels.map((label) => label.name)).toEqual(['release'])
    },
  )

  await session.phase('version job closes the release PR and dispatches nothing', async (world) => {
    const steps = await world.job('version')
    expect(steps.filter((step) => step.code !== 0)).toEqual([])
    const closed = steps.find((step) => step.step === 'pr')
    expect(`${closed?.stdout}${closed?.stderr}`).toContain('closed release PR #')
    expect(await world.read(GH_DISPATCHES)).toBe(`workflow run ${CI_WORKFLOW} --ref changeset-release/main\n`)

    const pulls = await fetchOpenPulls(world)
    expect(pulls.body?.length).toBe(0)
  })

  await session.phase('cargo surface keeps Cargo.lock in step with the bump', async (world) => {
    await world.write(`${FIXTURE}/Cargo.toml`, CARGO_MANIFEST)
    await world.write(`${FIXTURE}/crates/core/Cargo.toml`, CARGO_MEMBER)
    await world.write(`${FIXTURE}/crates/core/src/lib.rs`, '')
    await world.must('cargo generate-lockfile', { cwd: FIXTURE })
    await world.write(`${FIXTURE}/release.jsonc`, CARGO_RELEASE_JSONC)
    await world.must('git add -A && git commit -q -m "chore: cargo workspace"', { cwd: FIXTURE })

    const before = await readVersion(world, 'alpha')

    const created = await world.tool(
      'changeset-management',
      'new',
      '@e2e/alpha --bump patch --summary "alpha picks up the cargo surface" --slug alpha-cargo',
    )
    expect(created.code).toBe(0)

    const versioned = await world.tool('version-management', 'bump')
    expect(versioned.code).toBe(0)

    const bumped = await readVersion(world, 'alpha')
    expect(bumped).not.toBe(before)

    const cargoManifest = await world.read(`${FIXTURE}/Cargo.toml`)
    expect(cargoManifest).toContain(`version = "${bumped}"`)

    const memberManifest = await world.read(`${FIXTURE}/crates/core/Cargo.toml`)
    expect(memberManifest).toContain('version.workspace = true')

    const lock = await world.read(`${FIXTURE}/Cargo.lock`)
    expect(lock).toContain(`name = "core"\nversion = "${bumped}"`)

    const metadata = await world.must('cargo metadata --locked --offline --format-version 1', { cwd: FIXTURE })
    expect(metadata.code).toBe(0)
  })

  await session.phase('changesets versioning releases each package and settles', async (world) => {
    await world.must('git add -A && git commit -q -m "chore(release): version packages"', { cwd: FIXTURE })
    await world.must('git push -q origin HEAD:main', { cwd: FIXTURE })
    release111 = (await world.must('git rev-parse HEAD', { cwd: FIXTURE })).stdout.trim()
    releasedAlpha = await readVersion(world, 'alpha')
    releasedBeta = await readVersion(world, 'beta')

    const seeded111 = await packTarballs(world, '/tmp/prm-tarballs-111')
    const planning111 = await world.tool('github-release-management', 'plan', `--tarballs ${seeded111}`)
    expect(`${planning111.stdout}${planning111.stderr}`).toContain('phase=release')
    const captured111 = await world.tool(
      'github-release-management',
      'tag',
      `--tarballs ${seeded111} --output /tmp/captured-111.json`,
    )
    expect(captured111.code).toBe(0)
    expect(
      await world.tool(
        'github-release-management',
        'tag',
        `--captured /tmp/captured-111.json --tarballs ${seeded111}`,
      ),
    ).toMatchObject({ code: 0 })
    const seeded = await world.must('git ls-remote --tags origin', { cwd: FIXTURE })
    expect(seeded.stdout).toContain(`refs/tags/@e2e/alpha@v${releasedAlpha}`)
    expect(seeded.stdout).toContain(`refs/tags/@e2e/beta@v${releasedBeta}`)

    const betaManifest = parseJson(await world.read(`${FIXTURE}/packages/beta/package.json`))
    await world.write(
      `${FIXTURE}/packages/beta/package.json`,
      `${JSON.stringify({ ...Object(betaManifest), dependencies: { '@e2e/alpha': 'workspace:^' } }, null, 2)}\n`,
    )
    await world.write(`${FIXTURE}/release.jsonc`, CHANGESETS_RELEASE_JSONC)
    await world.must('pnpm install --silent && git add -A && git commit -q -m "chore: changesets versioning"', {
      cwd: FIXTURE,
    })
    await world.must('git push -q origin HEAD:main', { cwd: FIXTURE })

    for (const [bump, slug] of [['minor', 'alpha-minor'], ['patch', 'alpha-patch']] as const) {
      const created = await world.tool(
        'changeset-management',
        'new',
        `@e2e/alpha --bump ${bump} --summary "alpha ${bump}" --slug ${slug}`,
      )
      expect(created.code).toBe(0)
    }
    await world.must('git add -A && git commit -q -m "chore: intents"', { cwd: FIXTURE })

    const versioned = await world.tool('version-management', 'bump')
    expect(versioned.code).toBe(0)

    const alphaNext = nextMinor(releasedAlpha)
    const betaNext = nextPatch(releasedBeta)
    expect(await readVersion(world, 'alpha')).toBe(alphaNext)
    expect(await readVersion(world, 'beta')).toBe(betaNext)

    const intents = await world.must('ls .changeset', { cwd: FIXTURE })
    expect(intents.stdout).not.toContain('alpha-minor')
    expect(intents.stdout).not.toContain('alpha-patch')
    const alphaLog = await world.read(`${FIXTURE}/.changeset/changelogs/@e2e!alpha@${alphaNext}.md`)
    expect(alphaLog).toContain('alpha minor')
    expect(alphaLog).toContain('alpha patch')
    await world.read(`${FIXTURE}/.changeset/changelogs/@e2e!beta@${betaNext}.md`)

    const releasing120 = await packTarballs(world, WORKSPACE_TARBALLS)
    const packedBeta = await world.must(`tar -xzOf ${releasing120}/e2e-beta-${betaNext}.tgz package/package.json`)
    expect(packedBeta.stdout).toContain(`"@e2e/alpha": "^${alphaNext}"`)

    await world.must(
      'git add -A && git commit -q -m "chore(release): version packages" && git push -q origin HEAD:main',
      {
        cwd: FIXTURE,
      },
    )
    release120 = (await world.must('git rev-parse HEAD', { cwd: FIXTURE })).stdout.trim()

    const planned = await world.job('plan')
    expect(planned.filter((step) => step.code !== 0)).toEqual([])
    expect(planned.find((step) => step.step === 'plan')?.outputs).toMatchObject({ phase: 'release' })
    const released = await world.job('release')
    expect(released.filter((step) => step.code !== 0)).toEqual([])
    expect(released.map((step) => step.step)).toEqual([
      "Build the release tools at this workflow's own revision",
      "Pack the workspace through the caller's flake",
      'Capture this cycle',
      "Tag released versions, recording each tarball's integrity",
      'GitHub Releases from the authored changelogs',
    ])

    const tags = await world.must('git ls-remote --tags origin', { cwd: FIXTURE })
    expect(tags.stdout).toContain(`refs/tags/@e2e/alpha@v${alphaNext}`)
    expect(tags.stdout).toContain(`refs/tags/@e2e/beta@v${betaNext}`)
    const notes = await fetchRelease(world, `@e2e/alpha@v${alphaNext}`)
    expect(notes.status).toBe(200)

    const settled = await world.tool('github-release-management', 'plan', `--tarballs ${releasing120}`)
    expect(`${settled.stdout}${settled.stderr}`).toContain('phase=none')
  })

  await session.phase('a released identity is immutable and a reverted manifest is refused', async (world) => {
    await world.must(`git checkout -q ${release111}`, { cwd: FIXTURE })
    const historical = await packTarballs(world, '/tmp/prm-tarballs-historical')
    const verified = await world.tool('github-release-management', 'plan', `--tarballs ${historical}`)
    expect(verified.code).toBe(0)
    expect(`${verified.stdout}${verified.stderr}`).toContain('phase=none')

    await world.must(`git checkout -q ${release120}`, { cwd: FIXTURE })
    const sabotaged = parseJson(await world.read(`${FIXTURE}/packages/beta/package.json`))
    await world.write(
      `${FIXTURE}/packages/beta/package.json`,
      `${
        JSON.stringify(
          {
            ...Object(sabotaged),
            version: releasedBeta,
            dependencies: { '@e2e/alpha': `workspace:~${releasedAlpha}` },
          },
          null,
          2,
        )
      }\n`,
    )
    await world.must('git add -A && git commit -q -m "chore: sabotage the released manifest"', { cwd: FIXTURE })
    const sabotagedTarballs = await packTarballs(world, '/tmp/prm-tarballs-sabotage')
    const refused = await world.tool('github-release-management', 'plan', `--tarballs ${sabotagedTarballs}`)
    expect(refused.code).not.toBe(0)
    const refusal = `${refused.stdout}${refused.stderr}`
    expect(refusal).toContain(`@e2e/beta@${releasedBeta}`)
    expect(refusal).toContain('package/package.json')
    expect(refusal).toMatch(/recorded: sha512-/)
    expect(refusal).toMatch(/current: sha512-/)

    await world.must(`git reset --hard ${release120}`, { cwd: FIXTURE })
    const restored = await packTarballs(world, '/tmp/prm-tarballs-restored')
    const green = await world.tool('github-release-management', 'plan', `--tarballs ${restored}`)
    expect(green.code).toBe(0)
    expect(`${green.stdout}${green.stderr}`).toContain('phase=none')
  })

  await session.phase('the release never publishes to npm', async (world) => {
    const before = registryPings(await world.read(REGISTRY_LOG))

    await world.must(`curl -fsS ${REGISTRY}/-/ping > /dev/null`)

    await expect
      .poll(async () => registryPings(await world.read(REGISTRY_LOG)), { interval: 200, timeout: 10_000 })
      .toBeGreaterThan(before)

    expect(registryPublishes(await world.read(REGISTRY_LOG))).toEqual([])

    const stored = await world.must(`find ${REGISTRY_STORAGE} -mindepth 1 -maxdepth 3 -name package.json`)
    expect(stored.stdout.trim()).toBe('')
  })
}

Feature('Releasing packages from change intents').body(({ scenario }) => {
  scenario(
    'an authored intent becomes a tagged release with notes',
    Gherkin.Do.pipe(
      Given('a container world holding a two-package workspace')('session', () =>
        Effect.promise(() =>
          Session.open({
            repoRoot,
            artifacts,
            filter: process.env['E2E_FILTER'],
            keep: process.env['E2E_KEEP'] === '1',
          })
        )),
      When('the release pipeline runs through every phase')((s) =>
        Effect.promise(async () => {
          try {
            await runPhases(s.session)
          } finally {
            await s.session.close()
          }
        })
      ),
      Then('every phase reports success')((s) => {
        expect(s.session.failed).toBe(false)
      }),
    ),
  )
})
