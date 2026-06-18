const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '../src/main/ai/model-prompts.ts')
let buf = fs.readFileSync(file)

// The file has been double-encoded. Each UTF-8 multibyte sequence was
// misread as Windows-1252 and then re-encoded as UTF-8, creating 6-9 byte
// sequences for what should be 2-3 byte sequences.
//
// Common corruptions found:
// — (U+2014, E2 80 94) → â€" (C3A2 E282AC E2809D)
// → (U+2192, E2 86 92) → â†' (C3A2 E280A0 E28099) [check]
// We fix by doing binary search-and-replace

const fixes = [
  // â€" → — (em dash, most common)
  [[0xC3,0xA2,0xE2,0x82,0xAC,0xE2,0x80,0x9D], [0xE2,0x80,0x94]],
  // â€" → – (en dash) — same lead bytes, different tail
  [[0xC3,0xA2,0xE2,0x82,0xAC,0xE2,0x80,0x93], [0xE2,0x80,0x93]],
  // â†' → →
  [[0xC3,0xA2,0xE2,0x80,0xA0,0xE2,0x80,0x99], [0xE2,0x86,0x92]],
  // â€™ → ' (right single quote)
  [[0xC3,0xA2,0xE2,0x82,0xAC,0xE2,0x84,0xA2], [0xE2,0x80,0x99]],
  // â€œ → " (left double quote)
  [[0xC3,0xA2,0xE2,0x82,0xAC,0xC5,0x93], [0xE2,0x80,0x9C]],
]

function replaceBytes(buffer, pattern, replacement) {
  const result = []
  let i = 0
  while (i < buffer.length) {
    let found = false
    if (i <= buffer.length - pattern.length) {
      found = pattern.every((b, j) => buffer[i + j] === b)
    }
    if (found) {
      replacement.forEach(b => result.push(b))
      i += pattern.length
    } else {
      result.push(buffer[i])
      i++
    }
  }
  return Buffer.from(result)
}

for (const [pattern, replacement] of fixes) {
  buf = replaceBytes(buf, pattern, replacement)
}

// Now add NO introduction instruction
let text = buf.toString('utf8')
const replacements = [
  ['Return ONLY the optimized prompt in English', 'Start directly — NO intro. Return ONLY the optimized prompt in English'],
  ['Return ONLY the prompt in English', 'Start directly — NO intro. Return ONLY the prompt in English'],
  ['Return the positive prompt in English', 'Start directly — NO intro. Return the positive prompt in English'],
]
for (const [o, n] of replacements) text = text.split(o).join(n)

fs.writeFileSync(file, text, 'utf8')
console.log('Done')
