/** @fileoverview File deletion for download content and aria2 metadata. */
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@shared/logger'
import { resolveOpenTarget } from '@shared/utils'
import { cleanupAria2MetadataFiles } from '@/composables/useDownloadCleanup'
import type { Aria2Task, FileDeletionMode } from '@shared/types'

export async function deletePath(path: string, mode: FileDeletionMode): Promise<boolean> {
  if (!path) return false
  return invoke<boolean>('delete_path', { path, mode })
}

async function deletePaths(paths: string[], mode: FileDeletionMode): Promise<void> {
  const failures: string[] = []
  for (const path of new Set(paths.filter(Boolean))) {
    try {
      await deletePath(path, mode)
    } catch (error) {
      failures.push(`${path}: ${String(error)}`)
    }
  }
  if (failures.length > 0) {
    throw new Error(`Failed to delete ${failures.length} path(s): ${failures.join('; ')}`)
  }
}

export async function cleanupAria2ControlFiles(task: Aria2Task): Promise<void> {
  try {
    const paths: string[] = []
    if (task.dir && task.infoHash) {
      paths.push(`${task.dir}/${task.infoHash}.aria2`)
    }

    const target = await resolveOpenTarget(task)

    if (!target || target === task.dir) {
      for (const f of task.files || []) {
        if (f.path) paths.push(f.path + '.aria2')
      }
    } else {
      paths.push(target + '.aria2')
    }

    await deletePaths(paths, 'permanent')
  } catch (error) {
    logger.debug('cleanupAria2ControlFiles', `cleanup failed: ${error}`)
  }
}

export async function deleteTaskFiles(task: Aria2Task, mode: FileDeletionMode): Promise<void> {
  const target = await resolveOpenTarget(task)
  const contentPaths = target && target !== task.dir ? [target] : (task.files || []).map((file) => file.path)
  let deletionError: unknown

  try {
    await deletePaths(contentPaths, mode)
  } catch (error) {
    deletionError = error
  } finally {
    await cleanupAria2ControlFiles(task)
    if (task.dir && task.infoHash) {
      await cleanupAria2MetadataFiles(task.dir, task.infoHash)
    }
  }

  if (deletionError) throw deletionError
}
