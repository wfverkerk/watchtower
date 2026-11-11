import { isAppLocale, type AppLocale } from '../i18n/types'

export const userProfileStorageKey = 'watchtower-user-profile-v1'

export type UserProfile = {
  name: string
  description: string
  locale: AppLocale
}

type StringStorage = Pick<Storage, 'getItem' | 'setItem'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseUserProfile(value: unknown): UserProfile {
  if (!isRecord(value)
    || typeof value.name !== 'string'
    || !value.name.trim()
    || (value.description !== undefined && typeof value.description !== 'string')
    || (typeof value.description === 'string' && value.description.length > 120)
    || typeof value.locale !== 'string'
    || !isAppLocale(value.locale)) {
    throw new Error('Saved user profile has an invalid format.')
  }
  return {
    name: value.name.trim(),
    description: typeof value.description === 'string' ? value.description.trim() : '',
    locale: value.locale,
  }
}

export function loadUserProfile(storage: StringStorage = window.localStorage): UserProfile | null {
  const saved = storage.getItem(userProfileStorageKey)
  return saved === null ? null : parseUserProfile(JSON.parse(saved) as unknown)
}

export function saveUserProfile(profile: UserProfile, storage: StringStorage = window.localStorage) {
  storage.setItem(userProfileStorageKey, JSON.stringify(parseUserProfile(profile)))
}
