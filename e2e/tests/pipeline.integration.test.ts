import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect } from 'effect'
import * as S from 'effect/Schema'
import { expect } from 'vitest'
import { headSha, MEMBERS, setupFixture } from '../fixture.js'
import { FIXTURE, parseJson, type World } from '../harness.js'
import { Session } from '../session.js'
import { CapturedEntry, Manifest, Pulls, Release, Releases } from './__fixtures__/pipeline.schema.js'

const Feature = makeFeature({ it, layer })

const repoRoot = decodeURIComponent(new URL('../..', import.meta.url).pathname)
const artifacts = `${repoRoot}e2e/.artifacts/${new Date().toISOString().replace(/[:.]/g, '-')}`

const readVersion = async (world: World, name: string): Promise<string> => {
  const raw = await world.read(`${FIXTURE}/packages/${name}/package.json`)
  return S.decodeUnknownSync(Manifest)(parseJson(raw)).version
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

const runPhases = async (session: Session): Promise<void> => {
  let base = ''

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
    const planned = await world.tool('github-release-management', 'plan')
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
    const planned = await world.tool('github-release-management', 'plan')
    const output = `${planned.stdout}${planned.stderr}`
    expect(planned.code).toBe(0)
    expect(output).toContain('pending_intents=0')
    expect(output).toContain(`this_cycle=${MEMBERS.length}`)
    expect(output).toContain('phase=release')
  })

  await session.phase('captured set is written for the later steps', async (world) => {
    const captured = await world.tool(
      'github-release-management',
      'tag',
      '--output /tmp/captured.json',
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
    const tagged = await world.tool(
      'github-release-management',
      'tag',
      '--captured /tmp/captured.json',
    )
    expect(tagged.code).toBe(0)

    const tags = (await world.must('git ls-remote --tags origin', { cwd: FIXTURE })).stdout
    for (const member of MEMBERS) expect(tags).toContain(`${member}@v1.1.0`)
  })

  await session.phase('plan is empty once tags exist', async (world) => {
    const planned = await world.tool('github-release-management', 'plan')
    const output = `${planned.stdout}${planned.stderr}`
    expect(planned.code).toBe(0)
    expect(output).toContain('this_cycle=0')
    expect(output).toContain('phase=none')
  })

  await session.phase('release PR opens with the release label', async (world) => {
    const created = await world.tool(
      'changeset-management',
      'new',
      '@e2e/beta --bump patch --summary "beta stops dropping the last frame" --slug beta-fix',
    )
    expect(created.code).toBe(0)

    const opened = await world.tool('github-release-management', 'pr')
    expect(opened.code).toBe(0)
    expect(`${opened.stdout}${opened.stderr}`).toContain('created release PR #')

    const pulls = await fetchOpenPulls(world)
    expect(pulls.body?.length).toBe(1)
    expect(pulls.body?.[0]?.title).toBe('chore(release): version packages')
    expect(pulls.body?.[0]?.labels.map((label) => label.name)).toEqual(['release'])
  })

  await session.phase('release PR closes when no intents remain', async (world) => {
    const closed = await world.tool('github-release-management', 'pr')
    expect(closed.code).toBe(0)
    expect(`${closed.stdout}${closed.stderr}`).toContain('closed release PR #')

    const pulls = await fetchOpenPulls(world)
    expect(pulls.body?.length).toBe(0)
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
