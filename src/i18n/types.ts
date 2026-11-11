export const appLocales = ['nl', 'en', 'cs'] as const
export type AppLocale = typeof appLocales[number]

export const localeLabels: Record<AppLocale, string> = {
  nl: 'Nederlands',
  en: 'English',
  cs: 'Čeština',
}

export const localeFlags: Record<AppLocale, string> = {
  nl: '🇳🇱',
  en: '🇬🇧',
  cs: '🇨🇿',
}

export function isAppLocale(value: string): value is AppLocale {
  return appLocales.some((locale) => locale === value)
}

export function getIntlLocale(locale: AppLocale) {
  return { nl: 'nl-NL', en: 'en-GB', cs: 'cs-CZ' }[locale]
}
