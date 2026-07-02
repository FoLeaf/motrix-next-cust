import { CorePalette, Scheme, argbFromHex, themeFromSourceColor, type Theme } from '@material/material-color-utilities'
import { COLOR_SCHEMES, CUSTOM_COLOR_SCHEME_ID, type ColorSchemeDefinition } from '@shared/constants'
import { normalizeCustomColorScheme } from '@shared/utils/colorSchemeConfig'

const LOW_SATURATION_THRESHOLD = 12

function saturationPercent(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  const delta = max - min
  if (delta === 0) return 0
  return (lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)) * 100
}

function buildContentTheme(source: number): Theme {
  const palette = CorePalette.contentOf(source)
  return {
    source,
    schemes: {
      light: Scheme.lightContent(source),
      dark: Scheme.darkContent(source),
    },
    palettes: {
      primary: palette.a1,
      secondary: palette.a2,
      tertiary: palette.a3,
      neutral: palette.n1,
      neutralVariant: palette.n2,
      error: palette.error,
    },
    customColors: [],
  }
}

export function buildColorSchemeTheme(scheme: ColorSchemeDefinition): Theme {
  const seed = normalizeCustomColorScheme(scheme.seed)
  const source = argbFromHex(seed)
  const usesContentPalette =
    scheme.variant === 'content' ||
    (scheme.id === CUSTOM_COLOR_SCHEME_ID && saturationPercent(seed) <= LOW_SATURATION_THRESHOLD)
  return usesContentPalette ? buildContentTheme(source) : themeFromSourceColor(source)
}

export function resolveColorScheme(id: string | undefined, customColor: string | undefined): ColorSchemeDefinition {
  if (id === CUSTOM_COLOR_SCHEME_ID) {
    return {
      id: CUSTOM_COLOR_SCHEME_ID,
      labelKey: 'preferences.color-scheme-custom',
      seed: normalizeCustomColorScheme(customColor),
    }
  }
  return COLOR_SCHEMES.find((scheme) => scheme.id === id) || COLOR_SCHEMES[0]
}
