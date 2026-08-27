#!/usr/bin/env node
/**
 * Repo-integrity checks that are NOT unit tests: they scan source and locale
 * files on disk to catch cross-cutting drift. Run in CI (see ci.yml), kept out
 * of the vitest suite so unit tests stay fast and don't break on asset edits.
 *
 * Checks:
 *   1. Locale parity   — every locale defines exactly the en-US key set.
 *   2. i18n usage       — every literal t('ns.key') in source exists in en-US.
 *
 * Exits non-zero with a readable report on the first category that fails.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_DIR = join(ROOT, 'src')
const LOCALES_DIR = join(SRC_DIR, 'shared', 'locales')

const problems = []

// ── 1. Locale key parity ────────────────────────────────────────────

function extractLocaleKeys(filePath) {
  const content = readFileSync(filePath, 'utf-8')
  const quoted = Array.from(content.matchAll(/^\s*'([^']+)'\s*:/gm), (m) => m[1])
  const bare = Array.from(content.matchAll(/^\s*([A-Za-z_$][\w$-]*)\s*:/gm), (m) => m[1])
  return new Set([...quoted, ...bare])
}

const locales = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)

const namespaces = readdirSync(join(LOCALES_DIR, 'en-US'))
  .filter((f) => f.endsWith('.js') && f !== 'index.js')
  .map((f) => f.replace(/\.js$/, ''))

for (const namespace of namespaces) {
  const reference = extractLocaleKeys(join(LOCALES_DIR, 'en-US', `${namespace}.js`))
  for (const locale of locales) {
    if (locale === 'en-US') continue
    const filePath = join(LOCALES_DIR, locale, `${namespace}.js`)
    let keys
    try {
      keys = extractLocaleKeys(filePath)
    } catch {
      problems.push(`locale ${locale} is missing namespace file ${namespace}.js`)
      continue
    }
    const missing = [...reference].filter((k) => !keys.has(k))
    const extra = [...keys].filter((k) => !reference.has(k))
    if (missing.length) problems.push(`locale ${locale}/${namespace}.js missing keys: ${missing.join(', ')}`)
    if (extra.length) problems.push(`locale ${locale}/${namespace}.js extra keys: ${extra.join(', ')}`)
  }
}

// ── 2. i18n literal-key usage ───────────────────────────────────────

function walkSourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walkSourceFiles(path)
    return /\.(ts|vue)$/.test(entry.name) ? [path] : []
  })
}

const namespaceKeys = new Map(namespaces.map((ns) => [ns, extractLocaleKeys(join(LOCALES_DIR, 'en-US', `${ns}.js`))]))
const callRe = /(?:\b\w+\.)?\bt\(\s*(['"])([A-Za-z0-9_-]+)\.([A-Za-z0-9_.-]+)\1/g

for (const filePath of walkSourceFiles(SRC_DIR)) {
  const content = readFileSync(filePath, 'utf-8')
  let match
  while ((match = callRe.exec(content)) !== null) {
    const [, , namespace, key] = match
    const keys = namespaceKeys.get(namespace)
    if (keys?.has(key)) continue
    if (!keys) continue // dynamic namespace — not a literal we can verify
    const line = content.slice(0, match.index).split('\n').length
    problems.push(`i18n key not found: ${relative(SRC_DIR, filePath)}:${line} ${namespace}.${key}`)
  }
}

// ── Report ──────────────────────────────────────────────────────────

if (problems.length) {
  console.error(`✗ repo-integrity: ${problems.length} problem(s)\n`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('✓ repo-integrity: locale parity + i18n usage OK')
