import { listen } from '@tauri-apps/api/event'
import { formatLogFields, logger } from '@shared/logger'
import {
  findPendingMagnetSelectionTask,
  getResolvedMagnetSelection,
  parseFilesForSelection,
  type MagnetFileItem,
  type MagnetSelectionResolution,
} from '@/composables/useMagnetFlow'
import type { Aria2Task } from '@shared/types'
import { getErrorMessage } from '@shared/utils/errorMessage'

export interface MagnetMetadataState {
  pendingGids: string[]
  visible: boolean
  files: MagnetFileItem[]
  session: MagnetSelectionResolution | null
  name: string
}

export interface MagnetMetadataDeps {
  state: MagnetMetadataState
  fetchTaskStatus: (gid: string) => Promise<Aria2Task>
  fetchPendingTasks: () => Promise<Aria2Task[]>
  getFiles: (gid: string) => Promise<Aria2Task['files']>
  fallbackName: () => string
}

export interface MagnetMetadataResolver {
  request: (gid?: string) => Promise<void>
}

type PendingTaskLoader = () => Promise<Aria2Task[]>

export async function resolvePendingMagnetMetadata(
  deps: MagnetMetadataDeps,
  gid: string,
  loadPendingTasks: PendingTaskLoader = deps.fetchPendingTasks,
): Promise<boolean> {
  const { state } = deps
  if (state.visible) return false
  if (!state.pendingGids.includes(gid)) return false

  let metadataQueryError: unknown
  let resolved: MagnetSelectionResolution | null = null
  let task: Aria2Task | undefined

  try {
    const metadataTask = await deps.fetchTaskStatus(gid)
    resolved = getResolvedMagnetSelection(metadataTask)
  } catch (error) {
    metadataQueryError = error
  }

  try {
    if (resolved) {
      task = await deps.fetchTaskStatus(resolved.downloadGid)
    } else {
      task = findPendingMagnetSelectionTask(await loadPendingTasks(), gid)
      if (task) resolved = { metadataGid: gid, downloadGid: task.gid }
    }

    if (!resolved || !task) {
      if (metadataQueryError !== undefined) {
        logger.debug(
          'MagnetMetadata.resolve',
          formatLogFields({ gid, outcome: 'skipped', reason: getErrorMessage(metadataQueryError) }),
        )
      }
      return false
    }

    const files = await deps.getFiles(resolved.downloadGid)
    const realFiles = files.filter((file) => Number(file.length) > 0)
    if (realFiles.length === 0) return false

    if (state.visible || !state.pendingGids.includes(gid)) return false

    const parsed = parseFilesForSelection(realFiles)
    state.files = parsed
    state.session = resolved
    state.name = task.bittorrent?.info?.name || parsed[0]?.name || deps.fallbackName()
    state.visible = true
    return true
  } catch (error) {
    logger.debug('MagnetMetadata.resolve', formatLogFields({ gid, outcome: 'skipped', reason: getErrorMessage(error) }))
    return false
  }
}

export async function resolveNextPendingMagnetMetadata(deps: MagnetMetadataDeps): Promise<void> {
  if (deps.state.visible) return
  let pendingTasks: Promise<Aria2Task[]> | undefined
  const loadPendingTasks = () => (pendingTasks ??= deps.fetchPendingTasks())
  for (const gid of [...deps.state.pendingGids]) {
    if (await resolvePendingMagnetMetadata(deps, gid, loadPendingTasks)) return
  }
}

export function createMagnetMetadataResolver(getDeps: () => MagnetMetadataDeps): MagnetMetadataResolver {
  let running = false
  let requested = false

  async function request(gid?: string): Promise<void> {
    if (gid && !getDeps().state.pendingGids.includes(gid)) return

    requested = true
    if (running) return

    running = true
    try {
      while (requested) {
        requested = false
        const deps = getDeps()
        if (deps.state.visible) continue
        await resolveNextPendingMagnetMetadata(deps)
      }
    } finally {
      running = false
    }
  }

  return { request }
}

export async function listenForAria2DownloadComplete(
  onComplete: (gid: string) => unknown | Promise<unknown>,
): Promise<() => void> {
  return listen<{ gid: string }>('aria2-event:download-complete', (event) => {
    void onComplete(event.payload.gid)
  })
}
