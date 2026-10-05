import * as S from 'effect/Schema'
import { RelativePath } from './Workspace.schema.js'

export const SurfaceWrite = S.Struct({
  path: RelativePath,
  moved: S.Boolean,
})
export type SurfaceWrite = S.Schema.Type<typeof SurfaceWrite>
