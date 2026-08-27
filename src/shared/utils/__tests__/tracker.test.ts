/** @fileoverview Tests for tracker data conversion utilities. */
import { describe, it, expect } from 'vitest'
import { DEFAULT_TRACKER_SOURCE, TRACKER_SOURCE_OPTIONS } from '@shared/constants'
import { convertTrackerDataToLine, convertTrackerDataToComma, reduceTrackerString } from '../tracker'

describe('tracker source defaults', () => {
  it('uses only the two official curated sources', () => {
    expect(TRACKER_SOURCE_OPTIONS).toEqual([
      {
        owner: 'ngosang',
        repository: 'trackerslist',
        value: 'https://ngosang.github.io/trackerslist/trackers_best.txt',
      },
      {
        owner: 'XIU2',
        repository: 'TrackersListCollection',
        value: 'https://cf.trackerslist.com/best.txt',
      },
    ])
    expect(DEFAULT_TRACKER_SOURCE).toEqual(TRACKER_SOURCE_OPTIONS.map((source) => source.value))
  })
})

// ─── convertTrackerDataToLine ───────────────────────────────

describe('convertTrackerDataToLine', () => {
  it('joins entries with \\r\\n newlines', () => {
    expect(convertTrackerDataToLine(['a', 'b', 'c'])).toBe('a\r\nb\r\nc')
  })

  it('returns empty string for empty array', () => {
    expect(convertTrackerDataToLine([])).toBe('')
  })

  it('strips empty-string entries', () => {
    expect(convertTrackerDataToLine(['a', '', 'b'])).toBe('a\r\nb')
  })

  it('strips whitespace-only entries', () => {
    expect(convertTrackerDataToLine(['a', '   ', 'b'])).toBe('a\r\nb')
  })

  it('trims tracker URLs before deduplication', () => {
    expect(convertTrackerDataToLine([' udp://tracker.example ', 'udp://tracker.example'])).toBe('udp://tracker.example')
  })

  it('returns single entry without separator', () => {
    expect(convertTrackerDataToLine(['tracker1'])).toBe('tracker1')
  })

  it('handles entries that themselves contain newlines', () => {
    // Input entries with embedded \r\n are split then filtered
    const result = convertTrackerDataToLine(['a\r\nb', 'c'])
    expect(result).toBe('a\r\nb\r\nc')
  })

  it('deduplicates individual tracker URLs across entries', () => {
    const result = convertTrackerDataToLine(['udp://a\nudp://b', 'udp://b\nudp://c'])
    expect(result).toBe('udp://a\r\nudp://b\r\nudp://c')
  })
})

// ─── convertTrackerDataToComma ──────────────────────────────

describe('convertTrackerDataToComma', () => {
  it('joins entries with commas', () => {
    expect(convertTrackerDataToComma(['a', 'b', 'c'])).toBe('a,b,c')
  })

  it('returns empty string for empty array', () => {
    expect(convertTrackerDataToComma([])).toBe('')
  })

  it('strips empty entries before joining', () => {
    expect(convertTrackerDataToComma(['a', '', 'b'])).toBe('a,b')
  })

  it('returns single entry without comma', () => {
    expect(convertTrackerDataToComma(['tracker1'])).toBe('tracker1')
  })

  it('deduplicates individual tracker URLs across sources', () => {
    const source1 = 'udp://tracker1:1234\nudp://shared:5678'
    const source2 = 'udp://shared:5678\nudp://tracker2:9012'
    const result = convertTrackerDataToComma([source1, source2])
    const trackers = result.split(',')
    expect(trackers.filter((t) => t === 'udp://shared:5678')).toHaveLength(1)
    expect(trackers).toHaveLength(3)
  })
})

// ─── reduceTrackerString ────────────────────────────────────

describe('reduceTrackerString', () => {
  it('returns full string when under MAX_BT_TRACKER_LENGTH (6144)', () => {
    expect(reduceTrackerString('short')).toBe('short')
  })

  it('returns empty for empty string', () => {
    expect(reduceTrackerString('')).toBe('')
  })

  it('returns empty for no argument (default parameter)', () => {
    expect(reduceTrackerString()).toBe('')
  })

  it('truncates at last comma when exceeding 6144 characters', () => {
    // Build a string that exceeds 6144 chars
    const items = Array.from(
      { length: 200 },
      (_, i) => `http://tracker${String(i).padStart(3, '0')}.example.com/announce`,
    )
    const longStr = items.join(',')
    expect(longStr.length).toBeGreaterThan(6144)

    const result = reduceTrackerString(longStr)
    expect(result.length).toBeLessThanOrEqual(6144)
    // Must end at a clean boundary — no partial URL
    expect(result.endsWith(',')).toBe(false)
    const parts = result.split(',')
    parts.forEach((part) => {
      expect(part).toContain('http://')
      expect(part).toContain('/announce')
    })
  })

  it('returns full substring when no comma in prefix', () => {
    // A single very long tracker URL with no commas
    const longUrl = 'http://' + 'a'.repeat(6200) + '.com/announce'
    const result = reduceTrackerString(longUrl)
    // No comma found, returns substring(0, 6144)
    expect(result.length).toBe(6144)
  })
})
