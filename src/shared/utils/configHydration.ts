/** @fileoverview Centralized AppConfig hydration, migration, and repair. */
import {
  DEFAULT_APP_CONFIG,
  FILE_ALLOCATION_OPTIONS,
  APP_LOG_LEVELS,
  ARIA2_LOG_LEVELS,
  PROXY_SCOPE_OPTIONS,
  UPDATE_CHANNELS,
} from '@shared/constants'
import { getAllowedColorSchemeIds, normalizeCustomColorScheme } from '@shared/utils/colorSchemeConfig'
import { runMigrations, type MigrationResult } from '@shared/utils/configMigration'
import { normalizeProxyMode } from '@shared/utils/proxyPolicy'
import type { AppConfig, ClipboardConfig, PortConflictRecoveryConfig, ProxyConfig } from '@shared/types'
import { normalizeFileCategory } from '@shared/utils/fileCategory'
import {
  normalizeRecentUserAgentProfileIds,
  normalizeUserAgentProfiles,
  normalizeUserAgentRules,
} from '@shared/utils/userAgentPolicy'
import { DEFAULT_TASK_MANUAL_ORDER, type TaskManualOrderConfig } from '@/composables/useTaskSort'

export interface HydratedAppConfig {
  config: AppConfig
  migration: MigrationResult
  repairs: string[]
  shouldPersist: boolean
}

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function generateConfigSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const values = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(values, (value) => chars[value % chars.length]).join('')
}

export function createDefaultAppConfig(): AppConfig {
  const base = clonePlain(DEFAULT_APP_CONFIG)
  return {
    ...base,
    rpcSecret: generateConfigSecret(),
    extensionApiSecret: generateConfigSecret(),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAllowed<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && allowed.includes(value)
}

function repairEnum<T extends readonly string[]>(
  config: Record<string, unknown>,
  key: keyof AppConfig & string,
  allowed: T,
  fallback: string,
  repairs: string[],
): void {
  if (isAllowed(config[key], allowed)) return
  config[key] = fallback
  repairs.push(key)
}

function normalizePort(value: unknown, fallback: number, key: string, repairs: string[]): number {
  const port = Number(value)
  if (Number.isInteger(port) && port >= 0 && port <= 65535) return port
  repairs.push(key)
  return fallback
}

function isValidPort(value: unknown): boolean {
  const port = Number(value)
  return Number.isInteger(port) && port >= 0 && port <= 65535
}

function normalizePositiveNumber(value: unknown, fallback: number, key: string, repairs: string[]): number {
  const number = Number(value)
  if (Number.isFinite(number) && number >= 0) return number
  repairs.push(key)
  return fallback
}

function normalizeBoundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  key: string,
  repairs: string[],
): number {
  const number = Number(value)
  if (Number.isInteger(number) && number >= min && number <= max) return number
  repairs.push(key)
  return fallback
}

function normalizeProxy(value: unknown, repairs: string[]): ProxyConfig {
  const defaults = clonePlain(DEFAULT_APP_CONFIG.proxy)
  const saved = isRecord(value) ? value : {}
  const merged = { ...defaults, ...saved } as ProxyConfig
  const mode = normalizeProxyMode(merged.mode)

  if (mode !== merged.mode) {
    repairs.push('proxy.mode')
  }

  const scope = Array.isArray(merged.scope) ? merged.scope.filter((item) => PROXY_SCOPE_OPTIONS.includes(item)) : []
  if (scope.length !== (Array.isArray(merged.scope) ? merged.scope.length : 0)) {
    repairs.push('proxy.scope')
  }

  return {
    ...merged,
    mode,
    server: typeof merged.server === 'string' ? merged.server : defaults.server,
    username: typeof merged.username === 'string' ? merged.username : defaults.username,
    password: typeof merged.password === 'string' ? merged.password : defaults.password,
    bypass: typeof merged.bypass === 'string' ? merged.bypass : defaults.bypass,
    scope: scope.length ? scope : [...PROXY_SCOPE_OPTIONS],
  }
}

function normalizeClipboard(value: unknown): ClipboardConfig {
  const defaults = DEFAULT_APP_CONFIG.clipboard
  const saved = isRecord(value) ? value : {}
  return {
    enable: typeof saved.enable === 'boolean' ? saved.enable : defaults.enable,
    http: typeof saved.http === 'boolean' ? saved.http : defaults.http,
    ftp: typeof saved.ftp === 'boolean' ? saved.ftp : defaults.ftp,
    magnet: typeof saved.magnet === 'boolean' ? saved.magnet : defaults.magnet,
    ed2k: typeof saved.ed2k === 'boolean' ? saved.ed2k : defaults.ed2k,
    thunder: typeof saved.thunder === 'boolean' ? saved.thunder : defaults.thunder,
    btHash: typeof saved.btHash === 'boolean' ? saved.btHash : defaults.btHash,
  }
}

function normalizePortRecovery(value: unknown, repairs: string[]): PortConflictRecoveryConfig {
  const defaults = DEFAULT_APP_CONFIG.portConflictRecovery
  const saved = isRecord(value) ? value : {}
  const endpointsAreValid =
    (saved.rangeStart === undefined || isValidPort(saved.rangeStart)) &&
    (saved.rangeEnd === undefined || isValidPort(saved.rangeEnd))
  const rangeStart = normalizePort(saved.rangeStart, defaults.rangeStart, 'portConflictRecovery.range', repairs)
  const rangeEnd = normalizePort(saved.rangeEnd, defaults.rangeEnd, 'portConflictRecovery.range', repairs)
  const validRange = endpointsAreValid && rangeStart <= rangeEnd

  if (!validRange) {
    repairs.push('portConflictRecovery.range')
  }

  return {
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : defaults.enabled,
    rangeStart: validRange ? rangeStart : defaults.rangeStart,
    rangeEnd: validRange ? rangeEnd : defaults.rangeEnd,
    rpc: typeof saved.rpc === 'boolean' ? saved.rpc : defaults.rpc,
    extensionApi: typeof saved.extensionApi === 'boolean' ? saved.extensionApi : defaults.extensionApi,
    bt: typeof saved.bt === 'boolean' ? saved.bt : defaults.bt,
    dht: typeof saved.dht === 'boolean' ? saved.dht : defaults.dht,
    ed2k: typeof saved.ed2k === 'boolean' ? saved.ed2k : defaults.ed2k,
    ed2kUdp: typeof saved.ed2kUdp === 'boolean' ? saved.ed2kUdp : defaults.ed2kUdp,
  }
}

function normalizeTaskManualOrder(value: unknown, repairs: string[]): TaskManualOrderConfig {
  const saved = isRecord(value) ? value : {}
  const normalizeList = (key: keyof TaskManualOrderConfig): string[] => {
    const raw = saved[key]
    if (!Array.isArray(raw)) {
      if (raw !== undefined) repairs.push(`taskManualOrder.${key}`)
      return [...DEFAULT_TASK_MANUAL_ORDER[key]]
    }
    const result = raw.filter((item): item is string => typeof item === 'string' && item.length > 0)
    if (result.length !== raw.length) repairs.push(`taskManualOrder.${key}`)
    return Array.from(new Set(result))
  }

  return {
    active: normalizeList('active'),
    stopped: normalizeList('stopped'),
    all: normalizeList('all'),
  }
}

function normalizeScalarValues(config: Record<string, unknown>, repairs: string[]): void {
  repairEnum(config, 'theme', ['auto', 'light', 'dark'] as const, DEFAULT_APP_CONFIG.theme, repairs)
  repairEnum(config, 'taskCardMode', ['full', 'compact'] as const, DEFAULT_APP_CONFIG.taskCardMode, repairs)
  repairEnum(config, 'colorScheme', getAllowedColorSchemeIds(), DEFAULT_APP_CONFIG.colorScheme, repairs)
  const customColorScheme = normalizeCustomColorScheme(config.customColorScheme)
  if (config.customColorScheme !== customColorScheme) repairs.push('customColorScheme')
  config.customColorScheme = customColorScheme
  repairEnum(config, 'updateChannel', UPDATE_CHANNELS, DEFAULT_APP_CONFIG.updateChannel, repairs)
  repairEnum(config, 'logLevel', APP_LOG_LEVELS, DEFAULT_APP_CONFIG.logLevel, repairs)
  repairEnum(config, 'aria2LogLevel', ARIA2_LOG_LEVELS, DEFAULT_APP_CONFIG.aria2LogLevel, repairs)
  repairEnum(config, 'fileAllocation', FILE_ALLOCATION_OPTIONS, DEFAULT_APP_CONFIG.fileAllocation, repairs)

  config.rpcListenPort = normalizePort(config.rpcListenPort, DEFAULT_APP_CONFIG.rpcListenPort, 'rpcListenPort', repairs)
  config.extensionApiPort = normalizePort(
    config.extensionApiPort,
    DEFAULT_APP_CONFIG.extensionApiPort,
    'extensionApiPort',
    repairs,
  )
  config.listenPort = normalizePort(config.listenPort, DEFAULT_APP_CONFIG.listenPort, 'listenPort', repairs)
  config.dhtListenPort = normalizePort(config.dhtListenPort, DEFAULT_APP_CONFIG.dhtListenPort, 'dhtListenPort', repairs)
  config.ed2kListenPort = normalizePort(
    config.ed2kListenPort,
    DEFAULT_APP_CONFIG.ed2kListenPort,
    'ed2kListenPort',
    repairs,
  )
  config.ed2kUdpListenPort = normalizePort(
    config.ed2kUdpListenPort,
    DEFAULT_APP_CONFIG.ed2kUdpListenPort,
    'ed2kUdpListenPort',
    repairs,
  )

  config.split = normalizePositiveNumber(config.split, DEFAULT_APP_CONFIG.split, 'split', repairs)
  config.taskPageSize = normalizeBoundedInteger(
    config.taskPageSize,
    DEFAULT_APP_CONFIG.taskPageSize,
    1,
    100,
    'taskPageSize',
    repairs,
  )
  config.maxConcurrentDownloads = normalizePositiveNumber(
    config.maxConcurrentDownloads,
    DEFAULT_APP_CONFIG.maxConcurrentDownloads,
    'maxConcurrentDownloads',
    repairs,
  )
  config.maxConnectionPerServer = normalizePositiveNumber(
    config.maxConnectionPerServer,
    DEFAULT_APP_CONFIG.maxConnectionPerServer,
    'maxConnectionPerServer',
    repairs,
  )
  config.btMaxPeers = normalizePositiveNumber(config.btMaxPeers, DEFAULT_APP_CONFIG.btMaxPeers, 'btMaxPeers', repairs)
  config.btTrackerSyncIntervalHours = normalizePositiveNumber(
    config.btTrackerSyncIntervalHours,
    DEFAULT_APP_CONFIG.btTrackerSyncIntervalHours,
    'btTrackerSyncIntervalHours',
    repairs,
  )
  config.ed2kBootstrapSyncIntervalHours = normalizePositiveNumber(
    config.ed2kBootstrapSyncIntervalHours,
    DEFAULT_APP_CONFIG.ed2kBootstrapSyncIntervalHours,
    'ed2kBootstrapSyncIntervalHours',
    repairs,
  )
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

function normalizeUserAgentConfig(config: AppConfig, repairs: string[]): void {
  const profilesBefore = JSON.stringify(config.userAgentProfiles)
  const profiles = normalizeUserAgentProfiles(config.userAgentProfiles)
  config.userAgentProfiles = profiles
  if (JSON.stringify(profiles) !== profilesBefore) repairs.push('userAgentProfiles')

  const rulesBefore = JSON.stringify(config.userAgentRules)
  const rules = normalizeUserAgentRules(config.userAgentRules, profiles)
  config.userAgentRules = rules
  if (JSON.stringify(rules) !== rulesBefore) repairs.push('userAgentRules')

  const recentBefore = JSON.stringify(config.recentUserAgentProfileIds)
  const recent = normalizeRecentUserAgentProfileIds(config.recentUserAgentProfileIds, profiles)
  config.recentUserAgentProfileIds = recent
  if (JSON.stringify(recent) !== recentBefore) repairs.push('recentUserAgentProfileIds')
}

function normalizeSecrets(config: AppConfig, input: Partial<AppConfig> | null, repairs: string[]): void {
  if (!input || !('rpcSecret' in input) || config.rpcSecret == null) {
    config.rpcSecret = generateConfigSecret()
    repairs.push('rpcSecret')
  }
  if (!input || !('extensionApiSecret' in input) || config.extensionApiSecret == null) {
    config.extensionApiSecret = generateConfigSecret()
    repairs.push('extensionApiSecret')
  }
}

function normalizeFileCategories(config: AppConfig, repairs: string[]): void {
  const before = JSON.stringify(config.fileCategories)
  config.fileCategories = Array.isArray(config.fileCategories)
    ? config.fileCategories
        .filter((category): category is AppConfig['fileCategories'][number] => {
          if (!isRecord(category)) return false
          return (
            typeof category.label === 'string' &&
            Array.isArray(category.extensions) &&
            typeof category.directory === 'string'
          )
        })
        .map(normalizeFileCategory)
    : []
  if (JSON.stringify(config.fileCategories) !== before) repairs.push('fileCategories')
}

/**
 * Converts a partial persisted config into a complete, runtime-safe AppConfig.
 *
 * Migrations handle semantic schema changes. Hydration handles default
 * materialization and defensive repair for malformed persisted values.
 */
export function hydrateAppConfig(saved?: Partial<AppConfig> | null): HydratedAppConfig {
  const defaults = createDefaultAppConfig()
  const input = saved && isRecord(saved) ? (clonePlain(saved) as Partial<AppConfig>) : null
  const migration = input
    ? runMigrations(input)
    : { migrated: false, targetVersion: DEFAULT_APP_CONFIG.configVersion, errors: [] }
  const merged = { ...defaults, ...(input ?? {}) } as AppConfig
  const repairs: string[] = []
  const record = merged as Record<string, unknown>

  delete record.autoSelectAllMagnetFilesFromExtension
  delete record.autoSyncTracker
  delete record.protocols

  merged.proxy = normalizeProxy(input?.proxy ?? merged.proxy, repairs)
  merged.clipboard = normalizeClipboard(input?.clipboard ?? merged.clipboard)
  merged.portConflictRecovery = normalizePortRecovery(
    input?.portConflictRecovery ?? merged.portConflictRecovery,
    repairs,
  )
  merged.taskManualOrder = normalizeTaskManualOrder(input?.taskManualOrder ?? merged.taskManualOrder, repairs)

  normalizeScalarValues(record, repairs)
  normalizeSecrets(merged, input, repairs)
  normalizeFileCategories(merged, repairs)
  normalizeUserAgentConfig(merged, repairs)

  return {
    config: merged,
    migration,
    repairs: dedupe(repairs),
    shouldPersist: migration.migrated || repairs.length > 0,
  }
}
