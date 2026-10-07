import { Effect } from 'effect'
import * as S from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'
import { FsPath, GitRef, PackageName, RelativePath } from './Workspace.schema.js'

export const TaskName = S.NonEmptyString.pipe(S.brand('TaskName'))
export type TaskName = S.Schema.Type<typeof TaskName>

export const TargetTriple = S.NonEmptyString.pipe(S.brand('TargetTriple'))
export type TargetTriple = S.Schema.Type<typeof TargetTriple>

export const TargetSuffix = S.String.pipe(
  S.check(S.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  S.brand('TargetSuffix'),
)
export type TargetSuffix = S.Schema.Type<typeof TargetSuffix>

const duplicateSuffixOf = (suffixes: ReadonlyArray<string>): string | undefined =>
  suffixes.find((suffix, index) => suffixes.indexOf(suffix) !== index)

export const uniqueSuffixes = S.makeFilter<ReadonlyArray<string>>(
  (suffixes) => {
    const duplicate = duplicateSuffixOf(suffixes)
    return duplicate === undefined || `target suffix "${duplicate}" is declared more than once`
  },
  { arbitrary: { constraint: { unique: true } } },
)

export const OsName = S.NonEmptyString.pipe(S.brand('OsName'))
export type OsName = S.Schema.Type<typeof OsName>

export const CpuName = S.NonEmptyString.pipe(S.brand('CpuName'))
export type CpuName = S.Schema.Type<typeof CpuName>

export const LibcName = S.NonEmptyString.pipe(S.brand('LibcName'))
export type LibcName = S.Schema.Type<typeof LibcName>

export const RunnerName = S.NonEmptyString.pipe(S.brand('RunnerName'))
export type RunnerName = S.Schema.Type<typeof RunnerName>

export const BinName = S.NonEmptyString.pipe(S.brand('BinName'))
export type BinName = S.Schema.Type<typeof BinName>

export const GlobPattern = S.NonEmptyString.pipe(S.brand('GlobPattern'))
export type GlobPattern = S.Schema.Type<typeof GlobPattern>

export const TomlHeader = S.Literals(['[workspace.package]', '[package]'])
export type TomlHeader = S.Schema.Type<typeof TomlHeader>

export const PrTitle = S.NonEmptyString.pipe(S.brand('PrTitle'))
export type PrTitle = S.Schema.Type<typeof PrTitle>

export const ConfigField = S.NonEmptyString.pipe(S.brand('ConfigField'))
export type ConfigField = S.Schema.Type<typeof ConfigField>

export const JsonSurface = S.Struct({
  kind: S.Literal('json'),
  path: RelativePath,
})
export type JsonSurface = S.Schema.Type<typeof JsonSurface>

export const TomlSurface = S.Struct({
  kind: S.Literal('toml'),
  path: S.optional(RelativePath),
  glob: S.optional(GlobPattern),
  header: S.optional(TomlHeader),
})
export type TomlSurface = S.Schema.Type<typeof TomlSurface>

export const CargoSurface = S.Struct({
  kind: S.Literal('cargo'),
  path: RelativePath,
  package: S.optional(PackageName),
})
export type CargoSurface = S.Schema.Type<typeof CargoSurface>

export const NixSurface = S.Struct({
  kind: S.Literal('nix'),
  path: RelativePath,
})
export type NixSurface = S.Schema.Type<typeof NixSurface>

export const VersionSurface = S.Union([JsonSurface, TomlSurface, CargoSurface, NixSurface])
export type VersionSurface = S.Schema.Type<typeof VersionSurface>

export const SurfacesVersioning = S.Struct({
  strategy: S.Literal('surfaces'),
  manifest: RelativePath,
  changelog: RelativePath,
  surfaces: S.Array(VersionSurface),
})
export type SurfacesVersioning = S.Schema.Type<typeof SurfacesVersioning>

export const PnpmVersioning = S.Struct({
  strategy: S.Literal('pnpm'),
  surfaces: S.Array(VersionSurface).pipe(
    S.withDecodingDefault(Effect.succeed([])),
  ),
})
export type PnpmVersioning = S.Schema.Type<typeof PnpmVersioning>

export const Versioning = S.Union([SurfacesVersioning, PnpmVersioning])
export type Versioning = S.Schema.Type<typeof Versioning>

export const TurboGate = S.Struct({
  strategy: S.Literal('turbo'),
  task: S.optional(TaskName),
})
export type TurboGate = S.Schema.Type<typeof TurboGate>

export const PathsGate = S.Struct({
  strategy: S.Literal('paths'),
})
export type PathsGate = S.Schema.Type<typeof PathsGate>

export const Gate = S.Union([TurboGate, PathsGate])
export type Gate = S.Schema.Type<typeof Gate>

export const DistributionTarget = S.Struct({
  target: TargetTriple,
  suffix: TargetSuffix,
  os: OsName,
  cpu: CpuName,
  libc: S.optional(LibcName),
  runner: RunnerName,
  bin: BinName,
})
export type DistributionTarget = S.Schema.Type<typeof DistributionTarget>

export const Distribution = S.Struct({
  launcherManifest: RelativePath,
  targets: S.NonEmptyArray(DistributionTarget).pipe(
    S.check(
      S.makeFilter(
        (targets) => {
          const duplicate = duplicateSuffixOf(targets.map((target) => target.suffix))
          return duplicate === undefined || `target suffix "${duplicate}" is declared by more than one target`
        },
        {
          arbitrary: {
            candidate: {
              make: (fc) =>
                fc.uniqueArray(S.toArbitrary(DistributionTarget)(fc), {
                  minLength: 1,
                  maxLength: 4,
                  selector: (target) => target.suffix,
                }),
            },
          },
        },
      ),
    ),
  ),
})
export type Distribution = S.Schema.Type<typeof Distribution>

export const PrBlock = S.Struct({
  title: PrTitle,
  body: S.String,
})
export type PrBlock = S.Schema.Type<typeof PrBlock>

const ReleaseConfigWire = S.Struct({
  base: GitRef,
  branch: GitRef,
  changesetDir: RelativePath.pipe(
    S.withDecodingDefault(Effect.succeed('.changeset')),
  ),
  changelogDir: S.optional(RelativePath),
  versioning: Versioning,
  gate: Gate,
  distribution: S.optional(Distribution),
  pr: PrBlock.pipe(
    S.withDecodingDefault(Effect.succeed({
      title: 'chore(release): version packages',
      body:
        'Consumes pending `.changeset/` intents.\n\nMerging tags the released versions and creates GitHub releases.',
    })),
  ),
})

const ReleaseConfigFull = S.Struct({
  base: GitRef,
  branch: GitRef,
  changesetDir: RelativePath,
  changelogDir: RelativePath,
  versioning: Versioning,
  gate: Gate,
  distribution: S.optional(Distribution),
  pr: PrBlock,
})

export const ReleaseConfig = ReleaseConfigWire.pipe(
  S.decodeTo(ReleaseConfigFull, {
    decode: SchemaGetter.transform(
      (wire: S.Schema.Type<typeof ReleaseConfigWire>) => ({
        ...wire,
        changelogDir: wire.changelogDir ??
          `${wire.changesetDir}/changelogs`,
      }),
    ),
    encode: SchemaGetter.transformOrFail((full) => S.decodeEffect(ReleaseConfigWire)(full).pipe(Effect.orDie)),
  }),
)
export type ReleaseConfig = S.Schema.Type<typeof ReleaseConfig>

export const ConfigUnreadable = S.TaggedStruct('ConfigUnreadable', {
  path: FsPath,
})
export type ConfigUnreadable = S.Schema.Type<typeof ConfigUnreadable>

export const ConfigMalformed = S.TaggedStruct('ConfigMalformed', {
  path: FsPath,
  reason: S.String,
})
export type ConfigMalformed = S.Schema.Type<typeof ConfigMalformed>

export const ConfigFieldMissing = S.TaggedStruct('ConfigFieldMissing', {
  path: FsPath,
  field: ConfigField,
})
export type ConfigFieldMissing = S.Schema.Type<typeof ConfigFieldMissing>

export const ConfigFieldInvalid = S.TaggedStruct('ConfigFieldInvalid', {
  path: FsPath,
  field: ConfigField,
  reason: S.String,
})
export type ConfigFieldInvalid = S.Schema.Type<typeof ConfigFieldInvalid>

export const ConfigRefusal = S.Union([
  ConfigUnreadable,
  ConfigMalformed,
  ConfigFieldMissing,
  ConfigFieldInvalid,
])
export type ConfigRefusal = S.Schema.Type<typeof ConfigRefusal>
