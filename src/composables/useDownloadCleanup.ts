/** @fileoverview Utilities for download cleanup: stale record detection and torrent file removal.
 *
 * Pure, testable functions — side effects (FS access) are injected via imports.
 */
import { join } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'
import { deletePath } from '@/composables/useFileDelete'
import { logger } from '@shared/logger'
import { getTorrentInfoHash } from '@shared/utils/torrentMeta'

/** Record shape needed for stale detection (not the full HistoryRecord). */
export interface StaleCheckItem {
  gid: string
  dir: string
  name: string
  /** All file paths from meta.files — if present, ALL must be gone to count as stale. */
  filePaths?: string[]
}

/** Identify records whose downloaded files no longer exist on disk.
 *  Returns the GIDs of stale records. */
export async function findStaleRecords(records: StaleCheckItem[]): Promise<string[]> {
  const staleGids: string[] = []

  for (const record of records) {
    // Multi-file: only stale if ALL expected files are gone.
    // Early-exit on first existing file for performance.
    if (record.filePaths && record.filePaths.length > 0) {
      let anyExists = false
      for (const fp of record.filePaths) {
        try {
          if (await invoke<boolean>('check_path_exists', { path: fp })) {
            anyExists = true
            break
          }
        } catch (e) {
          logger.debug('StaleCheck', `check_path_exists failed for ${fp}: ${e}`)
        }
      }
      if (!anyExists) staleGids.push(record.gid)
      continue
    }

    if (!record.dir || !record.name) {
      staleGids.push(record.gid)
      continue
    }

    try {
      const filePath = await join(record.dir, record.name)
      const fileExists = await invoke<boolean>('check_path_exists', { path: filePath })
      if (!fileExists) {
        staleGids.push(record.gid)
      }
    } catch (e) {
      logger.debug('StaleCheck', `path join/check failed for ${record.gid}: ${e}`)
      staleGids.push(record.gid)
    }
  }

  return staleGids
}

export async function trashTorrentFile(path: string): Promise<boolean> {
  if (!path) return false

  try {
    return await deletePath(path, 'trash')
  } catch (error) {
    logger.warn('trashTorrentFile', `Failed to trash ${path}: ${error}`)
    return false
  }
}

/** Check whether the "delete torrent after complete" setting is enabled. */
export function shouldDeleteTorrent(config: Partial<{ deleteTorrentAfterComplete: boolean }>): boolean {
  return config.deleteTorrentAfterComplete === true
}

/** Regex matching aria2's auto-saved torrent metadata filenames. */
const HEX40_TORRENT_METADATA_RE = /^[0-9a-f]{40}\.torrent$/

/**
 * Default hash extractor: reads a .torrent file and delegates metainfo
 * parsing/infoHash extraction to the shared torrent adapter.
 */
async function defaultHashExtractor(filePath: string): Promise<string | null> {
  const bytes = await invoke<number[]>('read_local_file', { path: filePath })
  const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return getTorrentInfoHash(uint8)
}

/** Type for the injectable hash extractor function. */
export type HashExtractor = (filePath: string) => Promise<string | null>

/**
 * Scan the download directory for aria2-saved metadata files and
 * clean up those associated with the given torrent.
 *
 * Handles hex40 `.torrent` metadata created by `bt-save-metadata` and
 * `rpc-save-upload-metadata`. We parse each candidate and match by infoHash
 * before removing it.
 *
 * Internal aria2 engine artifacts are permanently deleted.
 *
 * Safety guarantees:
 * - Only files matching `/^[0-9a-f]{40}\.torrent$/` are considered (user files safe)
 * - Parsed infoHash must exactly match the target (no accidental deletion)
 * - All errors are caught and logged (never throws)
 *
 * @param dir       Download directory to scan
 * @param infoHash  Target infoHash to match (from aria2 task status)
 * @param extractHash  Injectable hash extractor for testability
 * @returns true if a matching .torrent file was found and deleted, false otherwise
 */
export async function cleanupAria2MetadataFiles(
  dir: string,
  infoHash: string,
  extractHash: HashExtractor = defaultHashExtractor,
): Promise<boolean> {
  if (!dir || !infoHash) return false

  try {
    const entries = await invoke<string[]>('list_dir_files', { path: dir })
    const candidates = entries.filter((name) => HEX40_TORRENT_METADATA_RE.test(name))

    let torrentMatched = false

    for (const name of candidates) {
      const filePath = await join(dir, name)
      try {
        const hash = await extractHash(filePath)
        if (hash === infoHash) {
          const removed = await deletePath(filePath, 'permanent')
          if (removed) logger.debug('cleanupAria2Metadata', `removed ${name}`)
          torrentMatched = removed
          return torrentMatched
        }
      } catch (e) {
        logger.debug('cleanupAria2Metadata', `skipping ${name}: ${e}`)
        continue
      }
    }

    return torrentMatched
  } catch (e) {
    logger.debug('cleanupAria2Metadata', `readDir failed for ${dir}: ${e}`)
    return false
  }
}
