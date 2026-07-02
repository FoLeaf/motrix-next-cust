/**
 * @fileoverview Composable that generates M3 tonal palettes from a seed color
 * and injects them as CSS custom properties + Naive UI theme overrides.
 *
 * Architecture:
 * 1. Reads `colorScheme` id from the preference store
 * 2. Looks up the seed hex in COLOR_SCHEMES
 * 3. Feeds it to MCU `themeFromSourceColor` → full light/dark M3 palette
 * 4. Injects ~30 CSS variables onto `:root` via `document.documentElement.style`
 * 5. Returns a reactive `themeOverrides` for Naive UI's NConfigProvider
 *
 * The existing variables.css Amber Gold values serve as a static fallback
 * visible during the brief window before JS hydration completes.
 */
import { computed, watchEffect } from 'vue'
import { hexFromArgb } from '@material/material-color-utilities'
import { usePreferenceStore } from '@/stores/preference'
import { useTheme } from '@/composables/useTheme'
import { type ColorSchemeDefinition } from '@shared/constants'
import { buildColorSchemeTheme, resolveColorScheme } from '@shared/utils/colorScheme'
import type { GlobalThemeOverrides } from 'naive-ui'

/**
 * Map from MCU Scheme property names to CSS custom property names.
 * Only includes properties that exist on the legacy Scheme class.
 */
const MCU_TO_CSS: Record<string, string> = {
  primary: '--m3-primary',
  onPrimary: '--m3-on-primary',
  primaryContainer: '--m3-primary-container',
  onPrimaryContainer: '--m3-on-primary-container',
  surface: '--m3-surface',
  onSurface: '--m3-on-surface',
  onSurfaceVariant: '--m3-on-surface-variant',
  outline: '--m3-outline',
  outlineVariant: '--m3-outline-variant',
  error: '--m3-error',
  onError: '--m3-on-error',
  errorContainer: '--m3-error-container',
  tertiary: '--m3-tertiary',
  onTertiary: '--m3-on-tertiary',
  inverseSurface: '--m3-inverse-surface',
  inverseOnSurface: '--m3-on-inverse-surface',
}

/**
 * M3 surface container tones — derived from neutral tonal palette.
 * Official M3 spec: https://m3.material.io/styles/color/static/baseline
 */
const SURFACE_TONES = {
  light: {
    surfaceDim: 84,
    surfaceContainerLowest: 98,
    surfaceContainerLow: 94,
    surfaceContainer: 91,
    surfaceContainerHigh: 88,
    surfaceContainerHighest: 85,
  },
  dark: {
    surfaceDim: 6,
    surfaceContainerLowest: 4,
    surfaceContainerLow: 10,
    surfaceContainer: 12,
    surfaceContainerHigh: 17,
    surfaceContainerHighest: 22,
  },
} as const

const SURFACE_CSS_MAP: Record<string, string> = {
  surfaceDim: '--m3-surface-dim',
  surfaceContainerLowest: '--m3-surface-container-lowest',
  surfaceContainerLow: '--m3-surface-container-low',
  surfaceContainer: '--m3-surface-container',
  surfaceContainerHigh: '--m3-surface-container-high',
  surfaceContainerHighest: '--m3-surface-container-highest',
}

export function useColorScheme() {
  const preferenceStore = usePreferenceStore()
  const { isDark } = useTheme()

  const currentScheme = computed<ColorSchemeDefinition>(() =>
    resolveColorScheme(preferenceStore.config.colorScheme, preferenceStore.config.customColorScheme),
  )

  /** Full MCU theme object — cached by Vue's computed until seed changes. */
  const m3Theme = computed(() => buildColorSchemeTheme(currentScheme.value))

  /** The active M3 scheme (light or dark) based on current theme mode. */
  const activeScheme = computed(() => (isDark.value ? m3Theme.value.schemes.dark : m3Theme.value.schemes.light))

  /**
   * Derived surface container ARGB values from neutral tonal palette.
   * The legacy Scheme class does NOT expose these — we compute them manually.
   */
  const surfaceContainers = computed(() => {
    const neutral = m3Theme.value.palettes.neutral
    const tones = isDark.value ? SURFACE_TONES.dark : SURFACE_TONES.light
    return Object.fromEntries(Object.entries(tones).map(([key, tone]) => [key, neutral.tone(tone)])) as Record<
      string,
      number
    >
  })

  // ── CSS Variable Injection ──────────────────────────────────────────
  // Runs whenever colorScheme or isDark changes.
  // Sets properties directly on documentElement.style, which takes
  // precedence over the static values in variables.css.
  watchEffect(() => {
    const scheme = activeScheme.value
    const root = document.documentElement.style
    const json = scheme.toJSON() as Record<string, number>

    // Inject core M3 tokens from Scheme
    for (const [mcuKey, cssVar] of Object.entries(MCU_TO_CSS)) {
      const argb = json[mcuKey]
      if (argb !== undefined) {
        root.setProperty(cssVar, hexFromArgb(argb))
      }
    }

    // Inject surface container tokens (manually derived from neutral palette)
    const containers = surfaceContainers.value
    for (const [key, cssVar] of Object.entries(SURFACE_CSS_MAP)) {
      root.setProperty(cssVar, hexFromArgb(containers[key]))
    }

    // Derive brand/legacy aliases consumed by component CSS
    const primary = hexFromArgb(scheme.primary)
    const primaryContainer = hexFromArgb(scheme.primaryContainer)
    root.setProperty('--color-primary', primary)
    root.setProperty('--color-primary-hover', isDark.value ? hexFromArgb(scheme.primary) : primaryContainer)

    // Status colors — active/waiting follow primary, others stay semantic
    root.setProperty('--m3-status-active', primary)
    root.setProperty('--m3-status-waiting', primary)

    // Primary container backgrounds (tinted surfaces)
    const r = (scheme.primary >> 16) & 0xff
    const g = (scheme.primary >> 8) & 0xff
    const b = scheme.primary & 0xff
    root.setProperty('--m3-primary-container-bg', `rgba(${r}, ${g}, ${b}, ${isDark.value ? 0.12 : 0.1})`)

    // Scrollbar follows on-surface
    const sr = (scheme.onSurface >> 16) & 0xff
    const sg = (scheme.onSurface >> 8) & 0xff
    const sb = scheme.onSurface & 0xff
    root.setProperty('--m3-scrollbar-thumb', `rgba(${sr}, ${sg}, ${sb}, ${isDark.value ? 0.22 : 0.3})`)
    root.setProperty('--m3-scrollbar-thumb-inactive', `rgba(${sr}, ${sg}, ${sb}, ${isDark.value ? 0.1 : 0.15})`)

    // Warning follows primary for amber-brand consistency
    root.setProperty('--m3-warning', hexFromArgb(scheme.primary))
    root.setProperty('--m3-on-warning', hexFromArgb(scheme.onPrimary))

    // Tertiary — complementary accent for "caution"-level actions
    root.setProperty('--m3-tertiary', hexFromArgb(scheme.tertiary))
    root.setProperty('--m3-on-tertiary', hexFromArgb(scheme.onTertiary))

    // Error — dynamic semantic color for destructive actions
    root.setProperty('--m3-error', hexFromArgb(scheme.error))
    root.setProperty('--m3-on-error', hexFromArgb(scheme.onError))

    // On-surface variant — consumed by aside icon color, secondary text
    root.setProperty('--m3-on-surface', hexFromArgb(scheme.onSurface))
    root.setProperty('--m3-on-surface-variant', hexFromArgb(scheme.onSurfaceVariant))

    // Outline — borders, dividers
    root.setProperty('--m3-outline', hexFromArgb(scheme.outline))
    root.setProperty('--m3-outline-variant', hexFromArgb(scheme.outlineVariant))

    // Derive legacy light-shade aliases from MCU tonal palette
    // tone(80) ≈ light-5 (midtone tint), tone(95) ≈ light-9 (near-white tint)
    const palette = m3Theme.value.palettes.primary
    root.setProperty('--color-primary-light-5', hexFromArgb(palette.tone(isDark.value ? 30 : 80)))
    root.setProperty('--color-primary-light-9', hexFromArgb(palette.tone(isDark.value ? 10 : 95)))

    // Success (green) — keep independent of scheme for semantic clarity
    // These are NOT overridden; variables.css values remain.
  })

  // ── Naive UI Theme Overrides ────────────────────────────────────────
  const themeOverrides = computed<GlobalThemeOverrides>(() => {
    const scheme = activeScheme.value
    const containers = surfaceContainers.value
    /** Get hex from the derived surface container map. */
    const surface = (key: string) => hexFromArgb(containers[key])
    const primary = hexFromArgb(scheme.primary)
    const onPrimary = hexFromArgb(scheme.onPrimary)
    const onSurface = hexFromArgb(scheme.onSurface)
    const onSurfaceVariant = hexFromArgb(scheme.onSurfaceVariant)
    const outline = hexFromArgb(scheme.outlineVariant)
    const outlineFull = hexFromArgb(scheme.outline)

    const primaryPalette = m3Theme.value.palettes.primary
    const tertiaryPalette = m3Theme.value.palettes.tertiary

    // M3 interaction states: hover/pressed use adjacent tones from the tonal palette.
    // Light primary ≈ tone 40 → hover=50, pressed=30
    // Dark primary  ≈ tone 80 → hover=70, pressed=90
    const primaryHover = hexFromArgb(primaryPalette.tone(isDark.value ? 70 : 50))
    const primaryPressed = hexFromArgb(primaryPalette.tone(isDark.value ? 90 : 30))
    const tertiaryHover = hexFromArgb(tertiaryPalette.tone(isDark.value ? 70 : 50))
    const tertiaryPressed = hexFromArgb(tertiaryPalette.tone(isDark.value ? 90 : 30))

    return {
      common: {
        primaryColor: primary,
        primaryColorHover: primaryHover,
        primaryColorPressed: primaryPressed,
        primaryColorSuppl: primary,
        warningColor: hexFromArgb(scheme.tertiary),
        warningColorHover: tertiaryHover,
        warningColorPressed: tertiaryPressed,
        warningColorSuppl: hexFromArgb(scheme.tertiary),
        bodyColor: 'transparent',
        cardColor: surface('surfaceContainer'),
        modalColor: surface('surfaceContainerHigh'),
        popoverColor: surface('surfaceContainerHigh'),
        borderColor: outline,
        dividerColor: outline,
        borderRadius: '6px',
        fontFamily:
          '"Monospaced Number", "Chinese Quote", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif',
      },
      Divider: {
        color: outline,
      },
      Button: {
        border: `1px solid ${outline}`,
        borderHover: `1px solid ${outlineFull}`,
        borderFocus: `1px solid ${outlineFull}`,
      },
      Input: {
        color: surface('surfaceContainer'),
        colorFocus: surface('surfaceContainer'),
        textColor: onSurface,
        placeholderColor: onSurfaceVariant,
        border: `1px solid ${outline}`,
        borderHover: `1px solid ${outlineFull}`,
        borderFocus: `1px solid ${primary}`,
      },
      InputNumber: {
        peers: {
          Input: {
            color: surface('surfaceContainer'),
            colorFocus: surface('surfaceContainer'),
            textColor: onSurface,
            border: `1px solid ${outline}`,
            borderHover: `1px solid ${outlineFull}`,
            borderFocus: `1px solid ${primary}`,
          },
          Button: {
            textColor: onSurfaceVariant,
            textColorHover: onSurface,
          },
        },
      },
      Card: {
        color: surface('surfaceContainerLow'),
        textColor: onSurface,
        titleTextColor: onSurface,
        borderColor: outline,
      },
      // ── Component-specific overrides (prevent Naive defaults bleeding through) ──
      Message: {
        color: surface('surfaceContainerHigh'),
        textColor: onSurface,
        closeIconColor: onSurfaceVariant,
        closeIconColorHover: onSurface,
        colorInfo: surface('surfaceContainerHigh'),
        colorSuccess: surface('surfaceContainerHigh'),
        colorWarning: surface('surfaceContainerHigh'),
        colorError: surface('surfaceContainerHigh'),
      },
      Dialog: {
        color: surface('surfaceContainerHigh'),
        textColor: onSurface,
        titleTextColor: onSurface,
      },
      Switch: {
        railColorActive: primary,
      },
      Tabs: {
        tabTextColorActiveLine: primary,
        tabTextColorActiveBar: primary,
        tabTextColorHoverLine: primary,
        tabTextColorHoverBar: primary,
        barColor: primary,
      },
      Tag: {
        textColorCheckable: onSurfaceVariant,
        textColorHoverCheckable: primary,
        textColorChecked: onPrimary,
        colorChecked: primary,
        colorCheckedHover: primary,
      },
      Select: {
        peers: {
          InternalSelection: {
            border: `1px solid ${outline}`,
            borderHover: `1px solid ${outlineFull}`,
            borderFocus: `1px solid ${primary}`,
            borderActive: `1px solid ${primary}`,
          },
        },
      },
    }
  })

  return { currentScheme, themeOverrides }
}
