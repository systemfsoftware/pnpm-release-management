import * as S from 'effect/Schema'

export const Manifest = S.Struct({ version: S.String })

export const StatusRow = S.Struct({
  name: S.String,
  local_version: S.String,
  npm_latest: S.String,
  class: S.String,
})

export const CapturedEntry = S.Struct({ tag: S.String })

export const Release = S.Struct({ tag_name: S.String, body: S.String })

export const Pull = S.Struct({ title: S.String, labels: S.Array(S.Struct({ name: S.String })) })

export const Releases = S.Array(S.Unknown)

export const Pulls = S.Array(Pull)
