export const appLocales = ['nl', 'en', 'cs', 'pl', 'el', 'tr'] as const
export type AppLocale = typeof appLocales[number]

export const localeLabels: Record<AppLocale, string> = {
  nl: 'Nederlands',
  en: 'English',
  cs: 'Čeština',
  pl: 'Polski',
  el: 'Ελληνικά',
  tr: 'Türkçe',
}

export const localeFlags: Record<AppLocale, string> = {
  nl: '🇳🇱',
  en: '🇬🇧',
  cs: '🇨🇿',
  pl: '🇵🇱',
  el: '🇬🇷',
  tr: '🇹🇷',
}

export function isAppLocale(value: string): value is AppLocale {
  return appLocales.some((locale) => locale === value)
}

export function getIntlLocale(locale: AppLocale) {
  return { nl: 'nl-NL', en: 'en-GB', cs: 'cs-CZ', pl: 'pl-PL', el: 'el-GR', tr: 'tr-TR' }[locale]
}
