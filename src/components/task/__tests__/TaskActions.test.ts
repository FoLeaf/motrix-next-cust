/**
 * @fileoverview Integration tests for TaskActions.vue.
 *
 * Key behaviors under test:
 * - Engine guard: resumeAll/pauseAll block when engine not ready (purgeRecord has no gate)
 * - Refresh debounce: rapid clicks coalesce via 500ms timer
 * - Confirmation dialogs: all destructive actions require user confirmation
 * - Delete-all: batch removal with optional file deletion
 *
 * These are REAL integration tests using @vue/test-utils mount() with Pinia store.
 * All Tauri/Naive UI dependencies are mocked, but component ↔ store interaction is real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// ── Mock registry (shared refs for assertion access) ────────────────

const mockIsEngineReady = vi.fn().mockReturnValue(true)
const mockFetchList = vi.fn().mockResolvedValue(undefined)
const mockResumeAllTask = vi.fn().mockResolvedValue({ resumed: 1, blocked: 0 })
const mockPauseAllTask = vi.fn().mockResolvedValue(undefined)
const mockPurgeTaskRecord = vi.fn().mockResolvedValue(undefined)
const mockBatchRemoveTask = vi.fn().mockResolvedValue(undefined)
const mockStopAllSharing = vi.fn().mockResolvedValue(2)
const mockDeleteTaskFiles = vi.fn().mockResolvedValue(undefined)

// Dialog mock: captures onPositiveClick so we can invoke it in tests
let lastDialogOptions: Record<string, unknown> | null = null
const mockDialogWarning = vi.fn((opts: Record<string, unknown>) => {
  lastDialogOptions = opts
  return { loading: false, negativeButtonProps: {}, closable: true, maskClosable: true, destroy: vi.fn() }
})

// Message mock: captures calls for assertion
const mockMessageSuccess = vi.fn(() => ({ destroy: vi.fn() }))
const mockMessageWarning = vi.fn(() => ({ destroy: vi.fn() }))
const mockMessageError = vi.fn(() => ({ destroy: vi.fn() }))

function renderDialogText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value !== 'function') return ''
  const parts: string[] = []
  const walk = (node: unknown) => {
    if (typeof node === 'string') {
      parts.push(node)
      return
    }
    if (!node || typeof node !== 'object') return
    const children = (node as { children?: unknown }).children
    if (Array.isArray(children)) {
      children.forEach(walk)
      return
    }
    if (typeof children === 'string') {
      parts.push(children)
      return
    }
    if (children && typeof children === 'object') {
      const defaultSlot = (children as { default?: () => unknown }).default
      if (typeof defaultSlot === 'function') walk(defaultSlot())
    }
  }
  walk(value())
  return parts.join(' ')
}

// ── Module mocks ────────────────────────────────────────────────────

vi.mock('@/api/aria2', () => ({
  isEngineReady: () => mockIsEngineReady(),
}))

function translateForTest(key: string, params?: Record<string, unknown>): string {
  const messages: Record<string, string> = {
    'task.delete-all-task': 'Clear Download Queue',
    'task.delete-task-queue': 'Clear Download Queue',
    'task.batch-delete-task-confirm': `This will remove ${params?.count ?? '{count}'} downloading, queued, or paused task(s).`,
    'task.delete-local-files-trash-label': 'Move files to Trash',
    'task.delete-local-files-permanent-label': 'Permanently delete files',
    'task.purge-record': 'Clear History Records',
    'task.purge-record-confirm': 'This will remove all completed, failed, or removed task records.',
  }
  return messages[key] ?? key
}

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: translateForTest }),
}))

vi.mock('naive-ui', () => ({
  NButton: {
    template: '<button :disabled="disabled"><slot /><slot name="icon" /></button>',
    props: ['type', 'circle', 'size', 'quaternary', 'disabled'],
  },
  NIcon: { template: '<span :class="$attrs.class"><slot /></span>' },
  NTooltip: { template: '<span><slot /><slot name="trigger" /></span>' },
  NCheckbox: { template: '<label><slot /></label>', props: ['checked'] },
  NPopover: {
    template: '<div><slot name="trigger" /></div>',
    props: ['show', 'trigger', 'placement', 'showArrow', 'raw'],
  },
  useDialog: () => ({
    error: mockDialogWarning,
    info: mockDialogWarning,
    warning: mockDialogWarning,
  }),
  useMessage: () => ({
    success: mockMessageSuccess,
    error: mockMessageError,
    warning: mockMessageWarning,
    info: vi.fn(() => ({ destroy: vi.fn() })),
  }),
}))

vi.mock('@vicons/ionicons5', () => ({
  AddOutline: { template: '<i />' },
  PlayOutline: { template: '<i />' },
  PauseOutline: { template: '<i />' },
  TrashOutline: { template: '<i />' },
  RefreshOutline: { template: '<i />' },
  CloseOutline: { template: '<i />' },
  StopCircleOutline: { template: '<i />' },
  SyncOutline: { template: '<i />' },
  SwapVerticalOutline: { template: '<i />' },
  ArrowUpOutline: { template: '<i />' },
  ArrowDownOutline: { template: '<i />' },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(false),
  remove: vi.fn().mockResolvedValue(undefined),
  readDir: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/composables/useAppMessage', () => ({
  useAppMessage: () => ({
    success: mockMessageSuccess,
    error: mockMessageError,
    warning: mockMessageWarning,
    info: vi.fn(() => ({ destroy: vi.fn() })),
  }),
}))

vi.mock('@/composables/useFileDelete', () => ({
  deleteTaskFiles: (...args: unknown[]) => mockDeleteTaskFiles(...args),
}))

import TaskActions from '../TaskActions.vue'
import { usePreferenceStore } from '@/stores/preference'
import { useTaskStore } from '@/stores/task'
import { ref, type Ref } from 'vue'

// ── Helpers ─────────────────────────────────────────────────────────

/** Shared stoppingGids ref provided to component via provide/inject. */
let stoppingGids: Ref<string[]>

const createWrapper = () =>
  mount(TaskActions, {
    global: {
      provide: { stoppingGids },
    },
  })

/**
 * Click the Nth button in the component (0-indexed).
 * Button order in template: [0]Add [1]Refresh [2]ResumeAll [3]PauseAll [4]StopAllSharing [5]DeleteAll
 * When currentList === 'stopped': [0]Add [1]Refresh [2]Purge
 */
async function clickButton(wrapper: ReturnType<typeof createWrapper>, index: number) {
  const buttons = wrapper.findAll('button')
  await buttons[index].trigger('click')
}

// ── Test Suite ──────────────────────────────────────────────────────

describe('TaskActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockIsEngineReady.mockReturnValue(true)
    lastDialogOptions = null

    stoppingGids = ref<string[]>([])

    // Patch store methods so we can track calls without real IPC
    const taskStore = useTaskStore()
    taskStore.fetchList = mockFetchList
    taskStore.resumeAllTask = mockResumeAllTask
    taskStore.pauseAllTask = mockPauseAllTask
    taskStore.purgeTaskRecord = mockPurgeTaskRecord
    taskStore.batchRemoveTask = mockBatchRemoveTask
    taskStore.stopAllSharing = mockStopAllSharing
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Smoke ───────────────────────────────────────────────────────

  it('mounts without errors', () => {
    const wrapper = createWrapper()
    expect(wrapper.find('.task-actions').exists()).toBe(true)
  })

  it('renders all 7 action buttons when list is not stopped', () => {
    const wrapper = createWrapper()
    const buttons = wrapper.findAll('button')
    // Add + Refresh + Sort + ResumeAll + PauseAll + StopAllSharing + DeleteAll = 7
    expect(buttons.length).toBe(7)
  })

  // ── Engine Guard ────────────────────────────────────────────────

  describe('engine guard', () => {
    it('shows warning when resumeAll is clicked and engine is not ready', async () => {
      mockIsEngineReady.mockReturnValue(false)
      const taskStore = useTaskStore()
      taskStore.taskList = [{ gid: 'p1', status: 'paused' }] as never
      const wrapper = createWrapper()

      await clickButton(wrapper, 3) // Resume All

      expect(mockMessageWarning).toHaveBeenCalledOnce()
      expect(mockDialogWarning).not.toHaveBeenCalled() // Dialog should NOT open
    })

    it('shows warning when pauseAll is clicked and engine is not ready', async () => {
      mockIsEngineReady.mockReturnValue(false)
      const taskStore = useTaskStore()
      taskStore.taskList = [{ gid: 'a1', status: 'active' }] as never
      const wrapper = createWrapper()

      await clickButton(wrapper, 4) // Pause All

      expect(mockMessageWarning).toHaveBeenCalledOnce()
      expect(mockDialogWarning).not.toHaveBeenCalled()
    })

    it('opens purgeRecord dialog even when engine is not ready (purge operates on DB only)', async () => {
      mockIsEngineReady.mockReturnValue(false)
      const taskStore = useTaskStore()
      taskStore.currentList = 'stopped'
      const wrapper = createWrapper()

      await clickButton(wrapper, 3) // Purge (index 2 when in stopped list)

      // No engine gate — dialog should open regardless
      expect(mockMessageWarning).not.toHaveBeenCalled()
      expect(mockDialogWarning).toHaveBeenCalledOnce()
    })

    it('opens confirmation dialog for resumeAll when engine IS ready', async () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [{ gid: 'p1', status: 'paused' }] as never
      const wrapper = createWrapper()

      await clickButton(wrapper, 3) // Resume All

      expect(mockMessageWarning).not.toHaveBeenCalled()
      expect(mockDialogWarning).toHaveBeenCalledOnce()
    })

    it('opens confirmation dialog for pauseAll when engine IS ready', async () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [{ gid: 'a1', status: 'active' }] as never
      const wrapper = createWrapper()

      await clickButton(wrapper, 4) // Pause All

      expect(mockMessageWarning).not.toHaveBeenCalled()
      expect(mockDialogWarning).toHaveBeenCalledOnce()
    })

    it('opens confirmation dialog for purgeRecord when engine IS ready', async () => {
      const taskStore = useTaskStore()
      taskStore.currentList = 'stopped'
      const wrapper = createWrapper()

      await clickButton(wrapper, 3) // Purge

      expect(mockMessageWarning).not.toHaveBeenCalled()
      expect(mockDialogWarning).toHaveBeenCalledOnce()
    })
  })

  // ── Disabled State Guards ──────────────────────────────────────

  describe('disabled state guards', () => {
    it('Resume All button is disabled when taskList is empty', () => {
      const wrapper = createWrapper()
      // Button order: [0]Add [1]Refresh [2]ResumeAll [3]PauseAll [4]StopAllSharing [5]DeleteAll
      const resumeBtn = wrapper.findAll('button')[3]
      expect(resumeBtn.attributes('disabled')).toBeDefined()
    })

    it('Pause All button is disabled when taskList is empty', () => {
      const wrapper = createWrapper()
      const pauseBtn = wrapper.findAll('button')[4]
      expect(pauseBtn.attributes('disabled')).toBeDefined()
    })

    it('Resume All button is disabled when only active tasks exist (none paused)', () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [
        { gid: 'a1', status: 'active' },
        { gid: 'a2', status: 'active' },
      ] as never
      const wrapper = createWrapper()
      const resumeBtn = wrapper.findAll('button')[3]
      expect(resumeBtn.attributes('disabled')).toBeDefined()
    })

    it('Pause All button is disabled when only paused tasks exist (none active)', () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [
        { gid: 'p1', status: 'paused' },
        { gid: 'p2', status: 'paused' },
      ] as never
      const wrapper = createWrapper()
      const pauseBtn = wrapper.findAll('button')[4]
      expect(pauseBtn.attributes('disabled')).toBeDefined()
    })

    it('Resume All button is enabled when at least one paused task exists', () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [
        { gid: 'a1', status: 'active' },
        { gid: 'p1', status: 'paused' },
      ] as never
      const wrapper = createWrapper()
      const resumeBtn = wrapper.findAll('button')[3]
      expect(resumeBtn.attributes('disabled')).toBeUndefined()
    })

    it('Pause All button is enabled when at least one active task exists', () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [
        { gid: 'a1', status: 'active' },
        { gid: 'p1', status: 'paused' },
      ] as never
      const wrapper = createWrapper()
      const pauseBtn = wrapper.findAll('button')[4]
      expect(pauseBtn.attributes('disabled')).toBeUndefined()
    })

    it('Pause All button is enabled when waiting tasks exist', () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [{ gid: 'w1', status: 'waiting' }] as never
      const wrapper = createWrapper()
      const pauseBtn = wrapper.findAll('button')[4]
      expect(pauseBtn.attributes('disabled')).toBeUndefined()
    })

    it('Resume All button remains disabled with completed/error/sharing tasks', () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [
        { gid: 'c1', status: 'complete' },
        { gid: 'e1', status: 'error' },
        { gid: 's1', status: 'active', bittorrent: { info: { name: 'x' } }, seeder: 'true' },
      ] as never
      const wrapper = createWrapper()
      const resumeBtn = wrapper.findAll('button')[3]
      expect(resumeBtn.attributes('disabled')).toBeDefined()
    })

    it('disabled Resume All does not open a dialog when clicked', async () => {
      // Empty task list → Resume All should be disabled
      const wrapper = createWrapper()
      await clickButton(wrapper, 3) // Resume All
      expect(mockDialogWarning).not.toHaveBeenCalled()
    })

    it('disabled Pause All does not open a dialog when clicked', async () => {
      // Empty task list → Pause All should be disabled
      const wrapper = createWrapper()
      await clickButton(wrapper, 4) // Pause All
      expect(mockDialogWarning).not.toHaveBeenCalled()
    })
  })

  // ── Refresh Debounce ────────────────────────────────────────────

  describe('refresh debounce', () => {
    it('calls fetchList on refresh click', async () => {
      const wrapper = createWrapper()

      await clickButton(wrapper, 2) // Refresh

      expect(mockFetchList).toHaveBeenCalledOnce()
    })

    it('sets spinning animation for 500ms', async () => {
      const wrapper = createWrapper()

      await clickButton(wrapper, 2) // Refresh

      // Spinning class should be applied
      expect(wrapper.find('.spinning').exists()).toBe(true)

      // After 500ms, spinning should stop
      vi.advanceTimersByTime(500)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.spinning').exists()).toBe(false)
    })

    it('resets timer on rapid successive clicks', async () => {
      const wrapper = createWrapper()

      await clickButton(wrapper, 2) // Click 1
      vi.advanceTimersByTime(200)
      await clickButton(wrapper, 2) // Click 2 (200ms later — before 500ms expires)

      // fetchList should have been called twice
      expect(mockFetchList).toHaveBeenCalledTimes(2)

      // Spinning should still be active (timer was reset)
      expect(wrapper.find('.spinning').exists()).toBe(true)

      // After 500ms from the SECOND click, spinning should stop
      vi.advanceTimersByTime(500)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.spinning').exists()).toBe(false)
    })

    it('shows success message when fetchList succeeds', async () => {
      mockFetchList.mockResolvedValueOnce(undefined)
      const wrapper = createWrapper()

      await clickButton(wrapper, 2)
      await vi.runAllTimersAsync()

      expect(mockMessageSuccess).toHaveBeenCalled()
    })
  })

  // ── Confirmation Dialogs ────────────────────────────────────────

  describe('confirmation dialogs', () => {
    it('resumeAll dialog calls resumeAllTask on positive click', async () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [{ gid: 'p1', status: 'paused' }] as never
      const wrapper = createWrapper()

      await clickButton(wrapper, 3) // Resume All
      expect(lastDialogOptions).not.toBeNull()

      // Simulate user clicking "Yes"
      const onPositiveClick = lastDialogOptions!.onPositiveClick as () => void
      onPositiveClick()

      expect(mockResumeAllTask).toHaveBeenCalledOnce()
    })

    it('resumeAll shows success message after execution', async () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [{ gid: 'p1', status: 'paused' }] as never
      const wrapper = createWrapper()

      await clickButton(wrapper, 3)
      const onPositiveClick = lastDialogOptions!.onPositiveClick as () => void
      onPositiveClick()
      await vi.runAllTimersAsync()

      expect(mockMessageSuccess).toHaveBeenCalled()
    })

    it('resumeAll shows error message on failure', async () => {
      mockResumeAllTask.mockRejectedValueOnce(new Error('rpc fail'))
      const taskStore = useTaskStore()
      taskStore.taskList = [{ gid: 'p1', status: 'paused' }] as never
      const wrapper = createWrapper()

      await clickButton(wrapper, 3)
      const onPositiveClick = lastDialogOptions!.onPositiveClick as () => Promise<void>
      await onPositiveClick()
      await vi.runAllTimersAsync()

      expect(mockMessageError).toHaveBeenCalled()
    })

    it('pauseAll dialog calls pauseAllTask on positive click', async () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [{ gid: 'a1', status: 'active' }] as never
      const wrapper = createWrapper()

      await clickButton(wrapper, 4) // Pause All
      const onPositiveClick = lastDialogOptions!.onPositiveClick as () => false
      onPositiveClick()
      // Flush the fire-and-forget .then() chain
      await vi.runAllTimersAsync()

      expect(mockPauseAllTask).toHaveBeenCalledOnce()
    })

    it('purgeRecord dialog calls purgeTaskRecord on positive click', async () => {
      const taskStore = useTaskStore()
      taskStore.currentList = 'stopped'
      const wrapper = createWrapper()

      await clickButton(wrapper, 3) // Purge
      expect(lastDialogOptions?.title).toBe('Clear History Records')
      expect(renderDialogText(lastDialogOptions?.content)).toContain(
        'This will remove all completed, failed, or removed task records.',
      )
      expect(renderDialogText(lastDialogOptions?.content)).toContain('Move files to Trash')
      const onPositiveClick = lastDialogOptions!.onPositiveClick as () => Promise<void>
      // onPositiveClick has internal setTimeout(50) — must advance timer
      const promise = onPositiveClick()
      await vi.advanceTimersByTimeAsync(100)
      await promise

      expect(mockPurgeTaskRecord).toHaveBeenCalledOnce()
    })
  })

  // ── Delete All ──────────────────────────────────────────────────

  describe('delete all', () => {
    it('does nothing when task list is empty', async () => {
      const wrapper = createWrapper()
      // taskList is empty by default — the delete-all button should be disabled
      const deleteBtn = wrapper.findAll('button')[6]
      expect(deleteBtn.attributes('disabled')).toBeDefined()
    })

    it('opens dialog with batch count when tasks exist', async () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [{ gid: 'g1' }, { gid: 'g2' }] as never

      const wrapper = createWrapper()
      await clickButton(wrapper, 6) // Delete All

      expect(mockDialogWarning).toHaveBeenCalledOnce()
      expect(lastDialogOptions?.title).toBe('Clear Download Queue')
      expect(renderDialogText(lastDialogOptions?.content)).toContain(
        'This will remove 2 downloading, queued, or paused task(s).',
      )
      expect(renderDialogText(lastDialogOptions?.content)).toContain('Move files to Trash')
    })

    it('shows the permanent deletion action when configured', async () => {
      const preferenceStore = usePreferenceStore()
      preferenceStore.config.fileDeletionMode = 'permanent'
      const taskStore = useTaskStore()
      taskStore.taskList = [{ gid: 'g1' }] as never

      const wrapper = createWrapper()
      await clickButton(wrapper, 6)

      expect(renderDialogText(lastDialogOptions?.content)).toContain('Permanently delete files')
    })

    it('calls batchRemoveTask with all gids on confirmation', async () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [{ gid: 'g1' }, { gid: 'g2' }, { gid: 'g3' }] as never

      const wrapper = createWrapper()
      await clickButton(wrapper, 6) // Delete All

      const onPositiveClick = lastDialogOptions!.onPositiveClick as () => Promise<void>
      // onPositiveClick has internal setTimeout(50) — must advance timer
      const promise = onPositiveClick()
      await vi.advanceTimersByTimeAsync(100)
      await promise

      expect(mockBatchRemoveTask).toHaveBeenCalledWith(['g1', 'g2', 'g3'])
    })

    it('shows success message after batch deletion', async () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [{ gid: 'g1' }] as never

      const wrapper = createWrapper()
      await clickButton(wrapper, 6)

      const onPositiveClick = lastDialogOptions!.onPositiveClick as () => Promise<void>
      const promise = onPositiveClick()
      await vi.advanceTimersByTimeAsync(100)
      await promise

      expect(mockMessageSuccess).toHaveBeenCalled()
    })
  })

  // ── Stop All Sharing Animation Linkage ──────────────────────────

  describe('stop all sharing animation', () => {
    it('pushes all sharing gids into stoppingGids on positive click', async () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [
        { gid: 's1', status: 'active', bittorrent: { info: { name: 'a' } }, seeder: 'true' },
        { gid: 'a1' },
        { gid: 's2', status: 'active', bittorrent: { info: { name: 'b' } }, seeder: 'true' },
      ] as never

      const wrapper = createWrapper()
      await clickButton(wrapper, 5) // Stop All Sharing

      const onPositiveClick = lastDialogOptions!.onPositiveClick as () => Promise<void>
      onPositiveClick() // fire-and-forget — watcher keeps spinning
      await wrapper.vm.$nextTick()

      expect(stoppingGids.value).toContain('s1')
      expect(stoppingGids.value).toContain('s2')
      expect(stoppingGids.value).not.toContain('a1')
    })

    it('shows spinning while snapshotted sharing tasks still have seeder=true', async () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [
        { gid: 's1', status: 'active', bittorrent: { info: { name: 'x' } }, seeder: 'true' },
      ] as never

      const wrapper = createWrapper()
      await clickButton(wrapper, 5)

      const onPositiveClick = lastDialogOptions!.onPositiveClick as () => Promise<void>
      onPositiveClick()
      await wrapper.vm.$nextTick()

      // Task still sharing, so the button should spin.
      expect(wrapper.find('.stop-all-spinning').exists()).toBe(true)

      // Simulate task exiting sharing state.
      taskStore.taskList = [{ gid: 's1', bittorrent: { info: { name: 'x' } }, seeder: 'false' }] as never
      await wrapper.vm.$nextTick()

      // Now button should stop spinning
      expect(wrapper.find('.stop-all-spinning').exists()).toBe(false)
    })

    it('ignores new sharing tasks appearing during batch stop', async () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [
        { gid: 's1', status: 'active', bittorrent: { info: { name: 'a' } }, seeder: 'true' },
      ] as never

      const wrapper = createWrapper()
      await clickButton(wrapper, 5)

      const onPositiveClick = lastDialogOptions!.onPositiveClick as () => Promise<void>
      onPositiveClick()
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.stop-all-spinning').exists()).toBe(true)

      // Original task exits, but a new sharing task appears.
      taskStore.taskList = [
        { gid: 's1', bittorrent: { info: { name: 'a' } }, seeder: 'false' },
        { gid: 's_new', status: 'active', bittorrent: { info: { name: 'new' } }, seeder: 'true' },
      ] as never
      await wrapper.vm.$nextTick()

      // Spin should stop — s_new was NOT in the snapshot
      expect(wrapper.find('.stop-all-spinning').exists()).toBe(false)
    })

    it('calls stopAllSharing store method on confirm', async () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [
        { gid: 's1', status: 'active', bittorrent: { info: { name: 'x' } }, seeder: 'true' },
      ] as never

      const wrapper = createWrapper()
      await clickButton(wrapper, 5)

      const onPositiveClick = lastDialogOptions!.onPositiveClick as () => Promise<void>
      await onPositiveClick()

      expect(mockStopAllSharing).toHaveBeenCalledOnce()
    })

    it('stops spinning after safety timeout even if tasks remain sharing', async () => {
      const taskStore = useTaskStore()
      taskStore.taskList = [
        { gid: 's1', status: 'active', bittorrent: { info: { name: 'x' } }, seeder: 'true' },
      ] as never

      const wrapper = createWrapper()
      await clickButton(wrapper, 5)

      const onPositiveClick = lastDialogOptions!.onPositiveClick as () => Promise<void>
      onPositiveClick()
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.stop-all-spinning').exists()).toBe(true)

      // Advance past the 10s safety timeout
      vi.advanceTimersByTime(11000)
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.stop-all-spinning').exists()).toBe(false)
    })
  })

  // ── All View Toolbar ────────────────────────────────────────────

  describe('all view toolbar', () => {
    it('renders all 8 buttons (7 active + 1 purge) when currentList is all', () => {
      const taskStore = useTaskStore()
      taskStore.currentList = 'all'
      const wrapper = createWrapper()
      const buttons = wrapper.findAll('button')
      // Add + Refresh + Sort + ResumeAll + PauseAll + StopAllSharing + DeleteAll + Purge = 8
      expect(buttons.length).toBe(8)
    })

    it('Delete All in all view only targets live tasks (active/paused/waiting)', async () => {
      const taskStore = useTaskStore()
      taskStore.currentList = 'all'
      taskStore.taskList = [
        { gid: 'a1', status: 'active' },
        { gid: 'p1', status: 'paused' },
        { gid: 'c1', status: 'complete' }, // DB-only — must NOT be in batch
        { gid: 'e1', status: 'error' }, // DB-only — must NOT be in batch
      ] as never

      const wrapper = createWrapper()
      // Button order in 'all': [0]Add [1]Refresh [2]ResumeAll [3]PauseAll [4]StopAllSharing [5]DeleteAll [6]Purge
      await clickButton(wrapper, 6) // Delete All

      expect(mockDialogWarning).toHaveBeenCalledOnce()

      const onPositiveClick = lastDialogOptions!.onPositiveClick as () => Promise<void>
      const promise = onPositiveClick()
      await vi.advanceTimersByTimeAsync(100)
      await promise

      // Only live tasks should be removed
      expect(mockBatchRemoveTask).toHaveBeenCalledWith(['a1', 'p1'])
    })

    it('Delete All button is disabled in all view when only stopped tasks exist', () => {
      const taskStore = useTaskStore()
      taskStore.currentList = 'all'
      taskStore.taskList = [
        { gid: 'c1', status: 'complete' },
        { gid: 'e1', status: 'error' },
      ] as never
      const wrapper = createWrapper()
      // Delete All button: index 5 in 'all' view
      const deleteBtn = wrapper.findAll('button')[6]
      expect(deleteBtn.attributes('disabled')).toBeDefined()
    })

    it('Delete All button is enabled in all view when at least one live task exists', () => {
      const taskStore = useTaskStore()
      taskStore.currentList = 'all'
      taskStore.taskList = [
        { gid: 'a1', status: 'active' },
        { gid: 'c1', status: 'complete' },
      ] as never
      const wrapper = createWrapper()
      const deleteBtn = wrapper.findAll('button')[6]
      expect(deleteBtn.attributes('disabled')).toBeUndefined()
    })

    it('Purge Records button is visible in all view', () => {
      const taskStore = useTaskStore()
      taskStore.currentList = 'all'
      const wrapper = createWrapper()
      // Last button = Purge
      const purgeBtn = wrapper.findAll('button')[7]
      expect(purgeBtn).toBeDefined()
    })

    it('Purge Records in all view only deletes files for stopped records', async () => {
      const taskStore = useTaskStore()
      taskStore.currentList = 'all'
      taskStore.taskList = [
        { gid: 'a1', status: 'active' },
        { gid: 'p1', status: 'paused' },
        { gid: 'c1', status: 'complete' },
        { gid: 'e1', status: 'error' },
      ] as never

      const wrapper = createWrapper()
      await clickButton(wrapper, 7)

      const content = lastDialogOptions!.content as () => unknown
      const checkbox = Array.isArray((content() as { children?: unknown[] }).children)
        ? ((content() as { children: Array<{ props?: Record<string, unknown> }> }).children[1]?.props ?? {})
        : {}
      ;(checkbox['onUpdate:checked'] as (value: boolean) => void)(true)

      const onPositiveClick = lastDialogOptions!.onPositiveClick as () => Promise<void>
      const promise = onPositiveClick()
      await vi.advanceTimersByTimeAsync(100)
      await promise

      expect(mockDeleteTaskFiles).toHaveBeenCalledTimes(2)
      expect(mockDeleteTaskFiles.mock.calls.map((call) => (call[0] as { gid: string }).gid)).toEqual(['c1', 'e1'])
      expect(mockDeleteTaskFiles.mock.calls.every((call) => call[1] === 'trash')).toBe(true)
      expect(mockPurgeTaskRecord).toHaveBeenCalledOnce()
    })

    it('Resume All works in all view when paused tasks exist', async () => {
      const taskStore = useTaskStore()
      taskStore.currentList = 'all'
      taskStore.taskList = [
        { gid: 'p1', status: 'paused' },
        { gid: 'c1', status: 'complete' },
      ] as never
      const wrapper = createWrapper()
      await clickButton(wrapper, 3) // Resume All
      expect(mockDialogWarning).toHaveBeenCalledOnce()
    })
  })
})
