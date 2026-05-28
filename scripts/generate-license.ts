import crypto from 'crypto'

const LICENSE_SECRET = 'refmap-2026-secret'

function generateLicense(): string {
  const payload = crypto.randomBytes(6).toString('hex')
  const checksum = crypto
    .createHmac('sha256', LICENSE_SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, 4)
  const full = `${payload}${checksum}`
  return [0, 4, 8, 12].map(i => full.slice(i, i + 4)).join('-').toUpperCase()
}

export function validateLicense(key: string): boolean {
  const clean = key.replace(/-/g, '').toLowerCase()
  if (clean.length !== 16) return false
  const payload = clean.slice(0, 12)
  const checksum = clean.slice(12)
  const expected = crypto
    .createHmac('sha256', LICENSE_SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, 4)
  return checksum === expected
}

// CLI usage: npx tsx scripts/generate-license.ts [count]
const count = parseInt(process.argv[2] ?? '1', 10)
for (let i = 0; i < count; i++) {
  const key = generateLicense()
  console.log(key)
}
