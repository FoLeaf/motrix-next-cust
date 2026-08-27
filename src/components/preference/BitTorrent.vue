<script setup lang="ts">
/** @fileoverview BitTorrent preference tab: BT settings + tracker management. */
import { ref, computed, onMounted, h, nextTick } from 'vue'
import type { VNodeChild } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useI18n } from 'vue-i18n'
import { usePreferenceStore } from '@/stores/preference'
import { usePreferenceForm } from '@/composables/usePreferenceForm'
import { useEngineRestart } from '@/composables/useEngineRestart'
import { changeGlobalOption, isEngineReady } from '@/api/aria2'
import { convertTrackerDataToComma, convertTrackerDataToLine, reduceTrackerString } from '@shared/utils/tracker'
import { diffConfig, checkIsNeedRestart } from '@shared/utils/config'
import { SYNC_MIN_DURATION } from '@shared/timing'
import {
  DEFAULT_TRACKER_SOURCE,
  ENGINE_MAX_BT_MAX_PEERS,
  ENGINE_RPC_PORT,
  SAFE_LIMIT_BT_MAX_PEERS,
  TRACKER_SOURCE_OPTIONS,
} from '@shared/constants'
import { logger } from '@shared/logger'
import { getErrorMessage } from '@shared/utils/errorMessage'
import { useAppMessage } from '@/composables/useAppMessage'
import {
  buildBtForm,
  buildBtSystemConfig,
  transformBtForStore,
  isValidTrackerSourceUrl,
  validateBtEndpoint,
  randomBtPort,
  randomDhtPort,
} from '@/composables/useBtPreference'
import {
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NInputGroup,
  NSwitch,
  NSelect,
  NButton,
  NDivider,
  NIcon,
  NCheckbox,
  NCheckboxGroup,
  NText,
  NRadioButton,
  NRadioGroup,
  NCollapseTransition,
  useDialog,
} from 'naive-ui'
import PreferenceActionBar from './PreferenceActionBar.vue'
import PreferenceCheckboxGrid from './PreferenceCheckboxGrid.vue'
import PreferenceHintLabel from './PreferenceHintLabel.vue'
import { SyncOutline, AddCircleOutline, CloseCircleOutline, DiceOutline } from '@vicons/ionicons5'

const { t, locale } = useI18n()
const preferenceStore = usePreferenceStore()
const dialog = useDialog()
const message = useAppMessage()
const DHT_NETWORK_IPV4 = 'ipv4'
const DHT_NETWORK_IPV6 = 'ipv6'

const syncingTracker = ref(false)
const syncingBlocklist = ref(false)
const customTrackerInput = ref('')
const needsRestart = ref(false)
const pendingPortSwitch = ref<{ from: number; to: number } | null>(null)
interface BtPeerBlocklistStatus {
  ruleCount: number
  fileSize: number
  modified: number
  source: string
  bundled: boolean
}
const blocklistStatus = ref<BtPeerBlocklistStatus | null>(null)
const syncIntervalOptions = computed(() => [
  { label: t('preferences.interval-every-startup'), value: 0 },
  { label: t('preferences.interval-6-hours'), value: 6 },
  { label: t('preferences.interval-12-hours'), value: 12 },
  { label: t('preferences.interval-daily'), value: 24 },
  { label: t('preferences.interval-weekly'), value: 168 },
])
const dhtNetworkOptions = computed(() => [
  { label: t('preferences.bt-dht-ipv4'), value: DHT_NETWORK_IPV4 },
  { label: t('preferences.bt-dht-ipv6'), value: DHT_NETWORK_IPV6 },
])
const blocklistStatusText = computed(() => {
  const status = blocklistStatus.value
  if (!status) return t('preferences.bt-peer-blocklist-unavailable')
  const rules = t('preferences.bt-peer-blocklist-rule-count', { count: status.ruleCount })
  const updated = status.modified
    ? new Intl.DateTimeFormat(locale.value, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(status.modified)
    : ''
  return updated ? `${rules} · ${t('preferences.last-sync-time')} ${updated}` : rules
})
const selectedDhtNetworks = computed({
  get: () => {
    const values: string[] = []
    if (form.value.btDhtIpv4Enabled) values.push(DHT_NETWORK_IPV4)
    if (form.value.btDhtIpv6Enabled) values.push(DHT_NETWORK_IPV6)
    return values
  },
  set: (values: string[]) => {
    form.value.btDhtIpv4Enabled = values.includes(DHT_NETWORK_IPV4)
    form.value.btDhtIpv6Enabled = values.includes(DHT_NETWORK_IPV6)
  },
})

// ── Tracker source management ───────────────────────────────────────
const presetTrackerValues = new Set<string>(TRACKER_SOURCE_OPTIONS.map((source) => source.value))

const presetSources = computed({
  get: () => form.value.trackerSource.filter((v: string) => presetTrackerValues.has(v)),
  set: (vals: string[]) => {
    const custom = form.value.trackerSource.filter((v: string) => !presetTrackerValues.has(v))
    form.value.trackerSource = [...vals, ...custom]
  },
})

const customSelectOptions = computed(() =>
  form.value.customTrackerUrls.map((url: string) => ({ label: url, value: url })),
)

const customSources = computed({
  get: () => form.value.trackerSource.filter((v: string) => !presetTrackerValues.has(v)),
  set: (vals: string[]) => {
    const preset = form.value.trackerSource.filter((v: string) => presetTrackerValues.has(v))
    form.value.trackerSource = [...preset, ...vals]
  },
})

function onDeleteCustomTracker(url: string, e: Event) {
  e.stopPropagation()
  form.value.customTrackerUrls = form.value.customTrackerUrls.filter((v: string) => v !== url)
  customSources.value = customSources.value.filter((v: string) => v !== url)
}

function renderCustomOption(info: {
  node: VNodeChild
  option: { value?: string | number }
  selected: boolean
}): VNodeChild {
  const url = String(info.option.value ?? '')
  return h('div', { class: 'custom-tracker-option' }, [
    h('div', { class: 'custom-tracker-option__content' }, [info.node]),
    h(
      'span',
      {
        class: 'custom-tracker-option__delete',
        onClick: (e: Event) => onDeleteCustomTracker(url, e),
      },
      [h(NIcon, { size: 18 }, { default: () => h(CloseCircleOutline) })],
    ),
  ])
}

function openTrackerSource(url: string) {
  openUrl(url).catch((e) => logger.error('BT.openTrackerSource', e))
}

const customPlaceholder = computed(() =>
  form.value.customTrackerUrls.length
    ? t('preferences.bt-tracker-source-custom-select')
    : t('preferences.bt-tracker-source-custom-empty'),
)

function buildForm() {
  const c = preferenceStore.config
  const formData = buildBtForm(c)
  if (!c.trackerSource) {
    formData.trackerSource = [...DEFAULT_TRACKER_SOURCE]
  }
  return formData
}

function buildSafeLimitContent(current: number) {
  return h('div', { style: 'display: flex; flex-direction: column; gap: 8px' }, [
    h(
      'div',
      { style: 'font-weight: 500' },
      `${t('preferences.bt-max-peers')}: ${current} (${t('preferences.recommended-limit', {
        value: SAFE_LIMIT_BT_MAX_PEERS,
      })})`,
    ),
    h('div', { style: 'opacity: 0.75' }, t('preferences.high-bt-peers-reason')),
  ])
}

function confirmBtPeerSafeLimit(f: Record<string, unknown>): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const revert = () => {
      f.btMaxPeers = SAFE_LIMIT_BT_MAX_PEERS
      resolve(false)
    }
    dialog.warning({
      title: t('preferences.safe-limit-warning-title'),
      content: () => buildSafeLimitContent(Number(f.btMaxPeers) || 0),
      positiveText: t('preferences.high-connection-continue'),
      negativeText: t('app.cancel'),
      onPositiveClick: () => resolve(true),
      onNegativeClick: revert,
      onClose: revert,
    })
  })
}

const { form, isDirty, handleSave, handleReset, resetSnapshot, patchSnapshot } = usePreferenceForm({
  buildForm,
  buildSystemConfig: buildBtSystemConfig,
  transformForStore: transformBtForStore,
  saveFeedback: (f, prevConfig) =>
    f.listenPort !== prevConfig.listenPort ||
    f.btExternalIp.trim() !== String(prevConfig.btExternalIp ?? '').trim() ||
    f.btExternalPort !== prevConfig.btExternalPort ||
    f.dhtListenPort !== prevConfig.dhtListenPort
      ? {
          success: t('preferences.bt-connection-apply-succeeded'),
          restored: t('preferences.bt-connection-restore-succeeded'),
          rollbackFailed: t('preferences.bt-connection-restore-failed'),
        }
      : null,
  beforeSave: async (f) => {
    pendingPortSwitch.value = null
    const endpointValidationKey = validateBtEndpoint(f)
    if (endpointValidationKey) {
      message.error(t(endpointValidationKey))
      return false
    }
    f.btExternalIp = f.btExternalIp.trim()
    if (Number(f.listenPort) !== Number(preferenceStore.config.listenPort)) {
      const requestedPort = Number(f.listenPort)
      try {
        const resolvedPort = await invoke<number>('resolve_bt_listen_port', {
          requestedPort: f.listenPort,
        })
        if (resolvedPort !== requestedPort) {
          pendingPortSwitch.value = { from: requestedPort, to: resolvedPort }
        }
        f.listenPort = resolvedPort
      } catch (e) {
        logger.warn('BT.listenPort', getErrorMessage(e))
        message.error(t('preferences.bt-port-unavailable'))
        return false
      }
    }
    if (!isValidTrackerSourceUrl(String(f.btPeerBlocklistUrl))) {
      message.warning(t('preferences.bt-peer-blocklist-invalid-url'))
      return false
    }
    if (typeof f.btMaxPeers === 'number' && f.btMaxPeers > SAFE_LIMIT_BT_MAX_PEERS) {
      const ok = await confirmBtPeerSafeLimit(f)
      if (!ok) return false
    }

    const changed = diffConfig(preferenceStore.config, transformBtForStore(f))
    if (checkIsNeedRestart(changed)) {
      const ok = await new Promise<boolean>((resolve) => {
        dialog.info({
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
    if (needsRestart.value) {
      needsRestart.value = false
      const port = (preferenceStore.config.rpcListenPort as number) || ENGINE_RPC_PORT
      const secret = (preferenceStore.config.rpcSecret as string) || ''
      message.info(t('preferences.engine-restarting'))
      await nextTick()
      await new Promise((r) => requestAnimationFrame(r))
      await restartEngine({ port, secret })
    }
    if (
      preferenceStore.config.enableUpnp &&
      (f.listenPort !== prevConfig.listenPort ||
        f.btExternalPort !== prevConfig.btExternalPort ||
        f.dhtListenPort !== prevConfig.dhtListenPort)
    ) {
      syncUpnpInBackground(f)
    }
    if (pendingPortSwitch.value) {
      const { from, to } = pendingPortSwitch.value
      pendingPortSwitch.value = null
      const ports = `${t('preferences.bt-port')} ${from} -> ${to}`
      message.info(t('preferences.port-auto-switched', { ports }))
    }
    reconcileBlocklistInBackground()
  },
})

function onBtPortDice() {
  form.value.listenPort = randomBtPort()
}

function onDhtPortDice() {
  form.value.dhtListenPort = randomDhtPort()
}

function syncUpnpInBackground(f: typeof form.value) {
  const config = preferenceStore.config
  void invoke('start_upnp_mapping', {
    btPort: Number(f.listenPort),
    btExternalPort: Number(f.btExternalPort) || 0,
    dhtPort: Number(f.dhtListenPort),
    ed2kPort: Number(config.ed2kListenPort) > 0 ? Number(config.ed2kListenPort) : null,
    ed2kUdpPort: Number(config.ed2kUdpListenPort) > 0 ? Number(config.ed2kUdpListenPort) : null,
  }).catch((error) => {
    logger.warn('BT.upnp', getErrorMessage(error))
    message.warning(t('preferences.upnp-mapping-failed'))
  })
}

function reconcileBlocklistInBackground() {
  void invoke<BtPeerBlocklistStatus>('reconcile_bt_peer_blocklist')
    .then((status) => {
      blocklistStatus.value = status
    })
    .catch((error) => {
      logger.warn('BT.blocklistReconcile', getErrorMessage(error))
      message.warning(t('preferences.bt-peer-blocklist-update-failed-keeping-current'))
    })
}

const mergedTrackerCount = computed(
  () =>
    form.value.btTracker
      .split(/\r?\n/)
      .map((tracker) => tracker.trim())
      .filter(Boolean).length,
)

async function loadBlocklistStatus() {
  try {
    blocklistStatus.value = await invoke<BtPeerBlocklistStatus>('get_bt_peer_blocklist_status')
  } catch (e) {
    logger.debug('BT.blocklistStatus', e)
  }
}

async function handleSyncBlocklist() {
  syncingBlocklist.value = true
  try {
    blocklistStatus.value = await invoke<BtPeerBlocklistStatus>('sync_bt_peer_blocklist')
    message.success(t('preferences.bt-peer-blocklist-update-succeed'))
  } catch (e) {
    logger.warn('BT.blocklistSync', getErrorMessage(e))
    message.error(t('preferences.bt-peer-blocklist-update-failed-keeping-current'))
  } finally {
    syncingBlocklist.value = false
  }
}

// ── Tracker sync ────────────────────────────────────────────────────
async function handleSyncTracker() {
  if (form.value.trackerSource.length === 0) {
    message.warning(t('preferences.bt-tracker-select-source'))
    return
  }
  syncingTracker.value = true
  try {
    const [result] = await Promise.all([
      preferenceStore.fetchBtTracker(form.value.trackerSource),
      new Promise((r) => setTimeout(r, SYNC_MIN_DURATION)),
    ])
    const text = convertTrackerDataToLine(result.data)
    if (result.failures.length === 0 && text) {
      await applySyncedTrackers(text, result.data)
      message.success(t('preferences.bt-tracker-sync-succeed'))
    } else if (result.data.length > 0 && text) {
      await applySyncedTrackers(text, result.data)
      showSyncFailureDialog(result.failures, result.data.length, form.value.trackerSource.length)
    } else {
      showSyncFailureDialog(result.failures, 0, form.value.trackerSource.length)
    }
  } catch (e) {
    logger.debug('BT.syncTracker', e)
    message.error(t('preferences.bt-tracker-sync-failed'))
  } finally {
    syncingTracker.value = false
  }
}

async function applySyncedTrackers(text: string, data: string[]) {
  const now = Date.now()
  const comma = convertTrackerDataToComma(data)
  const reduced = reduceTrackerString(comma)
  form.value.btTracker = text
  form.value.lastSyncTrackerTime = now
  await preferenceStore.updateAndSave({ btTracker: comma, lastSyncTrackerTime: now })
  patchSnapshot({ btTracker: text, lastSyncTrackerTime: now } as Partial<typeof form.value>)
  await invoke('save_system_config', { config: { 'bt-tracker': reduced } })
  if (isEngineReady()) {
    await changeGlobalOption({ 'bt-tracker': reduced } as Partial<typeof preferenceStore.config>)
  }
}

function showSyncFailureDialog(
  failures: Array<{ url: string; reason: string }>,
  successCount: number,
  totalCount: number,
) {
  const isPartial = successCount > 0
  const dialogType = isPartial ? 'warning' : 'error'
  const title = isPartial ? t('preferences.bt-tracker-sync-partial-title') : t('preferences.bt-tracker-sync-failed')
  dialog[dialogType]({
    title,
    content: () =>
      h('div', { class: 'tracker-sync-failures' }, [
        isPartial
          ? h(
              'p',
              { class: 'tracker-sync-failures__summary' },
              `${successCount}/${totalCount} ${t('preferences.bt-tracker-sync-sources-ok')}`,
            )
          : null,
        h('p', { class: 'tracker-sync-failures__heading' }, t('preferences.bt-tracker-sync-failed-sources')),
        ...failures.map((f) =>
          h('div', { class: 'tracker-sync-failure' }, [
            h('div', { class: 'tracker-sync-failure__url' }, f.url),
            h('div', { class: 'tracker-sync-failure__reason' }, f.reason),
          ]),
        ),
      ]),
    positiveText: 'OK',
  })
}

function onAddCustomTracker() {
  const url = customTrackerInput.value.trim()
  if (!url) return
  if (!isValidTrackerSourceUrl(url)) {
    message.warning(t('preferences.bt-tracker-source-invalid-url'))
    return
  }
  if (!form.value.customTrackerUrls.includes(url)) {
    form.value.customTrackerUrls = [...form.value.customTrackerUrls, url]
  }
  if (!form.value.trackerSource.includes(url)) {
    form.value.trackerSource = [...form.value.trackerSource, url]
  }
  customTrackerInput.value = ''
}

const { restartEngine } = useEngineRestart()
function handleManualRestart() {
  const port = (preferenceStore.config.rpcListenPort as number) || ENGINE_RPC_PORT
  const secret = (preferenceStore.config.rpcSecret as string) || ''
  const d = dialog.info({
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
  void loadBlocklistStatus()
})
</script>

<template>
  <div class="preference-form-wrapper">
    <div class="preference-form-scroll">
      <NForm label-placement="left" label-align="left" label-width="260px" size="small" class="form-preference">
        <!-- BT Settings -->
        <NDivider title-placement="left">{{ t('preferences.bt-settings') }}</NDivider>

        <NFormItem :label="t('preferences.bt-auto-download-content')">
          <NSwitch v-model:value="form.btAutoDownloadContent" />
        </NFormItem>
        <NFormItem :label="t('preferences.bt-force-encryption')">
          <NSwitch v-model:value="form.btForceEncryption" />
        </NFormItem>
        <NFormItem :label="t('preferences.bt-max-peers')">
          <NInputNumber v-model:value="form.btMaxPeers" :min="0" :max="ENGINE_MAX_BT_MAX_PEERS" class="pref-number" />
        </NFormItem>

        <NDivider title-placement="left">{{ t('preferences.bt-connection-section') }}</NDivider>
        <NFormItem :label="t('preferences.bt-port')">
          <NInputGroup>
            <NInputNumber v-model:value="form.listenPort" :min="1024" :max="65535" class="pref-port" />
            <NButton secondary class="pref-action-button pref-action-button--compact" @click="onBtPortDice">
              <template #icon>
                <NIcon><DiceOutline /></NIcon>
              </template>
              {{ t('preferences.random-port') }}
            </NButton>
          </NInputGroup>
        </NFormItem>
        <NFormItem>
          <template #label>
            <PreferenceHintLabel
              :label="t('preferences.bt-external-ip')"
              :hint="t('preferences.bt-external-ip-hint')"
            />
          </template>
          <NInput
            v-model:value="form.btExternalIp"
            :placeholder="t('preferences.bt-external-ip-placeholder')"
            clearable
            class="pref-control-auto"
          />
        </NFormItem>
        <NFormItem>
          <template #label>
            <PreferenceHintLabel
              :label="t('preferences.bt-external-port')"
              :hint="t('preferences.bt-external-port-hint')"
            />
          </template>
          <NInputNumber v-model:value="form.btExternalPort" :min="0" :max="65535" class="pref-port" />
        </NFormItem>

        <NDivider title-placement="left">{{ t('preferences.bt-discovery-section') }}</NDivider>
        <NFormItem :label="t('preferences.bt-peer-exchange')">
          <NSwitch v-model:value="form.btPeerExchangeEnabled" />
        </NFormItem>
        <NFormItem :label="t('preferences.bt-local-peer-discovery')">
          <NSwitch v-model:value="form.btLocalPeerDiscoveryEnabled" />
        </NFormItem>
        <NFormItem :label="t('preferences.bt-dht-network')">
          <PreferenceCheckboxGrid v-model:value="selectedDhtNetworks" :options="dhtNetworkOptions" />
        </NFormItem>
        <NFormItem :label="t('preferences.dht-port')">
          <NInputGroup>
            <NInputNumber v-model:value="form.dhtListenPort" :min="1024" :max="65535" class="pref-port" />
            <NButton secondary class="pref-action-button pref-action-button--compact" @click="onDhtPortDice">
              <template #icon>
                <NIcon><DiceOutline /></NIcon>
              </template>
              {{ t('preferences.random-port') }}
            </NButton>
          </NInputGroup>
        </NFormItem>

        <NDivider title-placement="left">{{ t('preferences.p2p-sharing-section') }}</NDivider>
        <NFormItem>
          <template #label>
            <PreferenceHintLabel
              :label="t('preferences.sharing-mode')"
              :hint="t('preferences.sharing-mode-scope-hint')"
            />
          </template>
          <NRadioGroup v-model:value="form.sharingMode" size="small">
            <NRadioButton value="stop-by-condition">
              {{ t('preferences.sharing-mode-stop-by-condition') }}
            </NRadioButton>
            <NRadioButton value="manual-stop">{{ t('preferences.sharing-mode-manual-stop') }}</NRadioButton>
          </NRadioGroup>
        </NFormItem>
        <NCollapseTransition :show="form.sharingMode === 'stop-by-condition'" class="collapse-indent">
          <NFormItem :label="t('preferences.share-ratio')">
            <NInputNumber v-model:value="form.shareRatio" :min="1" :max="100" :step="0.1" class="pref-number" />
          </NFormItem>
          <NFormItem :label="t('preferences.share-time') + ' (' + t('preferences.share-time-unit') + ')'">
            <NInputNumber v-model:value="form.shareTime" :min="60" :max="525600" class="pref-number" />
          </NFormItem>
        </NCollapseTransition>
        <NCollapseTransition :show="form.sharingMode === 'manual-stop'" class="collapse-indent">
          <NFormItem>
            <template #label>
              <PreferenceHintLabel
                :label="t('preferences.sharing-mode-manual-stop')"
                :hint="t('preferences.sharing-mode-manual-stop-tips')"
              />
            </template>
          </NFormItem>
        </NCollapseTransition>

        <NDivider title-placement="left">{{ t('preferences.bt-peer-blocklist') }}</NDivider>
        <NFormItem :label="t('preferences.bt-peer-blocklist-enable')">
          <NSwitch v-model:value="form.btPeerBlocklistEnabled" />
        </NFormItem>
        <div class="blocklist-collapse" :class="{ 'blocklist-collapse--open': form.btPeerBlocklistEnabled }">
          <div class="blocklist-collapse__inner">
            <NFormItem :label="t('preferences.bt-peer-blocklist-url')">
              <NInput
                v-model:value="form.btPeerBlocklistUrl"
                :placeholder="t('preferences.bt-peer-blocklist-url-placeholder')"
                clearable
              />
            </NFormItem>
            <NFormItem label=" ">
              <div class="pref-action-stack">
                <NButton
                  class="pref-action-button bt-blocklist-update-button"
                  :loading="syncingBlocklist"
                  :disabled="isDirty"
                  type="primary"
                  secondary
                  @click="handleSyncBlocklist"
                >
                  <template #icon>
                    <NIcon><SyncOutline /></NIcon>
                  </template>
                  {{ t('preferences.bt-peer-blocklist-update') }}
                </NButton>
                <NText depth="3" class="pref-inline-row__meta">{{ blocklistStatusText }}</NText>
              </div>
            </NFormItem>
            <NFormItem :label="t('preferences.auto-sync')">
              <NSwitch v-model:value="form.btPeerBlocklistAutoSync" />
            </NFormItem>
            <div
              class="blocklist-frequency-collapse"
              :class="{ 'blocklist-frequency-collapse--open': form.btPeerBlocklistAutoSync }"
            >
              <div class="blocklist-frequency-collapse__inner">
                <NFormItem :label="t('preferences.sync-frequency')">
                  <NSelect
                    v-model:value="form.btPeerBlocklistSyncIntervalHours"
                    :options="syncIntervalOptions"
                    class="pref-control-auto"
                  />
                </NFormItem>
              </div>
            </div>
            <NFormItem :show-label="false">
              <button
                class="info-link"
                type="button"
                @click="openTrackerSource('https://github.com/PBH-BTN/BTN-Collected-Rules')"
              >
                PBH-BTN/BTN-Collected-Rules ↗
              </button>
            </NFormItem>
          </div>
        </div>

        <!-- Tracker Management -->
        <NDivider title-placement="left">{{ t('preferences.bt-tracker') }}</NDivider>
        <NFormItem :label="t('preferences.bt-tracker-source-preset')">
          <NCheckboxGroup v-model:value="presetSources" class="tracker-source-group">
            <div class="tracker-source-list">
              <NCheckbox
                v-for="source in TRACKER_SOURCE_OPTIONS"
                :key="source.value"
                :value="source.value"
                class="tracker-source-option"
              >
                <span class="tracker-source-option__content">
                  <span class="tracker-source-option__owner">{{ source.owner }}</span>
                  <span class="tracker-source-option__repository">{{ source.repository }}</span>
                </span>
              </NCheckbox>
            </div>
          </NCheckboxGroup>
        </NFormItem>
        <NFormItem :label="t('preferences.bt-tracker-source-custom')">
          <NInputGroup>
            <NInput
              v-model:value="customTrackerInput"
              :placeholder="t('preferences.bt-tracker-source-custom-placeholder')"
              clearable
              class="pref-control-full"
              @keydown.enter="onAddCustomTracker"
            />
            <NButton size="small" class="pref-input-group-action" @click="onAddCustomTracker">
              <template #icon>
                <NIcon><AddCircleOutline /></NIcon>
              </template>
            </NButton>
          </NInputGroup>
        </NFormItem>
        <NFormItem label=" ">
          <NSelect
            v-model:value="customSources"
            :options="customSelectOptions"
            :render-option="renderCustomOption"
            multiple
            clearable
            :placeholder="customPlaceholder"
            max-tag-count="responsive"
          />
        </NFormItem>
        <NFormItem label=" ">
          <div class="pref-action-stack">
            <NButton
              class="pref-action-button bt-tracker-sync-button"
              :loading="syncingTracker"
              type="primary"
              secondary
              @click="handleSyncTracker"
            >
              <template #icon>
                <NIcon><SyncOutline /></NIcon>
              </template>
              {{ t('preferences.bt-tracker-sync') }}
            </NButton>
            <NText depth="3" class="pref-inline-row__meta">
              {{ t('preferences.bt-tracker-count', { count: mergedTrackerCount }) }} ·
              {{ t('preferences.last-sync-time') }}
              {{ form.lastSyncTrackerTime ? new Date(form.lastSyncTrackerTime as number).toLocaleString() : '—' }}
            </NText>
          </div>
        </NFormItem>
        <NFormItem :label="t('preferences.bt-tracker-content')">
          <NInput
            v-model:value="form.btTracker"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 8 }"
            :placeholder="t('preferences.bt-tracker-input-tips')"
          />
        </NFormItem>
        <NFormItem :label="t('preferences.auto-sync')">
          <NSwitch v-model:value="form.btTrackerAutoSync" />
        </NFormItem>
        <NFormItem v-if="form.btTrackerAutoSync" :label="t('preferences.sync-frequency')">
          <NSelect
            v-model:value="form.btTrackerSyncIntervalHours"
            :options="syncIntervalOptions"
            class="pref-control-auto"
          />
        </NFormItem>
      </NForm>
    </div>
    <PreferenceActionBar :is-dirty="isDirty" @save="handleSave" @discard="handleReset" @restart="handleManualRestart" />
  </div>
</template>

<style scoped>
.bt-tracker-sync-button {
  min-width: 100px;
}
:global(.custom-tracker-option) {
  position: relative;
  display: flex;
  align-items: center;
  padding-right: 32px;
}
:global(.custom-tracker-option__content) {
  flex: 1;
  min-width: 0;
}
:global(.custom-tracker-option__delete) {
  position: absolute;
  right: 8px;
  display: flex;
  align-items: center;
  color: var(--m3-error);
  cursor: pointer;
}
:global(.tracker-sync-failures) {
  max-height: 300px;
  overflow-y: auto;
}
:global(.tracker-sync-failures__summary) {
  margin: 0 0 8px;
  color: var(--m3-on-surface-variant);
}
:global(.tracker-sync-failures__heading) {
  margin: 0 0 8px;
  font-weight: 500;
}
:global(.tracker-sync-failure) {
  margin: 6px 0;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--m3-error-container);
  color: var(--m3-on-error-container);
}
:global(.tracker-sync-failure__url) {
  font-size: 12px;
  font-weight: 500;
  word-break: break-all;
}
:global(.tracker-sync-failure__reason) {
  margin-top: 2px;
  font-size: 11px;
}
.tracker-source-group {
  width: 100%;
}
.tracker-source-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
  max-width: 520px;
}
.tracker-source-option {
  min-width: 0;
  padding: 9px 12px;
  border: 1px solid var(--m3-outline-variant);
  border-radius: 9px;
  background: color-mix(in srgb, var(--m3-surface-container-low) 72%, transparent);
  transition:
    border-color 180ms ease,
    background-color 180ms ease;
}
.tracker-source-option:hover {
  border-color: color-mix(in srgb, var(--m3-primary) 42%, var(--m3-outline-variant));
  background: var(--m3-surface-container-low);
}
.tracker-source-option.n-checkbox--checked {
  border-color: color-mix(in srgb, var(--m3-primary) 58%, var(--m3-outline-variant));
  background: color-mix(in srgb, var(--m3-primary) 7%, var(--m3-surface-container-low));
}
.tracker-source-option:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--m3-primary) 68%, transparent);
  outline-offset: 2px;
}
.tracker-source-option :deep(.n-checkbox__label) {
  min-width: 0;
  flex: 1;
}
.tracker-source-option__content {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.tracker-source-option__owner,
.tracker-source-option__repository {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tracker-source-option__owner {
  color: var(--m3-on-surface);
  font-size: 13px;
  font-weight: 600;
}
.tracker-source-option__repository {
  color: var(--m3-on-surface-variant);
  font-size: 12px;
}
.bt-blocklist-update-button {
  min-width: 100px;
}
.blocklist-collapse,
.blocklist-frequency-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.35s cubic-bezier(0.2, 0, 0, 1);
}
.blocklist-collapse--open,
.blocklist-frequency-collapse--open {
  grid-template-rows: 1fr;
}
.blocklist-collapse__inner,
.blocklist-frequency-collapse__inner {
  overflow: hidden;
}

.info-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--m3-primary);
  cursor: pointer;
  text-decoration: none;
  font-size: 12px;
}
.info-link:hover {
  text-decoration: underline;
}
@media (max-width: 720px) {
  .tracker-source-list {
    grid-template-columns: 1fr;
  }
}
</style>
