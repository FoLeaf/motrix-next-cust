/** @fileoverview TDD tests for magnet URI file selection utilities.
 *
 * Tests the pure logic extracted from the magnet flow:
 * - Detecting magnet URIs
 * - Building metadata-only options
 * - Parsing file selection from getFiles response
 * - Building select-file option string
 */
import { describe, it, expect } from 'vitest'
import type { Aria2File } from '@shared/types'

// Dynamic import after module exists
const {
  isMagnetUri,
  buildMetadataOnlyOptions,
  buildSelectFileOption,
  parseFilesForSelection,
  shouldShowFileSelection,
  getResolvedMagnetSelection,
  getPendingMagnetSelectionGids,
} = await import('@/composables/useMagnetFlow')

describe('useMagnetFlow', () => {
  // ── isMagnetUri ─────────────────────────────────────────────────

  describe('isMagnetUri', () => {
    it('returns true for standard magnet URIs', () => {
      expect(isMagnetUri('magnet:?xt=urn:btih:abc123')).toBe(true)
    })

    it('returns true for uppercase MAGNET prefix', () => {
      expect(isMagnetUri('MAGNET:?xt=urn:btih:abc123')).toBe(true)
    })

    it('returns false for HTTP URIs', () => {
      expect(isMagnetUri('https://example.com/file.zip')).toBe(false)
    })

    it('returns false for empty strings', () => {
      expect(isMagnetUri('')).toBe(false)
    })

    it('returns false for torrent file paths', () => {
      expect(isMagnetUri('/downloads/file.torrent')).toBe(false)
    })
  })

  // ── buildMetadataOnlyOptions ────────────────────────────────────

  describe('buildMetadataOnlyOptions', () => {
    it('sets pause-metadata for magnet file selection', () => {
      const options = buildMetadataOnlyOptions({ dir: '/downloads', split: '8' })
      expect(options['pause-metadata']).toBe('true')
    })

    it('preserves existing options', () => {
      const options = buildMetadataOnlyOptions({ dir: '/custom', split: '4' })
      expect(options.dir).toBe('/custom')
      expect(options.split).toBe('4')
    })
  })

  // ── parseFilesForSelection ──────────────────────────────────────

  describe('parseFilesForSelection', () => {
    const mockFiles: Aria2File[] = [
      {
        index: '1',
        path: '/downloads/movie/video.mkv',
        length: '1500000000',
        completedLength: '0',
        selected: 'true',
        uris: [],
      },
      {
        index: '2',
        path: '/downloads/movie/subtitle.srt',
        length: '50000',
        completedLength: '0',
        selected: 'true',
        uris: [],
      },
      {
        index: '3',
        path: '/downloads/movie/nfo.txt',
        length: '500',
        completedLength: '0',
        selected: 'true',
        uris: [],
      },
    ]

    it('extracts index, filename, and size from Aria2File array', () => {
      const items = parseFilesForSelection(mockFiles)
      expect(items).toHaveLength(3)
      expect(items[0]).toEqual({
        index: 1,
        name: 'video.mkv',
        path: '/downloads/movie/video.mkv',
        length: 1500000000,
      })
    })

    it('extracts basename from full path', () => {
      const items = parseFilesForSelection(mockFiles)
      expect(items[1].name).toBe('subtitle.srt')
    })

    it('returns empty array for empty file list', () => {
      expect(parseFilesForSelection([])).toEqual([])
    })

    it('extracts filename from Windows backslash path', () => {
      const winFiles: Aria2File[] = [
        {
          index: '1',
          path: 'C:\\Users\\test\\Downloads\\movie.mkv',
          length: '1000',
          completedLength: '0',
          selected: 'true',
          uris: [],
        },
      ]
      const items = parseFilesForSelection(winFiles)
      expect(items[0].name).toBe('movie.mkv')
    })

    it('extracts filename from mixed separator path', () => {
      const mixedFiles: Aria2File[] = [
        {
          index: '1',
          path: 'C:\\Users\\test/Downloads/movie.mkv',
          length: '1000',
          completedLength: '0',
          selected: 'true',
          uris: [],
        },
      ]
      const items = parseFilesForSelection(mixedFiles)
      expect(items[0].name).toBe('movie.mkv')
    })
  })

  // ── buildSelectFileOption ───────────────────────────────────────

  describe('buildSelectFileOption', () => {
    it('joins selected indices with commas', () => {
      expect(buildSelectFileOption([1, 3, 5])).toBe('1,3,5')
    })

    it('returns single index as string', () => {
      expect(buildSelectFileOption([2])).toBe('2')
    })

    it('sorts indices ascending', () => {
      expect(buildSelectFileOption([5, 1, 3])).toBe('1,3,5')
    })

    it('returns empty string for empty selection', () => {
      expect(buildSelectFileOption([])).toBe('')
    })
  })

  // ── shouldShowFileSelection ───────────────────────────────────────

  describe('shouldShowFileSelection', () => {
    it('returns true when pauseMetadata is true (user wants file selection)', () => {
      expect(shouldShowFileSelection({ pauseMetadata: true })).toBe(true)
    })

    it('returns false when pauseMetadata is false (auto-download mode)', () => {
      expect(shouldShowFileSelection({ pauseMetadata: false })).toBe(false)
    })

    it('returns true when pauseMetadata is undefined (safe default)', () => {
      expect(shouldShowFileSelection({ pauseMetadata: undefined })).toBe(true)
    })

    it('returns true when config object has no pauseMetadata key', () => {
      expect(shouldShowFileSelection({})).toBe(true)
    })
  })

  describe('getResolvedMagnetSelection', () => {
    it('returns the followedBy content task when native aria2 metadata resolves', () => {
      const result = getResolvedMagnetSelection({
        gid: 'metadata-gid',
        status: 'complete',
        totalLength: '0',
        completedLength: '0',
        uploadLength: '0',
        downloadSpeed: '0',
        uploadSpeed: '0',
        connections: '0',
        dir: '/downloads',
        files: [],
        bittorrent: {
          announceList: [['udp://tracker.example:6969']],
        },
        followedBy: ['content-gid'],
      })

      expect(result).toEqual({ metadataGid: 'metadata-gid', downloadGid: 'content-gid' })
    })

    it('returns null while metadata has not produced a content task', () => {
      const result = getResolvedMagnetSelection({
        gid: 'metadata-gid',
        status: 'active',
        totalLength: '0',
        completedLength: '0',
        uploadLength: '0',
        downloadSpeed: '0',
        uploadSpeed: '0',
        connections: '1',
        dir: '/downloads',
        files: [],
        bittorrent: {
          announceList: [['udp://tracker.example:6969']],
        },
      })

      expect(result).toBeNull()
    })
  })

  describe('getPendingMagnetSelectionGids', () => {
    it('restores native aria2 metadata parent GIDs from paused content tasks', () => {
      const gids = getPendingMagnetSelectionGids([
        {
          gid: 'content-gid',
          status: 'paused',
          totalLength: '1000',
          completedLength: '0',
          uploadLength: '0',
          downloadSpeed: '0',
          uploadSpeed: '0',
          connections: '0',
          dir: '/downloads',
          files: [
            {
              index: '1',
              path: '/downloads/Movie/video.mkv',
              length: '1000',
              completedLength: '0',
              selected: 'true',
              uris: [],
            },
          ],
          bittorrent: {
            info: {
              name: 'Movie',
            },
          },
          following: 'metadata-gid',
        },
      ])

      expect(gids).toEqual(['metadata-gid'])
    })
  })
})
