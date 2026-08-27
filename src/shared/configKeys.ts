/** @fileoverview Config key lists shared across the preference system.
 *
 * Engine-facing key lists (which aria2 options exist, which cannot be
 * hot-reloaded) live in `aria2Options.json` — the single source of truth
 * consumed by both this frontend and the Rust backend.
 */
import aria2Options from '@shared/aria2Options.json'

/** Every aria2 engine option the app may pass on the CLI or via RPC. */
export const engineOptionKeys: readonly string[] = aria2Options.engineOptions

/** Options aria2 rejects via `changeGlobalOption` (bound at process start). */
export const nonHotReloadableKeys: readonly string[] = aria2Options.nonHotReloadable

/**
 * Changed form keys (kebab-case) that require an engine restart to take
 * effect. Drives the "restart now?" dialog on preference save.
 */
export const needRestartKeys = [
  'bt-dht-ipv-4-enabled',
  'bt-dht-ipv-6-enabled',
  'bt-enable-lpd',
  'bt-force-encryption',
  'bt-local-peer-discovery-enabled',
  'bt-max-peers',
  'bt-peer-exchange-enabled',
  'bt-require-crypto',
  'dht-listen-port',
  'aria2-log-level',
  'ed2k-listen-port',
  'ed2k-server',
  'ed2k-udp-listen-port',
  'ed2k-upload-slots',
  'enable-dht',
  'enable-dht6',
  'enable-peer-exchange',
  'rpc-listen-port',
  'allow-remote-access',
  'rpc-secret',
]
