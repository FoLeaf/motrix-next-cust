import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMagnetMetadataResolver,
  resolvePendingMagnetMetadata,
  type MagnetMetadataState,
} from '@/composables/useMagnetMetadataEvents'
import type { Aria2Task } from '@shared/types'
import { logger } from '@shared/logger'

vi.mock('@shared/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/logger')>()
  return {
    ...actual,
    logger: {
      ...actual.logger,
      debug: vi.fn(),
    },
  }
})

function makeTask(gid: string, extra: Partial<Aria2Task> = {}): Aria2Task {
  return {
    gid,
    status: 'complete',
    totalLength: '0',
    completedLength: '0',
    uploadLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '0',
    dir: '/downloads',
    files: [],
    ...extra,
  }
}

describe('useMagnetMetadataEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens file selection immediately when a pending metadata gid completes', async () => {
    const state: MagnetMetadataState = {
      pendingGids: ['metadata-gid'],
      visible: false,
      files: [],
      session: null,
      name: '',
    }
    const fetchTaskStatus = vi.fn(async (gid: string) => {
      if (gid === 'metadata-gid') return makeTask(gid, { followedBy: ['download-gid'] })
      return makeTask(gid, { bittorrent: { info: { name: 'Ubuntu ISO' } } })
    })
    const getFiles = vi.fn().mockResolvedValue([
      {
        index: '1',
        path: '/downloads/Ubuntu/ubuntu.iso',
        length: '1024',
        completedLength: '0',
        selected: 'true',
        uris: [],
      },
    ])

    const resolved = await resolvePendingMagnetMetadata(
      {
        state,
        fetchTaskStatus,
        fetchPendingTasks: vi.fn().mockResolvedValue([]),
        getFiles,
        fallbackName: () => 'Magnet task',
      },
      'metadata-gid',
    )

    expect(resolved).toBe(true)
    expect(state.pendingGids).toEqual(['metadata-gid'])
    expect(state.visible).toBe(true)
    expect(state.session).toEqual({ metadataGid: 'metadata-gid', downloadGid: 'download-gid' })
    expect(state.name).toBe('Ubuntu ISO')
    expect(state.files).toEqual([
      {
        index: 1,
        name: 'ubuntu.iso',
        path: '/downloads/Ubuntu/ubuntu.iso',
        length: 1024,
      },
    ])
    expect(fetchTaskStatus).toHaveBeenCalledWith('metadata-gid')
    expect(fetchTaskStatus).toHaveBeenCalledWith('download-gid')
    expect(getFiles).toHaveBeenCalledWith('download-gid')
  })

  it('ignores completion events for non-pending gids', async () => {
    const state: MagnetMetadataState = {
      pendingGids: ['metadata-gid'],
      visible: false,
      files: [],
      session: null,
      name: '',
    }
    const fetchTaskStatus = vi.fn()

    const resolved = await resolvePendingMagnetMetadata(
      {
        state,
        fetchTaskStatus,
        fetchPendingTasks: vi.fn().mockResolvedValue([]),
        getFiles: vi.fn(),
        fallbackName: () => 'Magnet task',
      },
      'other-gid',
    )

    expect(resolved).toBe(false)
    expect(fetchTaskStatus).not.toHaveBeenCalled()
    expect(state.pendingGids).toEqual(['metadata-gid'])
  })

  it('serializes simultaneous metadata completions without replacing the open selection', async () => {
    const state: MagnetMetadataState = {
      pendingGids: ['metadata-a', 'metadata-b'],
      visible: false,
      files: [],
      session: null,
      name: '',
    }
    const fetchTaskStatus = vi.fn(async (gid: string) => {
      if (gid.startsWith('metadata-')) return makeTask(gid, { followedBy: [`download-${gid.slice(-1)}`] })
      return makeTask(gid, { bittorrent: { info: { name: gid } } })
    })
    const resolver = createMagnetMetadataResolver(() => ({
      state,
      fetchTaskStatus,
      fetchPendingTasks: vi.fn().mockResolvedValue([]),
      getFiles: vi
        .fn()
        .mockResolvedValue([
          { index: '1', path: '/downloads/file.bin', length: '1024', completedLength: '0', selected: 'true', uris: [] },
        ]),
      fallbackName: () => 'Magnet task',
    }))

    await Promise.all([resolver.request('metadata-a'), resolver.request('metadata-b')])

    expect(state.visible).toBe(true)
    expect(state.session).toEqual({ metadataGid: 'metadata-a', downloadGid: 'download-a' })
    expect(state.pendingGids).toEqual(['metadata-a', 'metadata-b'])
  })

  it('recovers the follow-up task when aria2 has already removed the metadata parent', async () => {
    const state: MagnetMetadataState = {
      pendingGids: ['metadata-gid'],
      visible: false,
      files: [],
      session: null,
      name: '',
    }
    const followupTask = makeTask('download-gid', {
      status: 'paused',
      following: 'metadata-gid',
      bittorrent: { info: { name: 'Recovered ISO' } },
      files: [
        {
          index: '1',
          path: '/downloads/recovered.iso',
          length: '2048',
          completedLength: '0',
          selected: 'true',
          uris: [],
        },
      ],
    })
    const fetchTaskStatus = vi.fn().mockRejectedValue({ Aria2: 'aria2 RPC error [1]: GID not found' })
    const getFiles = vi.fn().mockResolvedValue(followupTask.files)

    const resolved = await resolvePendingMagnetMetadata(
      {
        state,
        fetchTaskStatus,
        fetchPendingTasks: vi.fn().mockResolvedValue([followupTask]),
        getFiles,
        fallbackName: () => 'Magnet task',
      },
      'metadata-gid',
    )

    expect(resolved).toBe(true)
    expect(state.visible).toBe(true)
    expect(state.session).toEqual({ metadataGid: 'metadata-gid', downloadGid: 'download-gid' })
    expect(state.name).toBe('Recovered ISO')
    expect(getFiles).toHaveBeenCalledWith('download-gid')
    expect(logger.debug).not.toHaveBeenCalled()
  })

  it('serializes Tauri errors when neither metadata nor a follow-up task exists', async () => {
    const state: MagnetMetadataState = {
      pendingGids: ['metadata-gid'],
      visible: false,
      files: [],
      session: null,
      name: '',
    }

    const resolved = await resolvePendingMagnetMetadata(
      {
        state,
        fetchTaskStatus: vi.fn().mockRejectedValue({ Aria2: 'aria2 RPC error [1]: GID not found' }),
        fetchPendingTasks: vi.fn().mockResolvedValue([]),
        getFiles: vi.fn(),
        fallbackName: () => 'Magnet task',
      },
      'metadata-gid',
    )

    expect(resolved).toBe(false)
    expect(logger.debug).toHaveBeenCalledWith(
      'MagnetMetadata.resolve',
      'gid=metadata-gid outcome=skipped reason="Aria2 Next error [1]: GID not found"',
    )
  })
})
