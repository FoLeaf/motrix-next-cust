/** @fileoverview Dependency-free color-scheme config helpers.
 *
 * Kept separate from colorScheme.ts (which pulls in the heavy
 * @material/material-color-utilities library) so that the config
 * hydration / preference store path stays free of that dependency. */
import { COLOR_SCHEMES, CUSTOM_COLOR_SCHEME_ID, DEFAULT_CUSTOM_COLOR_SCHEME } from '@shared/constants'

const HEX_COLOR_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

export function normalizeCustomColorScheme(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_CUSTOM_COLOR_SCHEME
  const match = value.trim().match(HEX_COLOR_RE)
  if (!match) return DEFAULT_CUSTOM_COLOR_SCHEME
  const hex = match[1]
  if (hex.length === 3) {
    return `#${hex
      .split('')
      .map((char) => char + char)
      .join('')
      .toUpperCase()}`
  }
  return `#${hex.toUpperCase()}`
}

export function getAllowedColorSchemeIds(): string[] {
  return [...COLOR_SCHEMES.map((scheme) => scheme.id), CUSTOM_COLOR_SCHEME_ID]
}
