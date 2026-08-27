/** @fileoverview vue-i18n instance with lazily loaded locale messages.
 *
 * Only en-US (the fallback) ships in the main bundle. The active locale is
 * dynamically imported once during bootstrap — a locale change requires an
 * app restart (enforced by the General preference page), so no runtime
 * switching path is needed beyond loadLocale().
 */
import { createI18n } from 'vue-i18n'
import { setI18nLocale } from '@shared/utils/i18n'
// @ts-expect-error JS locale module without type declarations
import enUS from '@shared/locales/en-US/index.js'

type LocaleMessages = Record<string, Record<string, string>>

const localeLoaders = import.meta.glob('@shared/locales/*/index.js') as Record<
  string,
  () => Promise<{ default: LocaleMessages }>
>

/** Every locale the app ships translations for — derived from the locale
 * directories on disk, so adding a locale needs no code change. */
export const SUPPORTED_LOCALES: string[] = Object.keys(localeLoaders)
  .map((path) => path.match(/locales\/([^/]+)\/index\.js$/)?.[1])
  .filter((locale): locale is string => !!locale)

const messages: Record<string, LocaleMessages> = { 'en-US': enUS as LocaleMessages }

export const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  fallbackLocale: 'en-US',
  messages,
})

/**
 * Dynamically loads a locale's messages into the i18n instance.
 * No-op for en-US and already-loaded locales. Unknown locales resolve
 * without loading (the fallback covers rendering).
 */
export async function loadLocale(locale: string): Promise<void> {
  if (i18n.global.availableLocales.includes(locale)) return
  const loader = Object.entries(localeLoaders).find(([path]) => path.endsWith(`/locales/${locale}/index.js`))?.[1]
  if (!loader) return
  const messages = (await loader()).default
  i18n.global.setLocaleMessage(locale, messages)
}

export function useLocale() {
  async function setLocale(locale: string) {
    await loadLocale(locale)
    setI18nLocale(i18n, locale)
  }

  return { i18n, setLocale }
}
