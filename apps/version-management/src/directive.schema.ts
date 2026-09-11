import * as S from 'effect/Schema'

const Spoken = S.TaggedStruct('Say', { line: S.String })
const Noted = S.TaggedStruct('Note', { line: S.String })
const Failed = S.TaggedStruct('Fail', { line: S.String })
const Halted = S.TaggedStruct('Exit', { code: S.Int })

export const Directive = S.Union([Spoken, Noted, Failed, Halted])
export type Directive = S.Schema.Type<typeof Directive>
