/**
 * @fileoverview Tests for useDownloadsPreference pure functions.
 *
 * The Downloads tab is the core download-experience config: paths, concurrency,
 * retry, speed limits, notifications, and auto-cleanup. Most fields here map
 * directly to aria2 engine options via buildDownloadsSystemConfig.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  buildDownloadsForm,
  buildDownloadsSystemConfig,
  getCompletedRecordRetentionSelectValue,
  recordDownloadsDirectory,
  resolveCompletedRecordRetentionDays,
  transformDownloadsForStore,
  type DownloadsForm,
} from '../useDownloadsPreference'
import type { AppConfig } from '@shared/types'
import {
  DEFAULT_APP_CONFIG,
  buildDefaultCategories,
  ENGINE_DEFAULT_CONNECTION_PER_SERVER,
  ENGINE_DEFAULT_SPLIT,
} from '@shared/constants'

// ── buildDownloadsForm ──────────────────────────────────────────────

describe('buildDownloadsForm', () => {
  const emptyConfig = {} as AppConfig

  // ── Download Paths ──────────────────────────────────────────────

  it('uses defaultDir when config.dir is empty', () => {
    const form = buildDownloadsForm(emptyConfig, '~/Downloads')
    expect(form.dir).toBe('~/Downloads')
  })

  it('prefers config.dir over defaultDir', () => {
    const form = buildDownloadsForm({ dir: '/custom' } as AppConfig, '~/Downloads')
    expect(form.dir).toBe('/custom')
  })

  it('defaults fileCategoryEnabled from DEFAULT_APP_CONFIG', () => {
    const form = buildDownloadsForm(emptyConfig)
    expect(form.fileCategoryEnabled).toBe(DEFAULT_APP_CONFIG.fileCategoryEnabled)
  })

  it('builds default categories when none present in config', () => {
    const form = buildDownloadsForm(emptyConfig, '/dl')
    expect(form.fileCategories.length).toBeGreaterThan(0)
    // Every category should have a non-empty directory
    for (const cat of form.fileCategories) {
      expect(cat.directory).toBeTruthy()
    }
  })

  it('hydrates existing categories with missing directories', () => {
    const config = {
      dir: '/dl',
      fileCategories: [
        { label: 'Videos', extensions: ['mp4', 'mkv'] },
        { label: 'Custom', extensions: ['xyz'] },
      ],
    } as unknown as AppConfig
    const form = buildDownloadsForm(config)
    // Each category must have a directory after hydration
    for (const cat of form.fileCategories) {
      expect(cat.directory).toBeTruthy()
    }
  })

  // ── Task Management ─────────────────────────────────────────────

  it('defaults maxConcurrentDownloads to 6', () => {
    const form = buildDownloadsForm(emptyConfig)
    expect(form.maxConcurrentDownloads).toBe(6)
  })

  it('defaults split to ENGINE_DEFAULT_SPLIT', () => {
    const form = buildDownloadsForm(emptyConfig)
    expect(form.split).toBe(ENGINE_DEFAULT_SPLIT)
  })

  it('defaults maxConnectionPerServer to ENGINE_DEFAULT_CONNECTION_PER_SERVER', () => {
    const form = buildDownloadsForm(emptyConfig)
    expect(form.maxConnectionPerServer).toBe(ENGINE_DEFAULT_CONNECTION_PER_SERVER)
  })

  it('defaults continue to true', () => {
    const form = buildDownloadsForm(emptyConfig)
    expect(form.continue).toBe(true)
  })

  // ── Retry ───────────────────────────────────────────────────────

  it('defaults maxTries to 0 (unlimited retries)', () => {
    const form = buildDownloadsForm(emptyConfig)
    expect(form.maxTries).toBe(0)
  })

  it('defaults retryWait to 10 seconds', () => {
    const form = buildDownloadsForm(emptyConfig)
    expect(form.retryWait).toBe(10)
  })

  it('reads maxTries from config when set', () => {
    const form = buildDownloadsForm({ maxTries: 5 } as unknown as AppConfig)
    expect(form.maxTries).toBe(5)
  })

  it('reads retryWait from config when set', () => {
    const form = buildDownloadsForm({ retryWait: 30 } as unknown as AppConfig)
    expect(form.retryWait).toBe(30)
  })

  it('defaults remoteTime from DEFAULT_APP_CONFIG', () => {
    const form = buildDownloadsForm(emptyConfig)
    expect(form.remoteTime).toBe(DEFAULT_APP_CONFIG.remoteTime)
    // Sanity: new default is false (download date) to match aria2 upstream default
    expect(form.remoteTime).toBe(false)
  })

  // ── Speed Limits ────────────────────────────────────────────────

  it('formats speed limits as strings', () => {
    const form = buildDownloadsForm({
      maxOverallDownloadLimit: 1024,
      maxOverallUploadLimit: 512,
    } as unknown as AppConfig)
    expect(form.maxOverallDownloadLimit).toBe('1024')
    expect(form.maxOverallUploadLimit).toBe('512')
  })

  it('defaults speedScheduleEnabled to false', () => {
    const form = buildDownloadsForm(emptyConfig)
    expect(form.speedScheduleEnabled).toBe(false)
  })

  // ── Notifications & Automation ──────────────────────────────────

  it('defaults taskNotification to true', () => {
    const form = buildDownloadsForm(emptyConfig)
    expect(form.taskNotification).toBe(true)
  })

  it('defaults newTaskShowDownloading from DEFAULT_APP_CONFIG', () => {
    const form = buildDownloadsForm(emptyConfig)
    expect(form.newTaskShowDownloading).toBe(DEFAULT_APP_CONFIG.newTaskShowDownloading)
  })

  it('defaults shutdownWhenComplete to false', () => {
    const form = buildDownloadsForm(emptyConfig)
    expect(form.shutdownWhenComplete).toBe(false)
  })

  it('reads shutdownWhenComplete from config when set', () => {
    const form = buildDownloadsForm({ shutdownWhenComplete: true } as unknown as AppConfig)
    expect(form.shutdownWhenComplete).toBe(true)
  })

  it('defaults keepAwake to false', () => {
    const form = buildDownloadsForm(emptyConfig)
    expect(form.keepAwake).toBe(false)
  })

  it('reads keepAwake from config when set', () => {
    const form = buildDownloadsForm({ keepAwake: true } as unknown as AppConfig)
    expect(form.keepAwake).toBe(true)
  })

  // ── Auto Cleanup ────────────────────────────────────────────────

  it('defaults deleteTorrentAfterComplete to false', () => {
    const form = buildDownloadsForm(emptyConfig)
    expect(form.deleteTorrentAfterComplete).toBe(false)
  })

  it('defaults autoDeleteStaleRecords to false', () => {
    const form = buildDownloadsForm(emptyConfig)
    expect(form.autoDeleteStaleRecords).toBe(false)
  })

  it('defaults clearCompletedOnExit to false', () => {
    const form = buildDownloadsForm(emptyConfig)
    expect(form.clearCompletedOnExit).toBe(false)
  })

  it('defaults completedRecordRetentionDays to forever', () => {
    const form = buildDownloadsForm(emptyConfig)
    expect(form.completedRecordRetentionDays).toBe(0)
  })

  it('reads completedRecordRetentionDays from config when set', () => {
    const form = buildDownloadsForm({ completedRecordRetentionDays: 180 } as unknown as AppConfig)
    expect(form.completedRecordRetentionDays).toBe(180)
  })

  // ── Completeness ────────────────────────────────────────────────

  it('returns every form field', () => {
    const form = buildDownloadsForm(emptyConfig)
    const expectedFields = [
      'dir',
      'fileCategoryEnabled',
      'fileCategories',
      'maxConcurrentDownloads',
      'split',
      'maxConnectionPerServer',
      'continue',
      'maxTries',
      'retryWait',
      'remoteTime',
      'maxOverallDownloadLimit',
      'maxOverallUploadLimit',
      'speedScheduleEnabled',
      'speedScheduleFrom',
      'speedScheduleTo',
      'speedScheduleDays',
      'newTaskShowDownloading',
      'noConfirmBeforeDeleteTask',
      'fileDeletionMode',
      'deleteFilesWhenSkipConfirm',
      'taskNotification',
      'notifyOnStart',
      'notifyOnComplete',
      'shutdownWhenComplete',
      'keepAwake',
      'deleteTorrentAfterComplete',
      'autoDeleteStaleRecords',
      'clearCompletedOnExit',
      'completedRecordRetentionDays',
    ]
    for (const field of expectedFields) {
      expect(form).toHaveProperty(field)
    }
    expect(Object.keys(form)).toHaveLength(expectedFields.length)
  })
})

// ── buildDownloadsSystemConfig ──────────────────────────────────────

describe('buildDownloadsSystemConfig', () => {
  const baseForm: DownloadsForm = {
    dir: '/downloads',
    fileCategoryEnabled: false,
    fileCategories: buildDefaultCategories('/downloads'),
    maxConcurrentDownloads: 5,
    maxConnectionPerServer: 64,
    split: 64,
    continue: true,
    maxTries: 0,
    retryWait: 10,
    remoteTime: true,
    maxOverallDownloadLimit: '0',
    maxOverallUploadLimit: '0',
    speedScheduleEnabled: false,
    speedScheduleFrom: '08:00',
    speedScheduleTo: '18:00',
    speedScheduleDays: 0,
    newTaskShowDownloading: true,
    noConfirmBeforeDeleteTask: false,
    fileDeletionMode: 'trash',
    deleteFilesWhenSkipConfirm: false,
    taskNotification: true,
    notifyOnStart: true,
    notifyOnComplete: true,
    shutdownWhenComplete: false,
    keepAwake: false,
    deleteTorrentAfterComplete: false,
    autoDeleteStaleRecords: false,
    clearCompletedOnExit: false,
    completedRecordRetentionDays: 0,
  }

  it('maps dir to aria2 config', () => {
    const config = buildDownloadsSystemConfig(baseForm)
    expect(config.dir).toBe('/downloads')
  })

  it('maps concurrency keys to aria2 config', () => {
    const config = buildDownloadsSystemConfig(baseForm)
    expect(config['max-concurrent-downloads']).toBe('5')
    expect(config['max-connection-per-server']).toBe('64')
    expect(config.split).toBe('64')
  })

  it('emits split independently from maxConnectionPerServer', () => {
    const config = buildDownloadsSystemConfig({ ...baseForm, maxConnectionPerServer: 32, split: 128 })
    expect(config.split).toBe('128')
    expect(config['max-connection-per-server']).toBe('32')
  })

  it('maps continue to aria2 config', () => {
    const config = buildDownloadsSystemConfig(baseForm)
    expect(config.continue).toBe('true')
  })

  it('maps continue=false correctly', () => {
    const config = buildDownloadsSystemConfig({ ...baseForm, continue: false })
    expect(config.continue).toBe('false')
  })

  it('maps retry keys to aria2 config', () => {
    const config = buildDownloadsSystemConfig(baseForm)
    expect(config['max-tries']).toBe('0')
    expect(config['retry-wait']).toBe('10')
  })

  it('emits custom max-tries and retry-wait values', () => {
    const config = buildDownloadsSystemConfig({ ...baseForm, maxTries: 5, retryWait: 30 })
    expect(config['max-tries']).toBe('5')
    expect(config['retry-wait']).toBe('30')
  })

  it('maps remote-time to aria2 config', () => {
    const config = buildDownloadsSystemConfig(baseForm)
    expect(config['remote-time']).toBe('true')
  })

  it('maps remote-time=false correctly', () => {
    const config = buildDownloadsSystemConfig({ ...baseForm, remoteTime: false })
    expect(config['remote-time']).toBe('false')
  })

  it('maps speed limits to aria2 config', () => {
    const config = buildDownloadsSystemConfig(baseForm)
    expect(config['max-overall-download-limit']).toBe('0')
    expect(config['max-overall-upload-limit']).toBe('0')
  })

  it('emits custom speed limits', () => {
    const config = buildDownloadsSystemConfig({
      ...baseForm,
      maxOverallDownloadLimit: '1048576',
      maxOverallUploadLimit: '524288',
    })
    expect(config['max-overall-download-limit']).toBe('1048576')
    expect(config['max-overall-upload-limit']).toBe('524288')
  })

  // ── Boundary: app-only keys must NOT leak into aria2 config ─────

  it('does NOT include notification keys in aria2 config', () => {
    const config = buildDownloadsSystemConfig(baseForm)
    expect(config).not.toHaveProperty('taskNotification')
    expect(config).not.toHaveProperty('notifyOnStart')
    expect(config).not.toHaveProperty('notifyOnComplete')
    expect(config).not.toHaveProperty('newTaskShowDownloading')
    expect(config).not.toHaveProperty('shutdownWhenComplete')
  })

  it('does NOT include cleanup keys in aria2 config', () => {
    const config = buildDownloadsSystemConfig(baseForm)
    expect(config).not.toHaveProperty('deleteTorrentAfterComplete')
    expect(config).not.toHaveProperty('autoDeleteStaleRecords')
    expect(config).not.toHaveProperty('clearCompletedOnExit')
    expect(config).not.toHaveProperty('completedRecordRetentionDays')
  })

  it('does NOT include file category keys in aria2 config', () => {
    const config = buildDownloadsSystemConfig(baseForm)
    expect(config).not.toHaveProperty('fileCategoryEnabled')
    expect(config).not.toHaveProperty('fileCategories')
  })
})

// ── transformDownloadsForStore ──────────────────────────────────────

describe('transformDownloadsForStore', () => {
  const baseForm: DownloadsForm = {
    dir: '/dl',
    fileCategoryEnabled: false,
    fileCategories: buildDefaultCategories('/dl'),
    maxConcurrentDownloads: 5,
    maxConnectionPerServer: 16,
    split: 16,
    continue: true,
    maxTries: 0,
    retryWait: 10,
    remoteTime: true,
    maxOverallDownloadLimit: '0',
    maxOverallUploadLimit: '0',
    speedScheduleEnabled: false,
    speedScheduleFrom: '08:00',
    speedScheduleTo: '18:00',
    speedScheduleDays: 0,
    newTaskShowDownloading: true,
    noConfirmBeforeDeleteTask: false,
    fileDeletionMode: 'trash',
    deleteFilesWhenSkipConfirm: false,
    taskNotification: true,
    notifyOnStart: true,
    notifyOnComplete: true,
    shutdownWhenComplete: false,
    keepAwake: false,
    deleteTorrentAfterComplete: false,
    autoDeleteStaleRecords: false,
    clearCompletedOnExit: false,
    completedRecordRetentionDays: 0,
  }

  it('persists split independently from maxConnectionPerServer', () => {
    const result = transformDownloadsForStore({ ...baseForm, maxConnectionPerServer: 32, split: 128 })
    expect(result.split).toBe(128)
    expect(result.maxConnectionPerServer).toBe(32)
  })

  it('does not set engineMaxConnectionPerServer (removed in v2)', () => {
    const result = transformDownloadsForStore({ ...baseForm, maxConnectionPerServer: 32 })
    expect((result as Record<string, unknown>).engineMaxConnectionPerServer).toBeUndefined()
  })

  it('preserves shutdownWhenComplete through transform', () => {
    const result = transformDownloadsForStore({ ...baseForm, shutdownWhenComplete: true })
    expect(result.shutdownWhenComplete).toBe(true)
  })

  it('preserves maxTries and retryWait through transform', () => {
    const result = transformDownloadsForStore({ ...baseForm, maxTries: 5, retryWait: 30 })
    expect(result.maxTries).toBe(5)
    expect(result.retryWait).toBe(30)
  })

  it('auto-populates default categories when enabled but empty', () => {
    const result = transformDownloadsForStore({
      ...baseForm,
      fileCategoryEnabled: true,
      fileCategories: [],
    })
    expect(result.fileCategories).toBeDefined()
    expect((result.fileCategories as unknown[]).length).toBeGreaterThan(0)
  })

  it('preserves existing categories when enabled and non-empty', () => {
    const customCategories = [{ label: 'Custom', extensions: ['xyz'], directory: '/dl/custom', builtIn: false }]
    const result = transformDownloadsForStore({
      ...baseForm,
      fileCategoryEnabled: true,
      fileCategories: customCategories,
    })
    expect(result.fileCategories).toEqual([
      {
        ...customCategories[0],
        urlPatterns: [],
        urlPatternMode: 'wildcard',
      },
    ])
  })

  it('preserves dir through transform', () => {
    const result = transformDownloadsForStore({ ...baseForm, dir: '/custom/path' })
    expect(result.dir).toBe('/custom/path')
  })

  it('preserves completedRecordRetentionDays through transform', () => {
    const result = transformDownloadsForStore({ ...baseForm, completedRecordRetentionDays: 365 })
    expect(result.completedRecordRetentionDays).toBe(365)
  })
})

// ── completed record retention select ───────────────────────────────

describe('completed record retention select helpers', () => {
  it('maps preset day counts to themselves', () => {
    expect(getCompletedRecordRetentionSelectValue(1)).toBe(1)
    expect(getCompletedRecordRetentionSelectValue(7)).toBe(7)
  })

  it('maps custom day counts to the custom option', () => {
    expect(getCompletedRecordRetentionSelectValue(30)).toBe(-1)
  })

  it('keeps the previous positive day count when switching from a preset to custom', () => {
    expect(resolveCompletedRecordRetentionDays(-1, 7)).toBe(7)
  })

  it('uses 30 days when switching from forever to custom', () => {
    expect(resolveCompletedRecordRetentionDays(-1, 0)).toBe(30)
  })
})

// ── recordDownloadsDirectory ───────────────────────────────────────

describe('recordDownloadsDirectory', () => {
  it('records a saved default download directory in the shared directory history', () => {
    const record = vi.fn()

    recordDownloadsDirectory({ dir: '/Users/test/Downloads' } as DownloadsForm, record)

    expect(record).toHaveBeenCalledWith('/Users/test/Downloads')
  })

  it('trims the saved directory before recording it', () => {
    const record = vi.fn()

    recordDownloadsDirectory({ dir: '  /Users/test/Downloads  ' } as DownloadsForm, record)

    expect(record).toHaveBeenCalledWith('/Users/test/Downloads')
  })

  it('does not record an empty directory', () => {
    const record = vi.fn()

    recordDownloadsDirectory({ dir: '   ' } as DownloadsForm, record)

    expect(record).not.toHaveBeenCalled()
  })
})
