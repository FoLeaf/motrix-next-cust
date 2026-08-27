<script setup lang="ts">
/** @fileoverview Shared adaptive secondary navigation pane. */
import { NIcon } from 'naive-ui'
import type { Component } from 'vue'
import SubnavCount from '@/components/layout/SubnavCount.vue'

export interface SubnavPaneItem {
  key: string
  label: string
  icon: Component
  route: string
  active: boolean
  count?: number
  ariaLabel?: string
}

defineProps<{
  title: string
  items: SubnavPaneItem[]
}>()

defineEmits<{
  navigate: [route: string]
}>()
</script>

<template>
  <aside class="subnav" data-tauri-drag-region>
    <nav class="subnav-inner" data-tauri-drag-region>
      <h3>{{ title }}</h3>
      <ul>
        <li v-for="item in items" :key="item.key">
          <button
            type="button"
            class="subnav-button"
            :class="{ active: item.active }"
            :aria-current="item.active ? 'page' : undefined"
            :aria-label="item.ariaLabel ?? item.label"
            @click="$emit('navigate', item.route)"
          >
            <NIcon :size="16" class="subnav-icon">
              <component :is="item.icon" />
            </NIcon>
            <span class="subnav-label">{{ item.label }}</span>
            <Transition name="subnav-count">
              <SubnavCount v-if="item.count !== undefined" :value="item.count" />
            </Transition>
          </button>
        </li>
      </ul>
    </nav>
  </aside>
</template>

<style scoped>
.subnav {
  width: 100%;
  height: 100%;
  background-color: var(--subnav-bg);
  color: var(--subnav-text);
  overflow-y: auto;
  overflow-x: hidden;
}

.subnav-inner {
  margin-top: var(--header-top-offset);
  padding: 0 16px;
  user-select: none;
}

.subnav-inner h3 {
  font-size: 16px;
  color: var(--subnav-title);
  font-weight: normal;
  line-height: 24px;
  margin: 0 0 20px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.subnav-inner ul {
  list-style: none;
  padding: 0;
  margin: 0;
  cursor: default;
}

.subnav-inner li {
  margin-bottom: 8px;
}

.subnav-button {
  position: relative;
  width: 100%;
  margin-bottom: 8px;
  padding: 8px 10px;
  font-size: 14px;
  line-height: 20px;
  border-radius: 3px;
  cursor: pointer;
  transition:
    background-color 0.3s cubic-bezier(0.2, 0, 0, 1),
    color 0.2s ease;
  display: flex;
  align-items: center;
  text-align: left;
  color: inherit;
  background: transparent;
  border: none;
  min-width: 0;
}

.subnav-button:hover,
.subnav-button.active,
.subnav-button:focus-visible {
  background-color: var(--subnav-active-bg);
  outline: none;
}

.subnav-button:hover span,
.subnav-button:hover .subnav-icon,
.subnav-button:hover :deep(.subnav-count),
.subnav-button.active span,
.subnav-button.active .subnav-icon,
.subnav-button.active :deep(.subnav-count),
.subnav-button:focus-visible span,
.subnav-button:focus-visible .subnav-icon,
.subnav-button:focus-visible :deep(.subnav-count) {
  color: var(--subnav-active-text);
}

.subnav-button:hover :deep(.subnav-count),
.subnav-button.active :deep(.subnav-count),
.subnav-button:focus-visible :deep(.subnav-count) {
  background: color-mix(in srgb, var(--m3-primary) 14%, transparent);
}

.subnav-button span,
.subnav-button .subnav-icon,
.subnav-button :deep(.subnav-count) {
  transition: color 0.2s ease;
}

.subnav-label {
  flex: 1 1 auto;
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}

.subnav-icon {
  flex: 0 0 auto;
  margin-right: 12px;
}

.subnav-count-enter-active {
  transition:
    opacity 0.18s cubic-bezier(0.2, 0, 0, 1),
    transform 0.18s cubic-bezier(0.2, 0, 0, 1);
}

.subnav-count-leave-active {
  transition:
    opacity 0.12s cubic-bezier(0.3, 0, 0.8, 0.15),
    transform 0.12s cubic-bezier(0.3, 0, 0.8, 0.15);
}

.subnav-count-enter-from,
.subnav-count-leave-to {
  opacity: 0;
  transform: scale(0.92);
}

@media (max-width: 799px) {
  .subnav-inner {
    padding: 0 10px;
  }

  .subnav-inner h3 {
    display: none;
  }

  .subnav-button {
    justify-content: center;
    padding: 8px 0;
  }

  .subnav-label {
    display: none;
  }

  .subnav-icon {
    margin-right: 0;
  }

  .subnav-button :deep(.subnav-count) {
    position: absolute;
    top: 2px;
    right: 2px;
    min-width: 14px;
    margin-left: 0;
    padding: 0 4px;
    font-size: 10px;
    line-height: 14px;
  }
}
</style>
