export interface TarEntry {
  readonly path: string
  readonly content: Uint8Array
}

const HEADER_SIZE = 512
const decoder = new TextDecoder()

const readString = (block: Uint8Array, offset: number, length: number): string => {
  const raw = decoder.decode(block.subarray(offset, offset + length))
  const terminator = raw.indexOf('\u0000')
  if (terminator === -1) {
    return raw
  }
  return raw.slice(0, terminator)
}

const readOctal = (block: Uint8Array, offset: number, length: number): number => {
  const text = readString(block, offset, length).trim()
  if (text.length === 0) {
    return 0
  }
  return Number.parseInt(text, 8)
}

export const parseTar = (buffer: Uint8Array): ReadonlyArray<TarEntry> => {
  const entries: Array<TarEntry> = []
  let offset = 0
  while (offset + HEADER_SIZE <= buffer.length) {
    const header = buffer.subarray(offset, offset + HEADER_SIZE)
    if (header.every((byte) => byte === 0)) break
    const name = readString(header, 0, 100)
    const prefix = readString(header, 345, 155)
    const size = readOctal(header, 124, 12)
    const type = header[156] ?? 0
    let path = name
    if (prefix.length > 0) {
      path = `${prefix}/${name}`
    }
    const dataStart = offset + HEADER_SIZE
    if (type === 0 || type === 48) {
      entries.push({ path, content: buffer.slice(dataStart, dataStart + size) })
    }
    offset = dataStart + Math.ceil(size / HEADER_SIZE) * HEADER_SIZE
  }
  return entries
}
