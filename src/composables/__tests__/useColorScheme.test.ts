/** @fileoverview Verifies that CSS and Naive UI consume the same Material tokens. */
import { describe, expect, it } from 'vitest'
import { COLOR_SCHEMES } from '@shared/constants'
import { buildAppColorTokens, buildColorSchemeTheme } from '@shared/utils/colorScheme'
import { buildCssVariables, buildNaiveTheme } from '../useColorScheme'

describe('color scheme bridges', () => {
  it.each([false, true])('keeps CSS and Naive UI roles identical when dark is %s', (dark) => {
    const tokens = buildAppColorTokens(buildColorSchemeTheme(COLOR_SCHEMES[0]), dark)
    const css = buildCssVariables(tokens)
    const naive = buildNaiveTheme(tokens)

    expect(css['--m3-primary']).toBe(tokens.primary.color)
    expect(css['--m3-info']).toBe(tokens.info.color)
    expect(css['--m3-success']).toBe(tokens.success.color)
    expect(css['--m3-warning']).toBe(tokens.warning.color)
    expect(css['--m3-error']).toBe(tokens.error.color)
    expect(css['--m3-tertiary-container']).toBe(tokens.tertiary.container)

    expect(naive.common?.primaryColor).toBe(tokens.primary.color)
    expect(naive.common?.infoColor).toBe(tokens.info.color)
    expect(naive.common?.successColor).toBe(tokens.success.color)
    expect(naive.common?.warningColor).toBe(tokens.warning.color)
    expect(naive.common?.errorColor).toBe(tokens.error.color)
    expect(naive.common?.modalColor).toBe(tokens.surfaceContainerHigh)
    expect(naive.common?.popoverColor).toBe(tokens.surfaceContainerHighest)
    expect(naive.Dialog?.color).toBe(tokens.surfaceContainerHigh)
    expect(naive.Drawer?.color).toBe(tokens.surfaceContainerHigh)
    expect(naive.Message?.color).toBe(tokens.surfaceContainerHighest)
    expect(naive.Button?.textColorPrimary).toBe(tokens.primary.onColor)
    expect(naive.Button?.textColorInfo).toBe(tokens.info.onColor)
    expect(naive.Button?.textColorSuccess).toBe(tokens.success.onColor)
    expect(naive.Button?.textColorWarning).toBe(tokens.warning.onColor)
    expect(naive.Button?.textColorError).toBe(tokens.error.onColor)
    expect(naive.Tabs?.tabTextColorActiveLine).toBe(tokens.onSurface)
    expect(naive.Tabs?.tabTextColorActiveBar).toBe(tokens.onSurface)
    expect(naive.Select?.peers?.InternalSelectMenu?.optionTextColorActive).toBe(tokens.onSurface)
  })
})
