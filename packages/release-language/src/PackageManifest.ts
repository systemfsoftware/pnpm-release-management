import { type FsPath, ManifestInvalid, type PackageManifestWire } from './Workspace.schema.js'

export const manifestVersionErrorOf = (
  manifest: PackageManifestWire,
  path: FsPath,
): ManifestInvalid | undefined => {
  if (manifest.version === undefined && manifest.private !== true) {
    return ManifestInvalid.make({ path, reason: 'version is required for a publishable workspace member' })
  }
  return undefined
}
