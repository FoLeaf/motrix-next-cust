/**
 * @fileoverview Pure functions for the General preference tab.
 *
 * Manages app-shell configuration: language, appearance, auto-update,
 * startup behavior, and tray/dock settings. None of these config keys
 * are sent to the aria2 engine — buildGeneralSystemConfig returns {}.
 */
import type { AppConfig } from '@shared/types'
import { DEFAULT_APP_CONFIG as D } from '@shared/constants'

// ── Types ───────────────────────────────────────────────────────────

export interface GeneralForm {
  [key: string]: unknown
  locale: string
  theme: string
  colorScheme: string
  customColorScheme: string
  taskCardMode: AppConfig['taskCardMode']
  taskListWatermark: boolean
  sidebarTaskCounts: boolean
  autoCheckUpdate: boolean
  autoCheckUpdateInterval: number
  updateChannel: string
  showProgressBar: boolean
  dockBadgeSpeed: boolean
  openAtLogin: boolean
  autoHideWindow: boolean
  keepWindowState: boolean
  resumeAllWhenAppLaunched: boolean
  minimizeToTrayOnClose: boolean
  hideDockOnMinimize: boolean
  traySpeedometer: boolean
  lightweightMode: boolean
}

// ── Pure Functions ──────────────────────────────────────────────────

/**
 * Builds the general form state from the preference store config.
 * All fallback values reference DEFAULT_APP_CONFIG (single source of truth).
 */
export function buildGeneralForm(config: AppConfig): GeneralForm {
  return {
    locale: config.locale || 'auto',
    theme: config.theme ?? D.theme,
    colorScheme: config.colorScheme ?? D.colorScheme,
    customColorScheme: config.customColorScheme ?? D.customColorScheme,
    taskCardMode: config.taskCardMode ?? D.taskCardMode,
    taskListWatermark: config.taskListWatermark ?? D.taskListWatermark,
    sidebarTaskCounts: config.sidebarTaskCounts ?? D.sidebarTaskCounts,
    autoCheckUpdate: config.autoCheckUpdate ?? D.autoCheckUpdate,
    autoCheckUpdateInterval: config.autoCheckUpdateInterval ?? D.autoCheckUpdateInterval,
    updateChannel: config.updateChannel ?? D.updateChannel,
    showProgressBar: config.showProgressBar ?? D.showProgressBar,
    dockBadgeSpeed: config.dockBadgeSpeed ?? D.dockBadgeSpeed,
    openAtLogin: config.openAtLogin ?? D.openAtLogin,
    autoHideWindow: config.autoHideWindow ?? D.autoHideWindow,
    keepWindowState: config.keepWindowState ?? D.keepWindowState,
    resumeAllWhenAppLaunched: config.resumeAllWhenAppLaunched ?? D.resumeAllWhenAppLaunched,
    minimizeToTrayOnClose: config.minimizeToTrayOnClose ?? D.minimizeToTrayOnClose,
    hideDockOnMinimize: config.hideDockOnMinimize ?? D.hideDockOnMinimize,
    traySpeedometer: config.traySpeedometer ?? D.traySpeedometer,
    lightweightMode: config.lightweightMode ?? D.lightweightMode,
  }
}

/**
 * General tab has NO aria2 engine keys — all config stays in the app store.
 * Returns an empty object so usePreferenceForm skips the save_system_config call.
 */
export function buildGeneralSystemConfig(_f: GeneralForm): Record<string, string> {
  return {}
}

/**
 * Transforms the general form for store persistence.
 * Pure passthrough — no field expansion or collapsing needed.
 */
export function transformGeneralForStore(f: GeneralForm): Partial<AppConfig> {
  return {
    ...f,
    theme: f.theme as AppConfig['theme'],
  } as Partial<AppConfig>
}
