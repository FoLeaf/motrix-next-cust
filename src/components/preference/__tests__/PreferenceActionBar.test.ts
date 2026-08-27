/** @fileoverview Interaction-state tests for the shared preference action bar. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { NButton } from 'naive-ui'
import PreferenceActionBar from '../PreferenceActionBar.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('PreferenceActionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps save and discard inactive when the form is clean', () => {
    const wrapper = mount(PreferenceActionBar, { props: { isDirty: false } })
    const [save, discard, restart] = wrapper.findAllComponents(NButton)

    expect(save.props('type')).toBe('default')
    expect(save.props('disabled')).toBe(true)
    expect(discard.props('type')).toBe('default')
    expect(discard.props('disabled')).toBe(true)
    expect(restart.props('disabled')).toBe(false)
  })

  it('uses primary save and semantic error discard when the form is dirty', () => {
    const wrapper = mount(PreferenceActionBar, { props: { isDirty: true } })
    const [save, discard] = wrapper.findAllComponents(NButton)

    expect(save.props('type')).toBe('primary')
    expect(save.props('disabled')).toBe(false)
    expect(discard.props('type')).toBe('error')
    expect(discard.props('ghost')).toBe(true)
    expect(discard.props('disabled')).toBe(false)
  })
})
