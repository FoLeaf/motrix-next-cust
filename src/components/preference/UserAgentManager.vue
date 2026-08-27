<script setup lang="ts">
/** @fileoverview Single-layer User-Agent profile and rule manager modal. */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NCheckbox, NEmpty, NIcon, NInput, NModal, NSelect, NSpace, NText } from 'naive-ui'
import { vAutoAnimate } from '@formkit/auto-animate'
import { AddOutline } from '@vicons/ionicons5'
import type { UserAgentProfile, UserAgentRule } from '@shared/types'
import { sanitizeHeaderValue } from '@shared/utils/headerSanitize'
import { isValidUserAgentHostPattern } from '@shared/utils/userAgentPolicy'
import { useAppMessage } from '@/composables/useAppMessage'

const props = defineProps<{
  show: boolean
  profiles: UserAgentProfile[]
  rules: UserAgentRule[]
  recentProfileIds: string[]
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  save: [payload: { profiles: UserAgentProfile[]; rules: UserAgentRule[]; recentProfileIds: string[] }]
}>()

type Panel = 'profiles' | 'rules'

const { t } = useI18n()
const message = useAppMessage()

const draftProfiles = ref<UserAgentProfile[]>([])
const draftRules = ref<UserAgentRule[]>([])
const draftRecentProfileIds = ref<string[]>([])
const activePanel = ref<Panel>('profiles')
const selectedProfileId = ref('')
const selectedRuleId = ref('')
const profileDraft = ref({ name: '', value: '' })
const ruleDraft = ref({ enabled: true, hostPattern: '', profileId: '', overridePlugin: false })

const selectedProfile = computed(() => draftProfiles.value.find((profile) => profile.id === selectedProfileId.value))
const selectedRule = computed(() => draftRules.value.find((rule) => rule.id === selectedRuleId.value))
const profileOptions = computed(() =>
  draftProfiles.value.map((profile) => ({
    label: profile.name,
    value: profile.id,
  })),
)
const selectedRuleProfileName = computed(() => profileName(ruleDraft.value.profileId))

function cloneProfiles(profiles: UserAgentProfile[]): UserAgentProfile[] {
  return profiles.map((profile) => ({ ...profile }))
}

function cloneRules(rules: UserAgentRule[]): UserAgentRule[] {
  return rules.map((rule) => ({ ...rule }))
}

function newUserAgentId(prefix: string): string {
  const now = Date.now()
  return `${prefix}-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function profileName(id: string): string {
  return draftProfiles.value.find((profile) => profile.id === id)?.name ?? id
}

function profileMeta(profile: UserAgentProfile): string {
  const ruleCount = draftRules.value.filter((rule) => rule.profileId === profile.id).length
  return ruleCount > 0 ? t('preferences.ua-profile-rule-count', { count: ruleCount }) : t('preferences.ua-no-rules')
}

function ruleMeta(rule: UserAgentRule): string {
  return `${profileName(rule.profileId)} · ${
    rule.overridePlugin ? t('preferences.ua-override-on') : t('preferences.ua-override-off')
  }`
}

function syncProfileDraft(profile: UserAgentProfile | undefined) {
  profileDraft.value = profile ? { name: profile.name, value: profile.value } : { name: '', value: '' }
}

function syncRuleDraft(rule: UserAgentRule | undefined) {
  ruleDraft.value = rule
    ? {
        enabled: rule.enabled,
        hostPattern: rule.hostPattern,
        profileId: rule.profileId,
        overridePlugin: rule.overridePlugin,
      }
    : {
        enabled: true,
        hostPattern: '',
        profileId: draftProfiles.value[0]?.id ?? '',
        overridePlugin: false,
      }
}

function selectProfile(id: string) {
  if (!saveCurrentDraft()) return
  activePanel.value = 'profiles'
  selectedProfileId.value = id
  syncProfileDraft(draftProfiles.value.find((profile) => profile.id === id))
}

function selectRule(id: string) {
  if (!saveCurrentDraft()) return
  activePanel.value = 'rules'
  selectedRuleId.value = id
  syncRuleDraft(draftRules.value.find((rule) => rule.id === id))
}

function addProfile() {
  if (!saveCurrentDraft()) return
  const now = Date.now()
  const profile: UserAgentProfile = {
    id: newUserAgentId('ua'),
    name: t('preferences.ua-new-profile'),
    value: '',
    createdAt: now,
    updatedAt: now,
  }
  draftProfiles.value.push(profile)
  selectProfile(profile.id)
}

function saveProfileDraft(): boolean {
  if (!selectedProfileId.value) return true
  const name = profileDraft.value.name.trim()
  const value = sanitizeHeaderValue(profileDraft.value.value)
  if (!name || !value) {
    message.error(t('preferences.ua-profile-invalid'))
    return false
  }
  draftProfiles.value = draftProfiles.value.map((profile) =>
    profile.id === selectedProfileId.value ? { ...profile, name, value, updatedAt: Date.now() } : profile,
  )
  profileDraft.value = { name, value }
  return true
}

function removeProfile() {
  if (!selectedProfileId.value) return
  if (draftRules.value.some((rule) => rule.profileId === selectedProfileId.value)) {
    message.error(t('preferences.ua-profile-in-use'))
    return
  }
  draftProfiles.value = draftProfiles.value.filter((profile) => profile.id !== selectedProfileId.value)
  draftRecentProfileIds.value = draftRecentProfileIds.value.filter((id) => id !== selectedProfileId.value)
  const next = draftProfiles.value[0]
  selectedProfileId.value = next?.id ?? ''
  syncProfileDraft(next)
}

function addRule() {
  if (!saveCurrentDraft()) return
  if (draftProfiles.value.length === 0) {
    message.error(t('preferences.ua-rule-invalid'))
    return
  }
  const now = Date.now()
  const rule: UserAgentRule = {
    id: newUserAgentId('ua-rule'),
    enabled: true,
    hostPattern: '',
    profileId: draftProfiles.value[0].id,
    overridePlugin: false,
    createdAt: now,
    updatedAt: now,
  }
  draftRules.value.push(rule)
  selectRule(rule.id)
}

function saveRuleDraft(): boolean {
  if (!selectedRuleId.value) return true
  const hostPattern = ruleDraft.value.hostPattern.trim().toLowerCase()
  if (!isValidUserAgentHostPattern(hostPattern) || !ruleDraft.value.profileId) {
    message.error(t('preferences.ua-rule-invalid'))
    return false
  }
  draftRules.value = draftRules.value.map((rule) =>
    rule.id === selectedRuleId.value
      ? {
          ...rule,
          enabled: ruleDraft.value.enabled,
          hostPattern,
          profileId: ruleDraft.value.profileId,
          overridePlugin: ruleDraft.value.overridePlugin,
          updatedAt: Date.now(),
        }
      : rule,
  )
  ruleDraft.value = { ...ruleDraft.value, hostPattern }
  return true
}

function removeRule() {
  if (!selectedRuleId.value) return
  draftRules.value = draftRules.value.filter((rule) => rule.id !== selectedRuleId.value)
  const next = draftRules.value[0]
  selectedRuleId.value = next?.id ?? ''
  syncRuleDraft(next)
}

function saveCurrentDraft(): boolean {
  return activePanel.value === 'profiles' ? saveProfileDraft() : saveRuleDraft()
}

function validateAllDrafts(): boolean {
  if (!saveCurrentDraft()) return false
  for (const profile of draftProfiles.value) {
    if (!profile.name.trim() || !sanitizeHeaderValue(profile.value)) {
      selectProfile(profile.id)
      message.error(t('preferences.ua-profile-invalid'))
      return false
    }
  }
  for (const rule of draftRules.value) {
    if (
      !isValidUserAgentHostPattern(rule.hostPattern) ||
      !draftProfiles.value.some((profile) => profile.id === rule.profileId)
    ) {
      selectRule(rule.id)
      message.error(t('preferences.ua-rule-invalid'))
      return false
    }
  }
  return true
}

function closeModal() {
  emit('update:show', false)
}

function handleSave() {
  if (!validateAllDrafts()) return
  emit('save', {
    profiles: cloneProfiles(draftProfiles.value),
    rules: cloneRules(draftRules.value),
    recentProfileIds: [...draftRecentProfileIds.value],
  })
  closeModal()
}

function resetDraft() {
  draftProfiles.value = cloneProfiles(props.profiles)
  draftRules.value = cloneRules(props.rules)
  draftRecentProfileIds.value = [...props.recentProfileIds]
  activePanel.value = 'profiles'
  selectedProfileId.value = draftProfiles.value[0]?.id ?? ''
  selectedRuleId.value = draftRules.value[0]?.id ?? ''
  syncProfileDraft(selectedProfile.value)
  syncRuleDraft(selectedRule.value)
}

watch(
  () => props.show,
  (show) => {
    if (show) resetDraft()
  },
)
</script>

<template>
  <NModal
    :show="show"
    :mask-closable="false"
    transform-origin="center"
    :transition="{ name: 'fade-scale' }"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <NCard
      :title="t('preferences.ua-manager-title')"
      closable
      class="ua-manager-card"
      :bordered="false"
      @close="closeModal"
    >
      <div class="ua-manager">
        <aside class="ua-manager-sidebar">
          <section class="ua-manager-group">
            <div class="ua-manager-group-header">
              <span>{{ t('preferences.ua-saved') }}</span>
              <NButton size="tiny" quaternary circle @click="addProfile">
                <template #icon>
                  <NIcon><AddOutline /></NIcon>
                </template>
              </NButton>
            </div>
            <div v-auto-animate="{ duration: 220, easing: 'ease-out' }" class="ua-manager-list">
              <button
                v-for="profile in draftProfiles"
                :key="profile.id"
                type="button"
                class="ua-manager-list-item"
                :class="{
                  'ua-manager-list-item--active': activePanel === 'profiles' && selectedProfileId === profile.id,
                }"
                @click="selectProfile(profile.id)"
              >
                <span class="ua-manager-list-title">{{ profile.name }}</span>
                <span class="ua-manager-list-meta">{{ profileMeta(profile) }}</span>
              </button>
              <NEmpty
                v-if="draftProfiles.length === 0"
                size="small"
                class="ua-manager-empty"
                :description="t('task.ua-no-saved')"
              />
            </div>
          </section>

          <section class="ua-manager-group">
            <div class="ua-manager-group-header">
              <span>{{ t('preferences.ua-rules') }}</span>
              <NButton size="tiny" quaternary circle :disabled="draftProfiles.length === 0" @click="addRule">
                <template #icon>
                  <NIcon><AddOutline /></NIcon>
                </template>
              </NButton>
            </div>
            <div v-auto-animate="{ duration: 220, easing: 'ease-out' }" class="ua-manager-list">
              <button
                v-for="rule in draftRules"
                :key="rule.id"
                type="button"
                class="ua-manager-list-item"
                :class="{ 'ua-manager-list-item--active': activePanel === 'rules' && selectedRuleId === rule.id }"
                @click="selectRule(rule.id)"
              >
                <span class="ua-manager-list-title">{{ rule.hostPattern || t('preferences.ua-new-rule') }}</span>
                <span class="ua-manager-list-meta">{{ ruleMeta(rule) }}</span>
              </button>
              <NEmpty
                v-if="draftRules.length === 0"
                size="small"
                class="ua-manager-empty"
                :description="t('preferences.ua-rules')"
              />
            </div>
          </section>
        </aside>

        <section class="ua-manager-editor">
          <Transition name="content-fade" mode="out-in">
            <div
              v-if="activePanel === 'profiles'"
              :key="'profiles-' + selectedProfileId"
              class="ua-manager-editor-content"
            >
              <template v-if="selectedProfileId">
                <div class="ua-manager-field">
                  <span>{{ t('preferences.ua-profile-name') }}</span>
                  <NInput v-model:value="profileDraft.name" size="small" />
                </div>
                <div class="ua-manager-field">
                  <span>{{ t('preferences.user-agent') }}</span>
                  <NInput
                    v-model:value="profileDraft.value"
                    type="textarea"
                    size="small"
                    :autosize="{ minRows: 4, maxRows: 6 }"
                  />
                </div>
              </template>
              <NEmpty v-else class="ua-manager-editor-empty" :description="t('task.ua-no-saved')" />
            </div>

            <div v-else :key="'rules-' + selectedRuleId" class="ua-manager-editor-content">
              <template v-if="selectedRuleId">
                <div class="ua-manager-field">
                  <span>{{ t('preferences.ua-rule-host') }}</span>
                  <NInput v-model:value="ruleDraft.hostPattern" size="small" placeholder="*.example.com" />
                </div>
                <div class="ua-manager-field">
                  <span>{{ t('preferences.ua-rule-profile') }}</span>
                  <NSelect v-model:value="ruleDraft.profileId" :options="profileOptions" size="small" />
                </div>
                <NCheckbox v-model:checked="ruleDraft.overridePlugin">
                  {{ t('preferences.ua-override-plugin') }}
                </NCheckbox>
                <NText depth="3" class="ua-manager-rule-preview">
                  {{ selectedRuleProfileName }}
                </NText>
              </template>
              <NEmpty v-else class="ua-manager-editor-empty" :description="t('preferences.ua-rules')" />
            </div>
          </Transition>
        </section>
      </div>

      <template #footer>
        <NSpace justify="space-between" align="center">
          <div class="ua-manager-footer-left">
            <Transition name="footer-delete" mode="out-in">
              <NButton
                v-if="activePanel === 'profiles' && selectedProfileId"
                key="delete-profile"
                size="small"
                ghost
                type="error"
                @click="removeProfile"
              >
                {{ t('edit.delete') }}
              </NButton>
              <NButton
                v-else-if="activePanel === 'rules' && selectedRuleId"
                key="delete-rule"
                size="small"
                ghost
                type="error"
                @click="removeRule"
              >
                {{ t('edit.delete') }}
              </NButton>
              <NText v-else key="delete-empty" depth="3" />
            </Transition>
          </div>
          <NSpace>
            <NButton @click="closeModal">{{ t('app.cancel') }}</NButton>
            <NButton type="primary" @click="handleSave">{{ t('app.save') }}</NButton>
          </NSpace>
        </NSpace>
      </template>
    </NCard>
  </NModal>
</template>

<style scoped>
.ua-manager-card {
  width: min(840px, calc(100vw - 32px));
  max-height: min(720px, calc(100vh - 48px));
}

.ua-manager-card :deep(.n-card__content) {
  min-height: 0;
  overflow: hidden;
}

.ua-manager {
  display: grid;
  grid-template-columns: minmax(200px, 260px) minmax(0, 1fr);
  gap: 16px;
  height: clamp(360px, 58vh, 520px);
  min-height: 0;
}

.ua-manager-sidebar {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  min-height: 0;
}

.ua-manager-group {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.ua-manager-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
}

.ua-manager-list {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 2px;
}

.ua-manager-list-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  min-height: 54px;
  margin-bottom: 6px;
  padding: 8px 10px;
  border: 1px solid var(--m3-outline-variant);
  border-radius: 8px;
  color: var(--n-text-color);
  background: var(--m3-surface-container-low);
  text-align: left;
  cursor: pointer;
  transition:
    background-color 0.2s cubic-bezier(0.2, 0, 0, 1),
    border-color 0.2s cubic-bezier(0.2, 0, 0, 1),
    transform 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.ua-manager-list-item:hover {
  border-color: var(--m3-primary);
}

.ua-manager-list-item--active {
  border-color: var(--m3-primary);
  background: var(--m3-surface-container-high);
}

.ua-manager-list-title {
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ua-manager-list-meta {
  overflow: hidden;
  color: var(--n-text-color-3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ua-manager-empty {
  padding: 14px 0;
}

.ua-manager-editor {
  min-width: 0;
  min-height: 0;
  padding: 2px 0;
}

.ua-manager-editor-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
}

.ua-manager-editor-empty {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
}

.ua-manager-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
}

.ua-manager-rule-preview {
  font-size: 12px;
}

.ua-manager-footer-left {
  min-width: 76px;
}

.content-fade-enter-active {
  transition: opacity 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.content-fade-leave-active {
  transition: opacity 0.14s cubic-bezier(0.3, 0, 0.8, 0.15);
}

.content-fade-enter-from,
.content-fade-leave-to {
  opacity: 0;
}

.footer-delete-enter-active {
  transition:
    opacity 0.26s cubic-bezier(0.2, 0, 0, 1),
    transform 0.26s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.footer-delete-leave-active {
  transition:
    opacity 0.14s cubic-bezier(0.3, 0, 0.8, 0.15),
    transform 0.14s cubic-bezier(0.3, 0, 0.8, 0.15);
}

.footer-delete-enter-from,
.footer-delete-leave-to {
  opacity: 0;
  transform: scale(0.94);
}
</style>
