import * as fc from 'effect/testing/FastCheck'

const seed = process.env['FC_SEED']
const path = process.env['FC_PATH']

if (seed !== undefined && seed !== '') {
  const parsed = Number(seed)
  if (!Number.isInteger(parsed)) {
    throw new Error(`FC_SEED must be an integer, got ${JSON.stringify(seed)}`)
  }
  fc.configureGlobal({
    ...fc.readConfigureGlobal(),
    seed: parsed,
    ...(path === undefined || path === '' ? {} : { path, endOnFailure: true }),
  })
}
