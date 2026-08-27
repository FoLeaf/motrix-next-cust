/** @fileoverview Contract tests for the harmonized Material color system. */
import { describe, expect, it } from 'vitest'
import { Hct, argbFromHex, customColor } from '@material/material-color-utilities'
import { COLOR_SCHEMES, type ColorSchemeDefinition } from '@shared/constants'
import { buildAppColorTokens, buildColorSchemeTheme, type AppColorTokens } from './colorScheme'

const HEX_COLOR = /^#[0-9a-f]{6}$/i

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

function hueDistance(first: number, second: number): number {
  const difference = Math.abs(first - second)
  return Math.min(difference, 360 - difference)
}

function colorValues(tokens: AppColorTokens): string[] {
  return Object.values(tokens).flatMap((value) => (typeof value === 'string' ? [value] : Object.values(value)))
}

const CUSTOM_SCHEMES: ColorSchemeDefinition[] = [
  { id: 'custom-dark', labelKey: 'custom-dark', seed: '#000000' },
  { id: 'custom-light', labelKey: 'custom-light', seed: '#FFFFFF' },
  { id: 'custom-vivid', labelKey: 'custom-vivid', seed: '#00FF7F' },
  { id: 'custom-neutral', labelKey: 'custom-neutral', seed: '#777777' },
]

describe('Material color system', () => {
  it.each([...COLOR_SCHEMES, ...CUSTOM_SCHEMES])('builds a complete palette for $id', (scheme) => {
    const theme = buildColorSchemeTheme(scheme)

    for (const dark of [false, true]) {
      const tokens = buildAppColorTokens(theme, dark)
      expect(colorValues(tokens).every((value) => HEX_COLOR.test(value))).toBe(true)

      for (const role of ['primary', 'tertiary', 'info', 'success', 'warning', 'error'] as const) {
        const colors = tokens[role]
        expect(contrastRatio(colors.color, colors.onColor)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(colors.container, colors.onContainer)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('derives every semantic color from the selected source', () => {
    const amber = buildAppColorTokens(buildColorSchemeTheme(COLOR_SCHEMES[0]), false)
    const glacier = buildAppColorTokens(
      buildColorSchemeTheme(COLOR_SCHEMES.find((scheme) => scheme.id === 'glacier')!),
      false,
    )
    const rose = buildAppColorTokens(
      buildColorSchemeTheme(COLOR_SCHEMES.find((scheme) => scheme.id === 'rose')!),
      false,
    )

    expect(rose.info.color).not.toBe(amber.info.color)
    expect(glacier.success.color).not.toBe(amber.success.color)
    expect(glacier.warning.color).not.toBe(amber.warning.color)
    expect(rose.error.color).not.toBe(amber.error.color)
  })

  it('harmonizes each semantic reference toward the selected source with Material utilities', () => {
    const mint = COLOR_SCHEMES.find((scheme) => scheme.id === 'mint')!
    const theme = buildColorSchemeTheme(mint)
    const references = {
      info: '#0061A4',
      success: '#386A20',
      warning: '#7C5800',
      error: '#BA1A1A',
    }

    for (const [name, reference] of Object.entries(references)) {
      const group = theme.customColors.find((candidate) => candidate.color.name === name)
      if (!group) throw new Error(`Missing semantic color: ${name}`)
      expect(group.value).toBe(customColor(theme.source, { name, value: argbFromHex(reference), blend: true }).value)
    }
  })

  it('maps task statuses to semantic roles from the same palette', () => {
    const tokens = buildAppColorTokens(buildColorSchemeTheme(COLOR_SCHEMES[0]), true)

    expect(tokens.statusActive).toBe(tokens.primary.color)
    expect(tokens.statusWaiting).toBe(tokens.info.color)
    expect(tokens.statusPaused).toBe(tokens.outline)
    expect(tokens.statusError).toBe(tokens.error.color)
    expect(tokens.statusSuccess).toBe(tokens.success.color)
  })

  it('keeps error recognizable while harmonizing it with a green theme', () => {
    const mint = COLOR_SCHEMES.find((scheme) => scheme.id === 'mint')!
    const theme = buildColorSchemeTheme(mint)
    const sourceHue = Hct.fromInt(argbFromHex(mint.seed)).hue
    const referenceHue = Hct.fromInt(argbFromHex('#BA1A1A')).hue

    for (const dark of [false, true]) {
      const tokens = buildAppColorTokens(theme, dark)
      const errorHue = Hct.fromInt(argbFromHex(tokens.error.color)).hue
      expect(hueDistance(errorHue, referenceHue)).toBeLessThan(hueDistance(errorHue, sourceHue))
      expect(hueDistance(errorHue, referenceHue)).toBeGreaterThan(0)
    }
  })
})
