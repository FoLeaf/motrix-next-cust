/**
 * @fileoverview Tests for useBtPreference pure functions.
 *
 * The BT tab manages BitTorrent-specific config: auto-download, encryption,
 * connection, discovery, seeding, max peers, and tracker management. Key business logic:
 * - btAutoDownloadContent ↔ pauseMetadata mapping
 * - Tracker comma ↔ newline conversion
 * - force-save must NOT appear in global config (per-download only)
 */
import { describe, it, expect } from 'vitest'
import {
  buildBtForm,
  buildBtSystemConfig,
  transformBtForStore,
  validateBtEndpoint,
  randomBtPort,
  randomDhtPort,
  type BtForm,
} from '../useBtPreference'
import type { AppConfig } from '@shared/types'
import { createDefaultAppConfig } from '@shared/utils/configHydration'
import { DEFAULT_APP_CONFIG, ENGINE_DEFAULT_BT_MAX_PEERS } from '@shared/constants'

// ── buildBtForm ─────────────────────────────────────────────────────

describe('buildBtForm', () => {
  const emptyConfig = {} as AppConfig

  // ── btAutoDownloadContent toggle ────────────────────────────────

  it('defaults btAutoDownloadContent to false (pause-metadata=true for file selection)', () => {
    const form = buildBtForm(emptyConfig)
    expect(form.btAutoDownloadContent).toBe(false)
  })

  it('sets btAutoDownloadContent=true when pauseMetadata=false', () => {
    const form = buildBtForm({
      pauseMetadata: false,
    } as unknown as AppConfig)
    expect(form.btAutoDownloadContent).toBe(true)
  })

  it('sets btAutoDownloadContent=false when pauseMetadata=true', () => {
    const form = buildBtForm({
      pauseMetadata: true,
    } as unknown as AppConfig)
    expect(form.btAutoDownloadContent).toBe(false)
  })

  // ── BT settings ────────────────────────────────────────────────

  it('defaults btForceEncryption to false', () => {
    const form = buildBtForm(emptyConfig)
    expect(form.btForceEncryption).toBe(false)
  })

  it('defaults BT discovery toggles to enabled', () => {
    const form = buildBtForm(emptyConfig)
    expect(form.btDhtIpv4Enabled).toBe(true)
    expect(form.btDhtIpv6Enabled).toBe(true)
    expect(form.btPeerExchangeEnabled).toBe(true)
    expect(form.btLocalPeerDiscoveryEnabled).toBe(true)
  })

  it('reads BT discovery toggles from config', () => {
    const form = buildBtForm({
      btDhtIpv4Enabled: false,
      btDhtIpv6Enabled: true,
      btPeerExchangeEnabled: false,
      btLocalPeerDiscoveryEnabled: false,
    } as unknown as AppConfig)
    expect(form.btDhtIpv4Enabled).toBe(false)
    expect(form.btDhtIpv6Enabled).toBe(true)
    expect(form.btPeerExchangeEnabled).toBe(false)
    expect(form.btLocalPeerDiscoveryEnabled).toBe(false)
  })

  it('reads btForceEncryption from config', () => {
    const form = buildBtForm({ btForceEncryption: true } as unknown as AppConfig)
    expect(form.btForceEncryption).toBe(true)
  })

  it('defaults btMaxPeers to ENGINE_DEFAULT_BT_MAX_PEERS', () => {
    const form = buildBtForm(emptyConfig)
    expect(form.btMaxPeers).toBe(ENGINE_DEFAULT_BT_MAX_PEERS)
  })

  it('DEFAULT_APP_CONFIG.btMaxPeers matches ENGINE_DEFAULT_BT_MAX_PEERS', () => {
    expect(DEFAULT_APP_CONFIG.btMaxPeers).toBe(ENGINE_DEFAULT_BT_MAX_PEERS)
  })

  it('owns the BitTorrent connection and seeding defaults', () => {
    const form = buildBtForm(emptyConfig)
    expect(form.listenPort).toBe(DEFAULT_APP_CONFIG.listenPort)
    expect(form.btExternalIp).toBe('')
    expect(form.btExternalPort).toBe(0)
    expect(form.dhtListenPort).toBe(DEFAULT_APP_CONFIG.dhtListenPort)
    expect(form.sharingMode).toBe('stop-by-condition')
    expect(form.shareRatio).toBe(DEFAULT_APP_CONFIG.shareRatio)
    expect(form.shareTime).toBe(DEFAULT_APP_CONFIG.shareTime)
  })

  it('maps keepSharing=true to manual stop mode', () => {
    const form = buildBtForm({ keepSharing: true } as AppConfig)
    expect(form.sharingMode).toBe('manual-stop')
  })

  // ── Tracker management ──────────────────────────────────────────

  it('defaults trackerSource from DEFAULT_APP_CONFIG', () => {
    const form = buildBtForm(emptyConfig)
    expect(form.trackerSource).toEqual(DEFAULT_APP_CONFIG.trackerSource)
    expect(form.trackerSource).toHaveLength(2)
  })

  it('preserves custom tracker source URLs', () => {
    const customUrl = 'https://trackers.run/s/wp_up_hp_hs_v4_v6.txt'
    const config = {
      ...createDefaultAppConfig(),
      trackerSource: [customUrl],
    } as AppConfig
    const form = buildBtForm(config)
    expect(form.trackerSource).toContain(customUrl)
  })

  it('preserves customTrackerUrls from config', () => {
    const urls = ['https://my-tracker.example.com/list.txt']
    const config = { customTrackerUrls: urls } as unknown as AppConfig
    const form = buildBtForm(config)
    expect(form.customTrackerUrls).toEqual(urls)
  })

  it('converts comma-separated trackers to newline format', () => {
    const config = { btTracker: 'udp://t1.org:6969,udp://t2.org:6969' } as AppConfig
    const form = buildBtForm(config)
    expect(form.btTracker).toContain('\n')
    expect(form.btTracker).toContain('udp://t1.org:6969')
    expect(form.btTracker).toContain('udp://t2.org:6969')
  })

  it('defaults automatic tracker sync from DEFAULT_APP_CONFIG', () => {
    const form = buildBtForm(emptyConfig)
    expect(form.btTrackerAutoSync).toBe(DEFAULT_APP_CONFIG.btTrackerAutoSync)
    expect(form.btTrackerSyncIntervalHours).toBe(DEFAULT_APP_CONFIG.btTrackerSyncIntervalHours)
  })

  // ── Completeness ────────────────────────────────────────────────

  it('returns every BT form field', () => {
    const form = buildBtForm(emptyConfig)
    const expectedFields = [
      'btAutoDownloadContent',
      'btForceEncryption',
      'btDhtIpv4Enabled',
      'btDhtIpv6Enabled',
      'btPeerExchangeEnabled',
      'btLocalPeerDiscoveryEnabled',
      'btMaxPeers',
      'listenPort',
      'btExternalIp',
      'btExternalPort',
      'dhtListenPort',
      'sharingMode',
      'shareRatio',
      'shareTime',
      'btPeerBlocklistEnabled',
      'btPeerBlocklistUrl',
      'btPeerBlocklistAutoSync',
      'btPeerBlocklistSyncIntervalHours',
      'trackerSource',
      'customTrackerUrls',
      'btTracker',
      'btTrackerAutoSync',
      'btTrackerSyncIntervalHours',
      'lastSyncTrackerTime',
    ]
    for (const field of expectedFields) {
      expect(form).toHaveProperty(field)
    }
    expect(Object.keys(form)).toHaveLength(expectedFields.length)
  })
})

// ── buildBtSystemConfig ─────────────────────────────────────────────

describe('buildBtSystemConfig', () => {
  const baseForm: BtForm = {
    btAutoDownloadContent: true,
    btForceEncryption: false,
    btDhtIpv4Enabled: true,
    btDhtIpv6Enabled: true,
    btPeerExchangeEnabled: true,
    btLocalPeerDiscoveryEnabled: true,
    btMaxPeers: 128,
    listenPort: 29120,
    btExternalIp: '',
    btExternalPort: 0,
    dhtListenPort: 29130,
    sharingMode: 'stop-by-condition',
    shareRatio: 2,
    shareTime: 2880,
    btPeerBlocklistEnabled: true,
    btPeerBlocklistUrl: 'https://bcr.pbh-btn.com/combine/all.txt',
    btPeerBlocklistAutoSync: true,
    btPeerBlocklistSyncIntervalHours: 24,
    trackerSource: [],
    customTrackerUrls: [],
    btTracker: 'udp://t1.org:6969\nudp://t2.org:6969',
    btTrackerAutoSync: false,
    btTrackerSyncIntervalHours: 12,
    lastSyncTrackerTime: 0,
  }

  it('maps BT-specific keys to aria2 config', () => {
    const config = buildBtSystemConfig(baseForm)
    expect(config['bt-max-peers']).toBe('128')
    expect(config['bt-force-encryption']).toBe('false')
    expect(config['listen-port']).toBe('29120')
    expect(config['bt-external-ip']).toBe('')
    expect(config['bt-external-port']).toBe('0')
    expect(config['dht-listen-port']).toBe('29130')
  })

  it('maps BT discovery toggles to aria2 config', () => {
    const config = buildBtSystemConfig({
      ...baseForm,
      btDhtIpv4Enabled: false,
      btDhtIpv6Enabled: false,
      btPeerExchangeEnabled: false,
      btLocalPeerDiscoveryEnabled: false,
    })
    expect(config['enable-dht']).toBe('false')
    expect(config['enable-dht6']).toBe('false')
    expect(config['enable-peer-exchange']).toBe('false')
    expect(config['bt-enable-lpd']).toBe('false')
  })

  it('maps DHT network checkboxes to aria2 IPv4 and IPv6 switches', () => {
    const config = buildBtSystemConfig({
      ...baseForm,
      btDhtIpv4Enabled: true,
      btDhtIpv6Enabled: false,
    })
    expect(config['enable-dht']).toBe('true')
    expect(config['enable-dht6']).toBe('false')
  })

  it('maps condition-based seeding to aria2 config', () => {
    const config = buildBtSystemConfig({ ...baseForm, shareRatio: 3, shareTime: 1440 })
    expect(config['detach-share-only']).toBe('true')
    expect(config['keep-sharing']).toBe('false')
    expect(config['seed-ratio']).toBe('3')
    expect(config['seed-time']).toBe('1440')
  })

  it('maps manual seeding to aria2 config', () => {
    const config = buildBtSystemConfig({ ...baseForm, sharingMode: 'manual-stop' })
    expect(config['keep-sharing']).toBe('true')
    expect(config['seed-ratio']).toBe('0')
    expect(config['seed-time']).toBe('')
  })

  it('mirrors force encryption into both aria2 encryption switches', () => {
    const config = buildBtSystemConfig({ ...baseForm, btForceEncryption: true })
    expect(config['bt-force-encryption']).toBe('true')
    expect(config['bt-require-crypto']).toBe('true')
  })

  it('sets pause-metadata=false when auto-content ON', () => {
    const config = buildBtSystemConfig({ ...baseForm, btAutoDownloadContent: true })
    expect(config['pause-metadata']).toBe('false')
  })

  it('sets pause-metadata=true when auto-content OFF', () => {
    const config = buildBtSystemConfig({ ...baseForm, btAutoDownloadContent: false })
    expect(config['pause-metadata']).toBe('true')
  })

  it('converts newline trackers to comma-separated', () => {
    const config = buildBtSystemConfig(baseForm)
    expect(config['bt-tracker']).toBe('udp://t1.org:6969,udp://t2.org:6969')
  })

  // ── force-save isolation ────────────────────────────────────────
  // aria2's SessionSerializer.cc:288 saves FINISHED tasks only when
  // force-save=true is set per-download. Setting it globally causes
  // ALL completed downloads to persist and re-download on restart.

  it('does NOT include force-save in global system config', () => {
    const config = buildBtSystemConfig(baseForm)
    expect(config).not.toHaveProperty('force-save')
  })

  it('keeps magnet metadata cache options managed by aria2.conf only', () => {
    const config = buildBtSystemConfig(baseForm)
    expect(config).not.toHaveProperty('bt-save-metadata')
    expect(config).not.toHaveProperty('bt-load-saved-metadata')
    expect(config).not.toHaveProperty('bt-seed-unverified')
    expect(config).not.toHaveProperty('bt-hash-check-seed')
    expect(config).not.toHaveProperty('bt-remove-unselected-file')
  })

  // ── Boundary: tracker/sync keys must NOT leak into aria2 config ─

  it('does NOT include tracker management keys in aria2 config', () => {
    const config = buildBtSystemConfig(baseForm)
    expect(config).not.toHaveProperty('trackerSource')
    expect(config).not.toHaveProperty('customTrackerUrls')
    expect(config).not.toHaveProperty('autoSyncTracker')
    expect(config).not.toHaveProperty('lastSyncTrackerTime')
  })
})

// ── transformBtForStore ─────────────────────────────────────────────

describe('transformBtForStore', () => {
  const baseForm: BtForm = {
    btAutoDownloadContent: true,
    btForceEncryption: false,
    btDhtIpv4Enabled: true,
    btDhtIpv6Enabled: true,
    btPeerExchangeEnabled: true,
    btLocalPeerDiscoveryEnabled: true,
    btMaxPeers: 128,
    listenPort: 29120,
    btExternalIp: '',
    btExternalPort: 0,
    dhtListenPort: 29130,
    sharingMode: 'stop-by-condition',
    shareRatio: 2,
    shareTime: 2880,
    btPeerBlocklistEnabled: true,
    btPeerBlocklistUrl: 'https://bcr.pbh-btn.com/combine/all.txt',
    btPeerBlocklistAutoSync: true,
    btPeerBlocklistSyncIntervalHours: 24,
    trackerSource: [],
    customTrackerUrls: [],
    btTracker: 'udp://a\nudp://b',
    btTrackerAutoSync: false,
    btTrackerSyncIntervalHours: 12,
    lastSyncTrackerTime: 0,
  }

  it('expands btAutoDownloadContent=true into pauseMetadata=false', () => {
    const result = transformBtForStore({ ...baseForm, btAutoDownloadContent: true })
    expect(result.pauseMetadata).toBe(false)
    expect((result as Record<string, unknown>).btAutoDownloadContent).toBeUndefined()
  })

  it('expands btAutoDownloadContent=false into pauseMetadata=true', () => {
    const result = transformBtForStore({ ...baseForm, btAutoDownloadContent: false })
    expect(result.pauseMetadata).toBe(true)
    expect((result as Record<string, unknown>).btAutoDownloadContent).toBeUndefined()
  })

  it('removes btAutoDownloadContent from output', () => {
    const result = transformBtForStore(baseForm)
    expect('btAutoDownloadContent' in result).toBe(false)
  })

  it('converts newline trackers back to comma format', () => {
    const result = transformBtForStore(baseForm)
    expect(result.btTracker).toBe('udp://a,udp://b')
  })

  it('preserves tracker source arrays through transform', () => {
    const customSources = ['https://trackers.example.com/list.txt']
    const result = transformBtForStore({
      ...baseForm,
      trackerSource: customSources,
      customTrackerUrls: customSources,
    })
    expect(result.trackerSource).toEqual(customSources)
    expect(result.customTrackerUrls).toEqual(customSources)
  })

  it('preserves BT discovery toggles through transform', () => {
    const result = transformBtForStore({
      ...baseForm,
      btDhtIpv4Enabled: false,
      btDhtIpv6Enabled: true,
      btPeerExchangeEnabled: false,
      btLocalPeerDiscoveryEnabled: false,
    })
    expect(result.btDhtIpv4Enabled).toBe(false)
    expect(result.btDhtIpv6Enabled).toBe(true)
    expect(result.btPeerExchangeEnabled).toBe(false)
    expect(result.btLocalPeerDiscoveryEnabled).toBe(false)
  })

  it('persists BitTorrent seeding config with app-level naming', () => {
    const result = transformBtForStore({ ...baseForm, sharingMode: 'manual-stop', shareRatio: 4, shareTime: 720 })
    expect(result.keepSharing).toBe(true)
    expect(result.shareRatio).toBe(4)
    expect(result.shareTime).toBe(720)
    expect(result).not.toHaveProperty('sharingMode')
  })
})

describe('validateBtEndpoint', () => {
  const form = buildBtForm({} as AppConfig)

  it('accepts the default endpoint', () => {
    expect(validateBtEndpoint(form)).toBeNull()
  })

  it('rejects invalid listen ports', () => {
    expect(validateBtEndpoint({ ...form, listenPort: 80 })).toBe('preferences.bt-port-unavailable')
    expect(validateBtEndpoint({ ...form, dhtListenPort: 65536 })).toBe('preferences.dht-port-invalid')
  })

  it('rejects invalid external endpoint values', () => {
    expect(validateBtEndpoint({ ...form, btExternalIp: 'tracker.example.com' })).toBe(
      'preferences.bt-external-ip-invalid',
    )
    expect(validateBtEndpoint({ ...form, btExternalPort: 65536 })).toBe('preferences.bt-external-port-invalid')
  })
})

describe('BitTorrent port randomizers', () => {
  it('stay within the configured recovery range', () => {
    for (let i = 0; i < 20; i++) {
      expect(randomBtPort()).toBeGreaterThanOrEqual(29000)
      expect(randomBtPort()).toBeLessThanOrEqual(29999)
      expect(randomDhtPort()).toBeGreaterThanOrEqual(29000)
      expect(randomDhtPort()).toBeLessThanOrEqual(29999)
    }
  })
})
