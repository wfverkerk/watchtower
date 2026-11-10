import { ref } from 'vue'
import { messages } from './messages'
import { isAppLocale, type AppLocale } from './types'

export const localeStorageKey = 'watchtower-locale-v1'

function getInitialLocale(): AppLocale {
  if (typeof window === 'undefined') return 'nl'

  try {
    const savedLocale = window.localStorage.getItem(localeStorageKey)
    if (savedLocale && isAppLocale(savedLocale)) return savedLocale
  } catch {
    return 'nl'
  }

  return 'nl'
}

const currentLocale = ref<AppLocale>(getInitialLocale())

function translate(key: string, params: Record<string, string | number> = {}) {
  let message: unknown = messages[currentLocale.value]
  for (const part of key.split('.')) {
    if (typeof message !== 'object' || message === null || !(part in message)) {
      message = undefined
      break
    }
    message = (message as Record<string, unknown>)[part]
  }

  const resolvedMessage = typeof message === 'string' ? message : key
  if (typeof message !== 'string') {
    console.error(`Missing translation: ${currentLocale.value}.${key}`)
  }

  return resolvedMessage.replace(/\{(\w+)\}/g, (placeholder: string, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder,
  )
}

export function useLocale() {
  function displayTeamName(team: { id: string; name: string }) {
    const defaultNames = team.id === 'home'
      ? ['Thuis', 'Home', 'Domácí']
      : team.id === 'away'
        ? ['Uit', 'Away', 'Hosté']
        : []
    if (defaultNames.includes(team.name)) return translate(team.id === 'home' ? 'app.home' : 'app.away')
    return team.name
  }

  function displayPlayerName(name: string) {
    const defaultPlayer = /^(?:Speler|Player|Hráč) (\d+)$/.exec(name)
    return defaultPlayer ? translate('app.defaultPlayer', { number: defaultPlayer[1] }) : name
  }

  return { locale: currentLocale, t: translate, displayTeamName, displayPlayerName }
}

export function saveLocale(locale: AppLocale) {
  window.localStorage.setItem(localeStorageKey, locale)
}

export { appLocales, getIntlLocale, isAppLocale, localeLabels, type AppLocale } from './types'
