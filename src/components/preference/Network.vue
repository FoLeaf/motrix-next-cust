<script setup lang="ts">
/** @fileoverview Network preference tab: proxy, ports, user-agent, timeouts, file allocation. */
import { ref, computed, nextTick, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from 'vue-i18n'
import { usePreferenceStore } from '@/stores/preference'
import { usePreferenceForm } from '@/composables/usePreferenceForm'
import { useEngineRestart } from '@/composables/useEngineRestart'
import { useSystemProxyDetect } from '@/composables/useSystemProxyDetect'
import { logger } from '@shared/logger'
import { useAppMessage } from '@/composables/useAppMessage'
import { PROXY_SCOPE_OPTIONS, FILE_ALLOCATION_OPTIONS, ENGINE_RPC_PORT } from '@shared/constants'
import { diffConfig, checkIsNeedRestart } from '@shared/utils/config'
import {
  buildNetworkForm,
  buildNetworkSystemConfig,
  transformNetworkForStore,
  validateNetworkForm,
  randomBtPort,
  randomDhtPort,
} from '@/composables/useNetworkPreference'

import userAgentMap from '@shared/ua'
import { hasUnsafeHeaderChars, sanitizeHeaderValue } from '@shared/utils/headerSanitize'
import {
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NInputGroup,
  NSwitch,
  NSelect,
  NButton,
  NButtonGroup,
  NDivider,
  NIcon,
  NText,
  useDialog,
} from 'naive-ui'
const needsRestart = ref(false)
import PreferenceActionBar from './PreferenceActionBar.vue'
import PreferenceCheckboxGrid from './PreferenceCheckboxGrid.vue'
import { SearchOutline, DiceOutline } from '@vicons/ionicons5'

const { t } = useI18n()
const preferenceStore = usePreferenceStore()
const dialog = useDialog()
const message = useAppMessage()

const proxyScopeOptions = PROXY_SCOPE_OPTIONS.map((s: string) => ({
  label: t(`preferences.proxy-scope-${s}`),
  value: s,
}))

type PortRecoveryTarget = 'rpc' | 'extensionApi' | 'bt' | 'dht' | 'ed2k'
const portRecoveryTargets: PortRecoveryTarget[] = ['rpc', 'extensionApi', 'bt', 'dht', 'ed2k']
const portRecoveryTargetOptions = computed(() => [
  { label: t('preferences.rpc-listen-port'), value: 'rpc' },
  { label: t('preferences.extension-api-port'), value: 'extensionApi' },
  { label: t('preferences.port-conflict-recovery-bt'), value: 'bt' },
  { label: t('preferences.port-conflict-recovery-dht'), value: 'dht' },
  { label: t('preferences.port-conflict-recovery-ed2k'), value: 'ed2k' },
])
const selectedPortRecoveryTargets = computed<string[]>({
  get: () => portRecoveryTargets.filter((target) => form.value.portConflictRecovery[target]),
  set: (targets) => {
    const selected = new Set(targets)
    for (const target of portRecoveryTargets) {
      form.value.portConflictRecovery[target] = selected.has(target)
    }
  },
})

// ── Proxy detection ─────────────────────────────────────────────────
const { detecting: detectingProxy, detect: detectProxy } = useSystemProxyDetect({
  onSuccess(info) {
    form.value.proxy.server = info.server
    if (info.bypass) form.value.proxy.bypass = info.bypass
    if (!form.value.proxy.enable) form.value.proxy.enable = true
    message.success(t('preferences.proxy-detected-success'))
  },
  onSocks() {
    message.warning(t('preferences.proxy-system-socks-rejected'))
  },
  onNotFound() {
    message.info(t('preferences.proxy-system-not-detected'))
  },
  onError() {
    message.error(t('preferences.proxy-system-detect-failed'))
  },
})

function buildForm() {
  return buildNetworkForm(preferenceStore.config)
}

const { restartEngine } = useEngineRestart()

const { form, isDirty, handleSave, handleReset, resetSnapshot } = usePreferenceForm({
  buildForm,
  buildSystemConfig: buildNetworkSystemConfig,
  transformForStore: transformNetworkForStore,
  beforeSave: async (f) => {
    const validationKey = validateNetworkForm(f)
    if (validationKey) {
      message.error(t(validationKey))
      return false
    }

    // Gate: engine restart confirmation (BT/DHT port change).
    // Must confirm BEFORE saving — declining cancels the entire save so
    // config.json never contains values the running engine doesn't match.
    const changed = diffConfig(preferenceStore.config, f)
    if (checkIsNeedRestart(changed)) {
      const ok = await new Promise<boolean>((resolve) => {
        dialog.warning({
          title: t('preferences.engine-restart-title'),
          content: t('preferences.engine-restart-confirm'),
          positiveText: t('preferences.engine-restart-now'),
          negativeText: t('app.cancel'),
          maskClosable: false,
          onPositiveClick: () => resolve(true),
          onNegativeClick: () => resolve(false),
          onClose: () => resolve(false),
        })
      })
      if (!ok) return false
      needsRestart.value = true
    }

    return true
  },
  afterSave: async (f, prevConfig) => {
    // Sync UPnP mapping state after save
    if (
      f.enableUpnp !== prevConfig.enableUpnp ||
      (f.enableUpnp && (f.listenPort !== prevConfig.listenPort || f.dhtListenPort !== prevConfig.dhtListenPort))
    ) {
      syncUpnpState(!!f.enableUpnp, f.listenPort, f.dhtListenPort, preferenceStore.config.ed2kListenPort)
    }

    // Engine restart — user already confirmed in beforeSave, execute immediately.
    if (needsRestart.value) {
      needsRestart.value = false
      const port = (preferenceStore.config.rpcListenPort as number) || ENGINE_RPC_PORT
      const secret = (preferenceStore.config.rpcSecret as string) || ''
      message.info(t('preferences.engine-restarting'))
      await nextTick()
      await new Promise((r) => requestAnimationFrame(r))
      await restartEngine({ port, secret })
    }
  },
})

// ── Port randomization ──────────────────────────────────────────────
function onBtPortDice() {
  form.value.listenPort = randomBtPort()
}
function onDhtPortDice() {
  form.value.dhtListenPort = randomDhtPort()
}

// ── UPnP save-time sync ─────────────────────────────────────────────
async function syncUpnpState(enabled: boolean, btPort: number, dhtPort: number, ed2kPort: number) {
  try {
    if (enabled) {
      await invoke('start_upnp_mapping', { btPort, dhtPort, ed2kPort: ed2kPort > 0 ? ed2kPort : null })
    } else {
      await invoke('stop_upnp_mapping')
    }
  } catch (e) {
    logger.warn('UPnP', `sync failed: ${e}`)
    message.warning(t('preferences.upnp-mapping-failed'))
  }
}

// ── User-Agent presets ──────────────────────────────────────────────
function changeUA(type: string) {
  const ua = userAgentMap[type]
  if (ua) form.value.userAgent = ua
}

const uaHasIssue = computed(() => !!form.value.userAgent && hasUnsafeHeaderChars(form.value.userAgent as string))

function cleanUserAgent() {
  form.value.userAgent = sanitizeHeaderValue(form.value.userAgent as string)
}

function handleManualRestart() {
  const port = (preferenceStore.config.rpcListenPort as number) || ENGINE_RPC_PORT
  const secret = (preferenceStore.config.rpcSecret as string) || ''
  const d = dialog.warning({
    title: t('preferences.engine-restart-title'),
    content: t('preferences.engine-restart-manual-confirm'),
    positiveText: t('preferences.engine-restart-now'),
    negativeText: t('preferences.engine-restart-later'),
    maskClosable: false,
    onPositiveClick: async () => {
      d.loading = true
      d.negativeText = ''
      d.closable = false
      message.info(t('preferences.engine-restarting'))
      await new Promise((r) => requestAnimationFrame(r))
      await restartEngine({ port, secret })
    },
  })
}

onMounted(() => {
  Object.assign(form.value, buildForm())
  resetSnapshot()
})
</script>

<template>
  <div class="preference-form-wrapper">
    <NForm label-placement="left" label-align="left" label-width="260px" size="small" class="form-preference">
      <!-- Proxy -->
      <NDivider title-placement="left">{{ t('preferences.proxy') }}</NDivider>
      <NFormItem :label="t('preferences.enable-proxy')">
        <NSwitch v-model:value="form.proxy.enable" />
      </NFormItem>
      <div class="proxy-collapse" :class="{ 'proxy-collapse--open': form.proxy.enable }">
        <div class="proxy-collapse__inner collapse-indent">
          <NFormItem :label="t('preferences.proxy-server')">
            <NInputGroup>
              <NInput v-model:value="form.proxy.server" placeholder="[http://][USER:PASSWORD@]HOST[:PORT]" />
              <NButton :loading="detectingProxy" @click="detectProxy">
                <template #icon>
                  <NIcon><SearchOutline /></NIcon>
                </template>
                {{ t('preferences.detect-system-proxy') }}
              </NButton>
            </NInputGroup>
          </NFormItem>
          <NFormItem :show-label="false">
            <div class="info-text">{{ t('preferences.proxy-http-only-hint') }}</div>
          </NFormItem>
          <NFormItem :label="t('preferences.proxy-bypass')">
            <NInput
              v-model:value="form.proxy.bypass"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 3 }"
              :placeholder="t('preferences.proxy-bypass-input-tips')"
            />
          </NFormItem>
          <NFormItem :label="t('preferences.proxy-scope')">
            <NSelect v-model:value="form.proxy.scope" :options="proxyScopeOptions" multiple style="width: 100%" />
          </NFormItem>
        </div>
      </div>

      <!-- Port conflict recovery -->
      <NDivider title-placement="left">{{ t('preferences.port-conflict-recovery') }}</NDivider>
      <NFormItem :label="t('preferences.port-conflict-recovery-enable')">
        <NSwitch v-model:value="form.portConflictRecovery.enabled" />
      </NFormItem>
      <div
        class="port-recovery-collapse"
        :class="{ 'port-recovery-collapse--open': form.portConflictRecovery.enabled }"
      >
        <div class="port-recovery-collapse__inner collapse-indent">
          <NFormItem :label="t('preferences.port-conflict-recovery-range')">
            <NInputGroup>
              <NInputNumber
                v-model:value="form.portConflictRecovery.rangeStart"
                :min="1024"
                :max="65535"
                style="width: 140px"
              />
              <span class="port-range-separator">to</span>
              <NInputNumber
                v-model:value="form.portConflictRecovery.rangeEnd"
                :min="1024"
                :max="65535"
                style="width: 140px"
              />
            </NInputGroup>
          </NFormItem>
          <NFormItem :show-label="false">
            <div class="info-text">{{ t('preferences.port-conflict-recovery-range-hint') }}</div>
          </NFormItem>
          <NFormItem :label="t('preferences.port-conflict-recovery-apply-to')">
            <PreferenceCheckboxGrid v-model:value="selectedPortRecoveryTargets" :options="portRecoveryTargetOptions" />
          </NFormItem>
        </div>
      </div>

      <!-- Ports -->
      <NDivider title-placement="left">{{ t('preferences.port') }}</NDivider>
      <NFormItem label="UPnP/NAT-PMP">
        <NSwitch v-model:value="form.enableUpnp" />
      </NFormItem>
      <NFormItem :label="t('preferences.bt-port')">
        <NInputGroup>
          <NInputNumber v-model:value="form.listenPort" :min="1024" :max="65535" style="width: 160px" />
          <NButton style="padding: 0 10px" @click="onBtPortDice">
            <template #icon>
              <NIcon :size="14"><DiceOutline /></NIcon>
            </template>
          </NButton>
        </NInputGroup>
      </NFormItem>
      <NFormItem :label="t('preferences.dht-port')">
        <NInputGroup>
          <NInputNumber v-model:value="form.dhtListenPort" :min="1024" :max="65535" style="width: 160px" />
          <NButton style="padding: 0 10px" @click="onDhtPortDice">
            <template #icon>
              <NIcon :size="14"><DiceOutline /></NIcon>
            </template>
          </NButton>
        </NInputGroup>
      </NFormItem>

      <!-- User-Agent -->
      <NDivider title-placement="left">{{ t('preferences.user-agent') }}</NDivider>
      <NFormItem :label="t('preferences.mock-user-agent')">
        <div class="ua-field-wrapper">
          <NInput
            v-model:value="form.userAgent"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 4 }"
            placeholder="User-Agent"
          />
          <div class="ua-warn-collapse" :class="{ 'ua-warn-collapse--open': uaHasIssue }">
            <div class="ua-warn-collapse__inner">
              <div class="ua-warn-bar">
                <span class="ua-warn-text">⚠ {{ t('preferences.ua-unsafe-chars-detected') }}</span>
                <NButton size="tiny" type="primary" ghost @click="cleanUserAgent">
                  {{ t('preferences.ua-sanitize') }}
                </NButton>
              </div>
            </div>
          </div>
        </div>
      </NFormItem>
      <NFormItem :show-label="false">
        <div class="ua-preset-row">
          <NButtonGroup size="small">
            <NButton @click="changeUA('chrome')">Chrome</NButton>
            <NButton @click="changeUA('edge')">Edge</NButton>
            <NButton @click="changeUA('safari')">Safari</NButton>
            <NButton @click="changeUA('firefox')">Firefox</NButton>
            <NButton @click="changeUA('transmission')">Transmission</NButton>
          </NButtonGroup>
          <NButton class="ua-reset-btn" size="small" ghost @click="form.userAgent = ''">
            {{ t('preferences.ua-reset') }}
          </NButton>
        </div>
      </NFormItem>

      <!-- Timeout & Disk -->
      <NDivider title-placement="left">{{ t('preferences.transfer-params') }}</NDivider>
      <NFormItem :label="t('preferences.connect-timeout')">
        <NInputNumber v-model:value="form.connectTimeout" :min="1" :max="600" style="width: 120px" />
        <NText depth="3" style="font-size: 12px; margin-left: 8px">{{ t('preferences.unit-seconds') }}</NText>
      </NFormItem>
      <NFormItem :label="t('preferences.timeout')">
        <NInputNumber v-model:value="form.timeout" :min="1" :max="600" style="width: 120px" />
        <NText depth="3" style="font-size: 12px; margin-left: 8px">{{ t('preferences.unit-seconds') }}</NText>
      </NFormItem>
      <NFormItem :label="t('preferences.file-allocation')">
        <NSelect
          v-model:value="form.fileAllocation"
          :options="FILE_ALLOCATION_OPTIONS.map((v: string) => ({ label: v, value: v }))"
          style="width: 140px"
        />
      </NFormItem>
      <NFormItem class="hinted-form-item">
        <template #label>
          <div class="form-label-with-hint">
            <div>{{ t('preferences.async-dns') }}</div>
            <div class="info-text">{{ t('preferences.async-dns-hint') }}</div>
          </div>
        </template>
        <NSwitch v-model:value="form.asyncDns" />
      </NFormItem>
    </NForm>
    <PreferenceActionBar :is-dirty="isDirty" @save="handleSave" @discard="handleReset" @restart="handleManualRestart" />
  </div>
</template>

<style scoped>
.preference-form-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.form-preference {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px 30px 64px 36px;
}
.form-preference :deep(.n-form-item) {
  padding-left: 50px;
}
.form-preference :deep(.collapse-indent) {
  margin-left: 16px;
}
.info-text {
  color: var(--m3-on-surface-variant);
  font-size: 12px;
  max-width: 520px;
  word-wrap: break-word;
}

/* ── Proxy collapse — CSS Grid 0fr→1fr ───────────────────────────── */
.proxy-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.35s cubic-bezier(0.2, 0, 0, 1);
}
.proxy-collapse--open {
  grid-template-rows: 1fr;
}
.proxy-collapse__inner {
  overflow: hidden;
}
.port-recovery-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.35s cubic-bezier(0.2, 0, 0, 1);
}
.port-recovery-collapse--open {
  grid-template-rows: 1fr;
}
.port-recovery-collapse__inner {
  overflow: hidden;
}
.port-range-separator {
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  color: var(--m3-on-surface-variant);
  font-size: 12px;
  line-height: 1;
}
/* ── UA preset row ───────────────────────────────────────────────── */
.ua-preset-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.ua-field-wrapper {
  display: flex;
  flex-direction: column;
  width: 100%;
}
.ua-warn-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.35s cubic-bezier(0.2, 0, 0, 1);
}
.ua-warn-collapse--open {
  grid-template-rows: 1fr;
}
.ua-warn-collapse__inner {
  overflow: hidden;
}
.ua-warn-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  margin-top: 6px;
  border-radius: var(--border-radius);
  background: var(--m3-error-container-bg);
  opacity: 0;
  transition: opacity 0.25s cubic-bezier(0.2, 0, 0, 1);
}
.ua-warn-collapse--open .ua-warn-bar {
  opacity: 1;
}
.ua-warn-text {
  font-size: var(--font-size-sm);
  color: var(--m3-error);
  flex: 1;
}
.ua-reset-btn {
  --btn-muted: #c97070;
  color: var(--btn-muted) !important;
  transition:
    color 0.35s cubic-bezier(0.2, 0, 0, 1),
    background-color 0.35s cubic-bezier(0.2, 0, 0, 1),
    border-color 0.35s cubic-bezier(0.2, 0, 0, 1);
}
.ua-reset-btn:hover {
  background-color: color-mix(in srgb, var(--btn-muted) 12%, transparent) !important;
}
.ua-reset-btn :deep(.n-button__border) {
  border-color: var(--btn-muted) !important;
  transition: border-color 0.35s cubic-bezier(0.2, 0, 0, 1);
}
.ua-reset-btn :deep(.n-button__state-border) {
  transition: border-color 0.35s cubic-bezier(0.2, 0, 0, 1);
}
</style>
