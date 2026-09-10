import { GitLive } from '@systemfsoftware/git-adapter'
import { ProcessLive } from '@systemfsoftware/process-adapter'
import type { GitPort, ProcessPort } from '@systemfsoftware/release-language'
import { Layer } from 'effect'

export const MainLive: Layer.Layer<GitPort | ProcessPort> = Layer.mergeAll(GitLive, ProcessLive)
