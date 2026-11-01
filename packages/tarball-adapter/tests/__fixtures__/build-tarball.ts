import { gzipSync } from 'node:zlib'

const HEADER_SIZE = 512

const octal = (value: number, width: number): string => value.toString(8).padStart(width, '0')

const headerOf = (path: string, size: number): Buffer => {
  const block = Buffer.alloc(HEADER_SIZE)
  block.write(path, 0, 100, 'utf8')
  block.write('0000644', 100, 'utf8')
  block.write('0000000', 108, 'utf8')
  block.write('0000000', 116, 'utf8')
  block.write(`${octal(size, 11)}\u0000`, 124, 'utf8')
  block.write('00000000000', 136, 'utf8')
  block.write('ustar', 257, 'utf8')
  block[262] = 48
  block[263] = 48
  for (let index = 148; index < 156; index += 1) block[index] = 32
  let sum = 0
  for (const byte of block) sum += byte
  block.write(`${octal(sum, 6)}\u0000 `, 148, 'utf8')
  return block
}

export const buildTarball = (files: Record<string, string>): Buffer => {
  const chunks: Array<Buffer> = []
  for (const [path, text] of Object.entries(files)) {
    const content = Buffer.from(text, 'utf8')
    chunks.push(headerOf(path, content.length), content)
    const padding = (HEADER_SIZE - (content.length % HEADER_SIZE)) % HEADER_SIZE
    if (padding > 0) chunks.push(Buffer.alloc(padding))
  }
  chunks.push(Buffer.alloc(HEADER_SIZE * 2))
  return gzipSync(Buffer.concat(chunks))
}
