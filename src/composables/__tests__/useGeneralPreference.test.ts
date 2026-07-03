/**
 * @fileoverview Tests for useGeneralPreference pure functions.
 *
 * The General tab contains app-shell config: appearance, language, update,
 * startup, and tray/dock behavior. None of these config keys are sent to
 * the aria2 engine — buildGeneralSystemConfig returns an empty object.
 */
import { describe, it, expect } from 'vitest'
import {
  buildGeneralForm,
  buildGeneralSystemConfig,
  transformGeneralForStore,
  type GeneralForm,
} from '../useGeneralPreference'
import type { AppConfig } from '@shared/types'
import { DEFAULT_APP_CONFIG } from '@shared/constants'
import { userKeys } from '@shared/configKeys'

// ── buildGeneralForm ────────────────────────────────────────────────

describe('buildGeneralForm', () => {
  const emptyConfig = {} as AppConfig

  // ── Language ─────────────────────────────────────────────────────

  it('defaults locale to auto (follow system)', () => {
    const form = buildGeneralForm(emptyConfig)
    expect(form.locale).toBe('auto')
  })

  it('reads locale from config', () => {
    const form = buildGeneralForm({ locale: 'zh-CN' } as AppConfig)
    expect(form.locale).toBe('zh-CN')
  })

  // ── Appearance ──────────────────────────────────────────────────

  it('defaults theme to auto', () => {
    const form = buildGeneralForm(emptyConfig)
    expect(form.theme).toBe('auto')
  })

  it('reads theme from config', () => {
    const form = buildGeneralForm({ theme: 'dark' } as AppConfig)
    expect(form.theme).toBe('dark')
  })

  it('coerces null theme to auto via nullish coalescing', () => {
    const form = buildGeneralForm({ theme: null } as unknown as AppConfig)
    expect(form.theme).toBe('auto')
  })

  it('coerces undefined theme to auto via nullish coalescing', () => {
    const form = buildGeneralForm({ theme: undefined } as unknown as AppConfig)
    expect(form.theme).toBe('auto')
  })

  it('defaults colorScheme from DEFAULT_APP_CONFIG', () => {
    const form = buildGeneralForm(emptyConfig)
    expect(form.colorScheme).toBe(DEFAULT_APP_CONFIG.colorScheme)
  })

  it('reads colorScheme from config', () => {
    const form = buildGeneralForm({ colorScheme: 'aurora' } as AppConfig)
    expect(form.colorScheme).toBe('aurora')
  })

  it('defaults showProgressBar from DEFAULT_APP_CONFIG', () => {
    const form = buildGeneralForm(emptyConfig)
    expect(form.showProgressBar).toBe(DEFAULT_APP_CONFIG.showProgressBar)
  })

  it('defaults taskCardMode from DEFAULT_APP_CONFIG', () => {
    const form = buildGeneralForm(emptyConfig)
    expect(form.taskCardMode).toBe(DEFAULT_APP_CONFIG.taskCardMode)
  })

  it('defaults taskListWatermark from DEFAULT_APP_CONFIG', () => {
    const form = buildGeneralForm(emptyConfig)
    expect(form.taskListWatermark).toBe(DEFAULT_APP_CONFIG.taskListWatermark)
  })

  it('reads taskCardMode from config', () => {
    const form = buildGeneralForm({ taskCardMode: 'compact' } as AppConfig)
    expect(form.taskCardMode).toBe('compact')
  })

  it('reads taskListWatermark from config', () => {
    const form = buildGeneralForm({ taskListWatermark: false } as AppConfig)
    expect(form.taskListWatermark).toBe(false)
  })

  it('reads showProgressBar from config', () => {
    const form = buildGeneralForm({ showProgressBar: false } as AppConfig)
    expect(form.showProgressBar).toBe(false)
  })

  it('defaults dockBadgeSpeed from DEFAULT_APP_CONFIG', () => {
    const form = buildGeneralForm(emptyConfig)
    expect(form.dockBadgeSpeed).toBe(DEFAULT_APP_CONFIG.dockBadgeSpeed)
  })

  it('reads dockBadgeSpeed from config', () => {
    const form = buildGeneralForm({ dockBadgeSpeed: false } as AppConfig)
    expect(form.dockBadgeSpeed).toBe(false)
  })

  // ── Auto Update ─────────────────────────────────────────────────

  it('defaults autoCheckUpdate to true', () => {
    const form = buildGeneralForm(emptyConfig)
    expect(form.autoCheckUpdate).toBe(true)
  })

  it('defaults autoCheckUpdateInterval to every startup', () => {
    const form = buildGeneralForm(emptyConfig)
    expect(form.autoCheckUpdateInterval).toBe(0)
  })

  it('reads autoCheckUpdateInterval from config', () => {
    const form = buildGeneralForm({ autoCheckUpdateInterval: 168 } as unknown as AppConfig)
    expect(form.autoCheckUpdateInterval).toBe(168)
  })

  it('preserves every-startup autoCheckUpdateInterval from config', () => {
    const form = buildGeneralForm({ autoCheckUpdateInterval: 0 } as unknown as AppConfig)
    expect(form.autoCheckUpdateInterval).toBe(0)
  })

  it('persists autoCheckUpdateInterval as a user config key', () => {
    expect(userKeys).toContain('auto-check-update-interval')
  })

  it('exposes all supported update channels', async () => {
    const { UPDATE_CHANNELS } = await import('@shared/constants')
    expect(UPDATE_CHANNELS).toEqual(['stable', 'beta', 'latest'])
  })

  it('defaults updateChannel to stable', () => {
    const form = buildGeneralForm(emptyConfig)
    expect(form.updateChannel).toBe('stable')
  })

  it('reads updateChannel from config', () => {
    const form = buildGeneralForm({ updateChannel: 'beta' } as AppConfig)
    expect(form.updateChannel).toBe('beta')
  })

  it('reads all-channel latest updateChannel from config', () => {
    const form = buildGeneralForm({ updateChannel: 'latest' } as AppConfig)
    expect(form.updateChannel).toBe('latest')
  })

  // ── Startup Behavior ────────────────────────────────────────────

  it('defaults openAtLogin to false', () => {
    const form = buildGeneralForm(emptyConfig)
    expect(form.openAtLogin).toBe(DEFAULT_APP_CONFIG.openAtLogin)
  })

  it('reads openAtLogin from config', () => {
    const form = buildGeneralForm({ openAtLogin: true } as AppConfig)
    expect(form.openAtLogin).toBe(true)
  })

  it('defaults autoHideWindow from DEFAULT_APP_CONFIG', () => {
    const form = buildGeneralForm(emptyConfig)
    expect(form.autoHideWindow).toBe(DEFAULT_APP_CONFIG.autoHideWindow)
  })

  it('defaults keepWindowState from DEFAULT_APP_CONFIG', () => {
    const form = buildGeneralForm(emptyConfig)
    expect(form.keepWindowState).toBe(DEFAULT_APP_CONFIG.keepWindowState)
  })

  it('reads keepWindowState from config', () => {
    const form = buildGeneralForm({ keepWindowState: true } as AppConfig)
    expect(form.keepWindowState).toBe(true)
  })

  it('defaults resumeAllWhenAppLaunched from DEFAULT_APP_CONFIG', () => {
    const form = buildGeneralForm(emptyConfig)
    expect(form.resumeAllWhenAppLaunched).toBe(DEFAULT_APP_CONFIG.resumeAllWhenAppLaunched)
  })

  it('reads resumeAllWhenAppLaunched from config', () => {
    const form = buildGeneralForm({ resumeAllWhenAppLaunched: true } as AppConfig)
    expect(form.resumeAllWhenAppLaunched).toBe(true)
  })

  // ── Tray & Dock ─────────────────────────────────────────────────

  it('defaults minimizeToTrayOnClose from DEFAULT_APP_CONFIG', () => {
    const form = buildGeneralForm(emptyConfig)
    expect(form.minimizeToTrayOnClose).toBe(DEFAULT_APP_CONFIG.minimizeToTrayOnClose)
  })

  it('reads minimizeToTrayOnClose from config', () => {
    const form = buildGeneralForm({ minimizeToTrayOnClose: true } as AppConfig)
    expect(form.minimizeToTrayOnClose).toBe(true)
  })

  it('defaults hideDockOnMinimize from DEFAULT_APP_CONFIG', () => {
    const form = buildGeneralForm(emptyConfig)
    expect(form.hideDockOnMinimize).toBe(DEFAULT_APP_CONFIG.hideDockOnMinimize)
  })

  it('defaults traySpeedometer from DEFAULT_APP_CONFIG', () => {
    const form = buildGeneralForm(emptyConfig)
    expect(form.traySpeedometer).toBe(DEFAULT_APP_CONFIG.traySpeedometer)
  })

  it('reads traySpeedometer from config', () => {
    const form = buildGeneralForm({ traySpeedometer: true } as AppConfig)
    expect(form.traySpeedometer).toBe(true)
  })

  it('defaults lightweightMode from DEFAULT_APP_CONFIG', () => {
    const form = buildGeneralForm(emptyConfig)
    expect(form.lightweightMode).toBe(DEFAULT_APP_CONFIG.lightweightMode)
  })

  it('reads lightweightMode from config', () => {
    const form = buildGeneralForm({ lightweightMode: true } as AppConfig)
    expect(form.lightweightMode).toBe(true)
  })

  // ── Completeness: all 18 fields are present ─────────────────────

  it('returns all 20 form fields', () => {
    const form = buildGeneralForm(emptyConfig)
    const keys = Object.keys(form)
    expect(keys).toContain('locale')
    expect(keys).toContain('theme')
    expect(keys).toContain('colorScheme')
    expect(keys).toContain('customColorScheme')
    expect(keys).toContain('taskCardMode')
    expect(keys).toContain('taskListWatermark')
    expect(keys).toContain('sidebarTaskCounts')
    expect(keys).toContain('autoCheckUpdate')
    expect(keys).toContain('autoCheckUpdateInterval')
    expect(keys).toContain('updateChannel')
    expect(keys).toContain('showProgressBar')
    expect(keys).toContain('dockBadgeSpeed')
    expect(keys).toContain('openAtLogin')
    expect(keys).toContain('autoHideWindow')
    expect(keys).toContain('keepWindowState')
    expect(keys).toContain('resumeAllWhenAppLaunched')
    expect(keys).toContain('minimizeToTrayOnClose')
    expect(keys).toContain('hideDockOnMinimize')
    expect(keys).toContain('traySpeedometer')
    expect(keys).toContain('lightweightMode')
    expect(keys).toHaveLength(20)
  })
})

// ── buildGeneralSystemConfig ────────────────────────────────────────

describe('buildGeneralSystemConfig', () => {
  const baseForm: GeneralForm = {
    locale: 'en-US',
    theme: 'auto',
    colorScheme: 'amber',
    customColorScheme: '#737373',
    taskCardMode: 'full',
    taskListWatermark: true,
    sidebarTaskCounts: true,
    autoCheckUpdate: true,
    autoCheckUpdateInterval: 0,
    updateChannel: 'stable',
    showProgressBar: true,
    dockBadgeSpeed: true,
    openAtLogin: false,
    autoHideWindow: false,
    keepWindowState: false,
    resumeAllWhenAppLaunched: false,
    minimizeToTrayOnClose: false,
    hideDockOnMinimize: false,
    traySpeedometer: false,
    lightweightMode: false,
  }

  it('returns an empty object because General tab has no aria2 engine keys', () => {
    const config = buildGeneralSystemConfig(baseForm)
    expect(config).toEqual({})
    expect(Object.keys(config)).toHaveLength(0)
  })

  it('returns empty object regardless of form values', () => {
    const modifiedForm: GeneralForm = {
      ...baseForm,
      theme: 'dark',
      locale: 'zh-CN',
      openAtLogin: true,
      lightweightMode: true,
    }
    const config = buildGeneralSystemConfig(modifiedForm)
    expect(config).toEqual({})
  })
})

// ── transformGeneralForStore ────────────────────────────────────────

describe('transformGeneralForStore', () => {
  const baseForm: GeneralForm = {
    locale: 'en-US',
    theme: 'auto',
    colorScheme: 'amber',
    customColorScheme: '#737373',
    taskCardMode: 'full',
    taskListWatermark: true,
    sidebarTaskCounts: true,
    autoCheckUpdate: true,
    autoCheckUpdateInterval: 0,
    updateChannel: 'stable',
    showProgressBar: true,
    dockBadgeSpeed: true,
    openAtLogin: false,
    autoHideWindow: false,
    keepWindowState: false,
    resumeAllWhenAppLaunched: false,
    minimizeToTrayOnClose: false,
    hideDockOnMinimize: false,
    traySpeedometer: false,
    lightweightMode: false,
  }

  it('passes all form fields through to the store object', () => {
    const result = transformGeneralForStore(baseForm)
    expect(result.locale).toBe('en-US')
    expect(result.theme).toBe('auto')
    expect(result.colorScheme).toBe('amber')
    expect(result.customColorScheme).toBe('#737373')
    expect(result.taskCardMode).toBe('full')
    expect(result.taskListWatermark).toBe(true)
    expect(result.sidebarTaskCounts).toBe(true)
    expect(result.autoCheckUpdate).toBe(true)
    expect(result.autoCheckUpdateInterval).toBe(0)
    expect(result.updateChannel).toBe('stable')
    expect(result.showProgressBar).toBe(true)
    expect(result.dockBadgeSpeed).toBe(true)
    expect(result.openAtLogin).toBe(false)
    expect(result.autoHideWindow).toBe(false)
    expect(result.keepWindowState).toBe(false)
    expect(result.resumeAllWhenAppLaunched).toBe(false)
    expect(result.minimizeToTrayOnClose).toBe(false)
    expect(result.hideDockOnMinimize).toBe(false)
    expect(result.traySpeedometer).toBe(false)
    expect(result.lightweightMode).toBe(false)
  })

  it('preserves modified values through transform', () => {
    const result = transformGeneralForStore({
      ...baseForm,
      theme: 'dark',
      locale: 'ja',
      openAtLogin: true,
      lightweightMode: true,
    })
    expect(result.theme).toBe('dark')
    expect(result.locale).toBe('ja')
    expect(result.openAtLogin).toBe(true)
    expect(result.lightweightMode).toBe(true)
  })

  it('does not add any extra fields not present in the form', () => {
    const result = transformGeneralForStore(baseForm)
    const resultKeys = Object.keys(result)
    const formKeys = Object.keys(baseForm)
    // Result should only contain keys that exist in the form
    for (const key of resultKeys) {
      expect(formKeys).toContain(key)
    }
  })
})
