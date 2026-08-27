<script setup lang="ts">
/** @fileoverview Shared save/discard/restart action bar for preference pages. */
import { useI18n } from 'vue-i18n'
import { NButton, NSpace, NIcon } from 'naive-ui'
import { RefreshOutline } from '@vicons/ionicons5'

defineProps<{ isDirty: boolean }>()
defineEmits<{ save: []; discard: []; restart: [] }>()

const { t } = useI18n()
</script>

<template>
  <div class="form-actions">
    <NSpace :size="12" align="center">
      <NButton :type="isDirty ? 'primary' : 'default'" :disabled="!isDirty" @click="$emit('save')">
        {{ t('preferences.save') }}
      </NButton>
      <NButton :type="isDirty ? 'error' : 'default'" :ghost="isDirty" :disabled="!isDirty" @click="$emit('discard')">
        {{ t('preferences.discard') }}
      </NButton>
    </NSpace>
    <NButton type="info" ghost @click="$emit('restart')">
      <template #icon>
        <NIcon :size="16"><RefreshOutline /></NIcon>
      </template>
      {{ t('preferences.engine-restart-btn') }}
    </NButton>
  </div>
</template>

<style scoped>
.form-actions {
  display: flex;
  align-items: center;
  gap: 32px;
  padding: 16px 24px 16px 40px;
}
</style>
