/**
 * @fileoverview Tests for useNetworkPreference pure functions.
 *
 * The Network tab manages proxy, port mapping, transfer parameters (timeouts,
 * file allocation), and User-Agent. All keys here map to aria2 engine options
 * via buildNetworkSystemConfig.
 *
 * Proxy validation logic is covered here with the form transformations.
 */
import { describe, it, expect } from 'vitest'
import {
  buildNetworkForm,
  buildNetworkSystemConfig,
  transformNetworkForStore,
  validateNetworkForm,
  isValidAria2ProxyUrl,
  type NetworkForm,
} from '../useNetworkPreference'
import { PROXY_SCOPES, PROXY_SCOPE_OPTIONS, DEFAULT_APP_CONFIG } from '@shared/constants'
import type { AppConfig } from '@shared/types'

// ── isValidAria2ProxyUrl ────────────────────────────────────────────

describe('isValidAria2ProxyUrl', () => {
  // ── Valid inputs ──────────────────────────────────────────────────

  it('accepts empty string (clears proxy)', () => {
    expect(isValidAria2ProxyUrl('')).toBe(true)
  })

  it('accepts whitespace-only string', () => {
    expect(isValidAria2ProxyUrl('   ')).toBe(true)
  })

  it('accepts http:// proxy', () => {
    expect(isValidAria2ProxyUrl('http://127.0.0.1:8080')).toBe(true)
  })

  it('accepts https:// proxy', () => {
    expect(isValidAria2ProxyUrl('https://proxy.example.com:443')).toBe(true)
  })

  it('accepts ftp:// proxy', () => {
    expect(isValidAria2ProxyUrl('ftp://proxy.example.com:21')).toBe(true)
  })

  it('accepts http:// with user:password', () => {
    expect(isValidAria2ProxyUrl('http://user:pass@proxy.example.com:8080')).toBe(true)
  })

  it('accepts bare HOST:PORT (no scheme)', () => {
    expect(isValidAria2ProxyUrl('127.0.0.1:8080')).toBe(true)
  })

  it('accepts bare hostname (no port, no scheme)', () => {
    expect(isValidAria2ProxyUrl('proxy.example.com')).toBe(true)
  })

  it('accepts URL with leading/trailing whitespace', () => {
    expect(isValidAria2ProxyUrl('  http://proxy:8080  ')).toBe(true)
  })

  // ── Rejected inputs ───────────────────────────────────────────────

  it('rejects socks5:// proxy', () => {
    expect(isValidAria2ProxyUrl('socks5://127.0.0.1:1080')).toBe(false)
  })

  it('rejects socks4:// proxy', () => {
    expect(isValidAria2ProxyUrl('socks4://127.0.0.1:1080')).toBe(false)
  })

  it('rejects socks5h:// proxy', () => {
    expect(isValidAria2ProxyUrl('socks5h://127.0.0.1:1080')).toBe(false)
  })

  it('rejects socks4a:// proxy', () => {
    expect(isValidAria2ProxyUrl('socks4a://127.0.0.1:1080')).toBe(false)
  })

  it('rejects SOCKS5:// (case-insensitive)', () => {
    expect(isValidAria2ProxyUrl('SOCKS5://127.0.0.1:1080')).toBe(false)
  })

  it('rejects ws:// scheme', () => {
    expect(isValidAria2ProxyUrl('ws://proxy:8080')).toBe(false)
  })

  it('rejects custom:// scheme', () => {
    expect(isValidAria2ProxyUrl('custom://proxy:8080')).toBe(false)
  })
})

// ── buildNetworkForm ────────────────────────────────────────────────

describe('buildNetworkForm', () => {
  const emptyConfig = {} as AppConfig

  // ── Proxy ───────────────────────────────────────────────────────

  it('defaults proxy mode to direct', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.proxy.mode).toBe('direct')
    expect(form.proxy.mode).toBe('direct')
  })

  it('defaults proxy.server to empty string', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.proxy.server).toBe('')
  })

  it('default scope includes ALL scopes so proxy works on first enable', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.proxy.scope).toEqual(expect.arrayContaining([PROXY_SCOPES.DOWNLOAD]))
    expect(form.proxy.scope).toHaveLength(PROXY_SCOPE_OPTIONS.length)
  })

  it('preserves proxy configuration from config', () => {
    const config = {
      proxy: {
        mode: 'manual',
        server: 'http://127.0.0.1:7890',
        username: 'proxy-user',
        password: 'proxy-pass',
        bypass: '*.local',
        scope: ['download'],
      },
    } as AppConfig
    const form = buildNetworkForm(config)
    expect(form.proxy.mode).toBe('manual')
    expect(form.proxy.server).toBe('http://127.0.0.1:7890')
    expect(form.proxy.username).toBe('proxy-user')
    expect(form.proxy.password).toBe('proxy-pass')
    expect(form.proxy.bypass).toBe('*.local')
    expect(form.proxy.scope).toEqual(['download'])
  })

  it('preserves user-selected subset of scopes', () => {
    const config = {
      proxy: {
        mode: 'manual',
        server: 'http://127.0.0.1:7890',
        bypass: '',
        scope: [PROXY_SCOPES.DOWNLOAD],
      },
    } as AppConfig
    const form = buildNetworkForm(config)
    expect(form.proxy.scope).toEqual([PROXY_SCOPES.DOWNLOAD])
  })

  // ── Ports ───────────────────────────────────────────────────────

  it('defaults enableUpnp to true', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.enableUpnp).toBe(true)
  })

  it('handles enableUpnp=false explicitly', () => {
    const config = { enableUpnp: false } as unknown as AppConfig
    const form = buildNetworkForm(config)
    expect(form.enableUpnp).toBe(false)
  })

  // ── Transfer Parameters ─────────────────────────────────────────

  it('defaults connectTimeout to 10', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.connectTimeout).toBe(10)
  })

  it('reads connectTimeout from config', () => {
    const config = { connectTimeout: 30 } as unknown as AppConfig
    const form = buildNetworkForm(config)
    expect(form.connectTimeout).toBe(30)
  })

  it('defaults timeout to 10', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.timeout).toBe(10)
  })

  it('reads timeout from config', () => {
    const config = { timeout: 60 } as unknown as AppConfig
    const form = buildNetworkForm(config)
    expect(form.timeout).toBe(60)
  })

  it('defaults fileAllocation from DEFAULT_APP_CONFIG', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.fileAllocation).toBe(DEFAULT_APP_CONFIG.fileAllocation)
  })

  it('reads fileAllocation from config', () => {
    const config = { fileAllocation: 'prealloc' } as unknown as AppConfig
    const form = buildNetworkForm(config)
    expect(form.fileAllocation).toBe('prealloc')
  })

  // ── User-Agent ──────────────────────────────────────────────────

  it('defaults userAgent from DEFAULT_APP_CONFIG', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.userAgent).toBe(DEFAULT_APP_CONFIG.userAgent)
  })

  it('defaults asyncDns to false', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.asyncDns).toBe(false)
  })

  it('reads asyncDns from config', () => {
    const config = { asyncDns: true } as AppConfig
    const form = buildNetworkForm(config)
    expect(form.asyncDns).toBe(true)
  })

  it('reads userAgent from config', () => {
    const config = { userAgent: 'Mozilla/5.0 Custom' } as AppConfig
    const form = buildNetworkForm(config)
    expect(form.userAgent).toBe('Mozilla/5.0 Custom')
  })

  // ── Completeness ────────────────────────────────────────────────

  it('returns all expected form fields', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form).toHaveProperty('proxy')
    expect(form).toHaveProperty('enableUpnp')
    expect(form).toHaveProperty('autoChangeConflictingPorts')
    expect(form).toHaveProperty('portConflictRecovery')
    expect(form).toHaveProperty('connectTimeout')
    expect(form).toHaveProperty('timeout')
    expect(form).toHaveProperty('fileAllocation')
    expect(form).toHaveProperty('userAgent')
    expect(form).toHaveProperty('asyncDns')
  })

  it('defaults port conflict recovery to enabled for every managed port type', () => {
    const form = buildNetworkForm(emptyConfig)
    expect(form.portConflictRecovery).toEqual({
      enabled: true,
      rangeStart: 29000,
      rangeEnd: 29999,
      rpc: true,
      extensionApi: true,
      bt: true,
      dht: true,
      ed2k: true,
      ed2kUdp: true,
    })
  })

  it('uses the legacy auto switch value when no recovery policy exists', () => {
    const form = buildNetworkForm({ autoChangeConflictingPorts: false } as AppConfig)
    expect(form.portConflictRecovery.enabled).toBe(false)
  })
})

// ── buildNetworkSystemConfig ────────────────────────────────────────

describe('buildNetworkSystemConfig', () => {
  const baseForm: NetworkForm = {
    proxy: { mode: 'direct', server: '', bypass: '', scope: [] },
    enableUpnp: true,
    autoChangeConflictingPorts: true,
    portConflictRecovery: { ...DEFAULT_APP_CONFIG.portConflictRecovery },
    connectTimeout: 10,
    timeout: 10,
    fileAllocation: 'none',
    userAgent: '',
    userAgentProfiles: [],
    userAgentRules: [],
    recentUserAgentProfileIds: [],
    asyncDns: false,
  }

  it('does not emit protocol-specific options', () => {
    const config = buildNetworkSystemConfig(baseForm)
    expect(config).not.toHaveProperty('listen-port')
    expect(config).not.toHaveProperty('bt-external-ip')
    expect(config).not.toHaveProperty('bt-external-port')
    expect(config).not.toHaveProperty('dht-listen-port')
    expect(config).not.toHaveProperty('enable-dht')
    expect(config).not.toHaveProperty('enable-peer-exchange')
    expect(config).not.toHaveProperty('keep-sharing')
  })

  it('maps transfer parameter keys to aria2 config', () => {
    const config = buildNetworkSystemConfig(baseForm)
    expect(config['connect-timeout']).toBe('10')
    expect(config['timeout']).toBe('10')
    expect(config['file-allocation']).toBe('none')
  })

  it('emits custom connect-timeout and timeout values', () => {
    const config = buildNetworkSystemConfig({ ...baseForm, connectTimeout: 30, timeout: 60 })
    expect(config['connect-timeout']).toBe('30')
    expect(config['timeout']).toBe('60')
  })

  it('emits custom file-allocation value', () => {
    const config = buildNetworkSystemConfig({ ...baseForm, fileAllocation: 'prealloc' })
    expect(config['file-allocation']).toBe('prealloc')
  })

  it('falls back empty file-allocation to DEFAULT_APP_CONFIG', () => {
    const config = buildNetworkSystemConfig({ ...baseForm, fileAllocation: '' })
    expect(config['file-allocation']).toBe(DEFAULT_APP_CONFIG.fileAllocation)
  })

  it('maps user-agent to aria2 config', () => {
    const config = buildNetworkSystemConfig({ ...baseForm, userAgent: 'Custom/1.0' })
    expect(config['user-agent']).toBe('Custom/1.0')
  })

  it('maps async-dns to aria2 config', () => {
    expect(buildNetworkSystemConfig(baseForm)['async-dns']).toBe('false')
    expect(buildNetworkSystemConfig({ ...baseForm, asyncDns: true })['async-dns']).toBe('true')
  })

  // ── Proxy flow ──────────────────────────────────────────────────

  it('sets manual proxy options when enabled for downloads', () => {
    const config = buildNetworkSystemConfig({
      ...baseForm,
      proxy: {
        mode: 'manual',
        server: 'http://proxy:8080',
        bypass: '*.local',
        scope: [PROXY_SCOPES.DOWNLOAD],
      },
    })
    expect(config['proxy-mode']).toBeUndefined()
    expect(config['all-proxy']).toBe('http://proxy:8080')
    expect(config['no-proxy']).toBe('*.local')
  })

  it('emits structured proxy authentication options', () => {
    const config = buildNetworkSystemConfig({
      ...baseForm,
      proxy: {
        mode: 'manual',
        server: 'http://proxy:8080',
        username: 'proxy-user',
        password: 'proxy-pass',
        bypass: '',
        scope: [PROXY_SCOPES.DOWNLOAD],
      },
    })
    expect(config['all-proxy']).toBe('http://proxy:8080')
    expect(config['all-proxy-user']).toBe('proxy-user')
    expect(config['all-proxy-passwd']).toBe('proxy-pass')
  })

  it('clears proxy options when download scope is excluded', () => {
    const config = buildNetworkSystemConfig({
      ...baseForm,
      proxy: { mode: 'manual', server: 'http://proxy:8080', bypass: '*.local', scope: ['app'] },
    })
    expect(config['proxy-mode']).toBeUndefined()
    expect(config['all-proxy']).toBe('')
    expect(config['all-proxy-user']).toBe('')
    expect(config['all-proxy-passwd']).toBe('')
    expect(config['no-proxy']).toBe('')
  })

  it('clears proxy options when proxy is direct', () => {
    const config = buildNetworkSystemConfig({
      ...baseForm,
      proxy: { mode: 'direct', server: 'http://proxy:8080', bypass: '', scope: [PROXY_SCOPES.DOWNLOAD] },
    })
    expect(config['proxy-mode']).toBeUndefined()
    expect(config['all-proxy']).toBe('')
  })

  it('manual mode with default scope produces non-empty all-proxy', () => {
    const form = buildNetworkForm({} as AppConfig)
    form.proxy.mode = 'manual'
    form.proxy.server = 'http://127.0.0.1:7890'
    const config = buildNetworkSystemConfig(form)
    expect(config['proxy-mode']).toBeUndefined()
    expect(config['all-proxy']).toBe('http://127.0.0.1:7890')
    expect(config['no-proxy']).toBeUndefined()
  })

  it('normalizes legacy auto mode to direct and clears proxy options', () => {
    const config = buildNetworkSystemConfig({
      ...baseForm,
      proxy: {
        mode: 'auto' as never,
        server: 'http://127.0.0.1:7890',
        bypass: '',
        scope: [PROXY_SCOPES.DOWNLOAD],
      },
    })
    expect(config['proxy-mode']).toBeUndefined()
    expect(config['all-proxy']).toBe('')
  })

  it('proxy bypass value is forwarded to no-proxy when download scope active', () => {
    const config = buildNetworkSystemConfig({
      ...baseForm,
      proxy: {
        mode: 'manual',
        server: 'http://proxy:8080',
        bypass: '192.168.0.0/16,*.local',
        scope: [PROXY_SCOPES.DOWNLOAD],
      },
    })
    expect(config['all-proxy']).toBe('http://proxy:8080')
    expect(config['no-proxy']).toBe('192.168.0.0/16,*.local')
  })
})

// ── transformNetworkForStore ────────────────────────────────────────

describe('transformNetworkForStore', () => {
  const baseForm: NetworkForm = {
    proxy: { mode: 'direct', server: '', bypass: '', scope: [] },
    enableUpnp: true,
    autoChangeConflictingPorts: true,
    portConflictRecovery: { ...DEFAULT_APP_CONFIG.portConflictRecovery },
    connectTimeout: 10,
    timeout: 10,
    fileAllocation: 'none',
    userAgent: '',
    userAgentProfiles: [],
    userAgentRules: [],
    recentUserAgentProfileIds: [],
    asyncDns: false,
  }

  it('does not persist BitTorrent-owned fields', () => {
    const result = transformNetworkForStore(baseForm)
    expect(result).not.toHaveProperty('listenPort')
    expect(result).not.toHaveProperty('dhtListenPort')
    expect(result).not.toHaveProperty('keepSharing')
  })

  it('preserves automatic conflicting port switching preference', () => {
    const result = transformNetworkForStore({
      ...baseForm,
      portConflictRecovery: { ...baseForm.portConflictRecovery, enabled: false },
    })
    expect(result.autoChangeConflictingPorts).toBe(false)
    expect(result.portConflictRecovery).toMatchObject({ enabled: false })
  })

  it('preserves proxy config through transform', () => {
    const result = transformNetworkForStore({
      ...baseForm,
      proxy: { mode: 'manual', server: 'http://127.0.0.1:7890', bypass: '*.local', scope: ['download'] },
    })
    expect(result.proxy).toEqual({
      mode: 'manual',
      server: 'http://127.0.0.1:7890',
      bypass: '*.local',
      scope: ['download'],
    })
  })

  it('preserves timeout values through transform', () => {
    const result = transformNetworkForStore({ ...baseForm, connectTimeout: 30, timeout: 60 })
    expect(result.connectTimeout).toBe(30)
    expect(result.timeout).toBe(60)
  })

  it('preserves fileAllocation through transform', () => {
    const result = transformNetworkForStore({ ...baseForm, fileAllocation: 'prealloc' })
    expect(result.fileAllocation).toBe('prealloc')
  })

  it('preserves asyncDns through transform', () => {
    const result = transformNetworkForStore({ ...baseForm, asyncDns: true })
    expect(result.asyncDns).toBe(true)
  })
})

// ── validateNetworkForm ─────────────────────────────────────────────

describe('validateNetworkForm', () => {
  const validForm: NetworkForm = {
    proxy: { mode: 'direct', server: '', bypass: '', scope: [] },
    enableUpnp: true,
    autoChangeConflictingPorts: true,
    portConflictRecovery: { ...DEFAULT_APP_CONFIG.portConflictRecovery },
    connectTimeout: 10,
    timeout: 10,
    fileAllocation: 'none',
    userAgent: '',
    userAgentProfiles: [],
    userAgentRules: [],
    recentUserAgentProfileIds: [],
    asyncDns: false,
  }

  it('returns null for valid form', () => {
    expect(validateNetworkForm(validForm)).toBeNull()
  })

  it('rejects invalid port recovery ranges', () => {
    expect(
      validateNetworkForm({
        ...validForm,
        portConflictRecovery: { ...validForm.portConflictRecovery, rangeStart: 25000, rangeEnd: 23999 },
      }),
    ).toBe('preferences.port-conflict-recovery-invalid-range')
  })

  it('ignores invalid hidden port recovery ranges when recovery is disabled', () => {
    expect(
      validateNetworkForm({
        ...validForm,
        portConflictRecovery: {
          ...validForm.portConflictRecovery,
          enabled: false,
          rangeStart: 25000,
          rangeEnd: 23999,
        },
      }),
    ).toBeNull()
  })

  it('returns null for valid proxy URL in manual mode', () => {
    expect(
      validateNetworkForm({
        ...validForm,
        proxy: { ...validForm.proxy, mode: 'manual', server: 'http://proxy.example.com:8080' },
      }),
    ).toBeNull()
  })

  it('returns invalid-proxy-url for malformed URL in manual mode', () => {
    expect(
      validateNetworkForm({
        ...validForm,
        proxy: { ...validForm.proxy, mode: 'manual', server: 'http://:invalid:url:' },
      }),
    ).toBe('preferences.invalid-proxy-url')
  })

  it('returns proxy-unsupported-protocol for socks5 in manual mode', () => {
    expect(
      validateNetworkForm({
        ...validForm,
        proxy: { ...validForm.proxy, mode: 'manual', server: 'socks5://127.0.0.1:1080' },
      }),
    ).toBe('preferences.proxy-unsupported-protocol')
  })

  it('returns null for invalid proxy URL in direct mode', () => {
    expect(
      validateNetworkForm({
        ...validForm,
        proxy: { ...validForm.proxy, mode: 'direct', server: 'socks5://127.0.0.1:1080' },
      }),
    ).toBeNull()
  })

  it('returns null for empty proxy server in manual mode', () => {
    expect(
      validateNetworkForm({
        ...validForm,
        proxy: { ...validForm.proxy, mode: 'manual', server: '' },
      }),
    ).toBeNull()
  })
})
