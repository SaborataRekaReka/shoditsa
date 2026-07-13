const YANDEX_OAUTH_HOST_BY_COUNTRY = {
  AZ: 'oauth.yandex.az',
  BY: 'oauth.yandex.by',
  IL: 'oauth.yandex.co.il',
  KG: 'oauth.yandex.kg',
  KZ: 'oauth.yandex.kz',
  MD: 'oauth.yandex.md',
  RU: 'oauth.yandex.ru',
  TJ: 'oauth.yandex.tj',
  TM: 'oauth.yandex.tm',
  TR: 'oauth.yandex.com.tr',
  UZ: 'oauth.yandex.uz',
} as const

type YandexOAuthCountry = keyof typeof YANDEX_OAUTH_HOST_BY_COUNTRY

const YANDEX_OAUTH_HOSTS = new Set([
  'oauth.yandex.com',
  ...Object.values(YANDEX_OAUTH_HOST_BY_COUNTRY),
])

const COUNTRY_BY_TIMEZONE: Record<string, YandexOAuthCountry> = {
  'Asia/Almaty': 'KZ',
  'Asia/Aqtau': 'KZ',
  'Asia/Aqtobe': 'KZ',
  'Asia/Atyrau': 'KZ',
  'Asia/Oral': 'KZ',
  'Asia/Qostanay': 'KZ',
  'Asia/Qyzylorda': 'KZ',
  'Europe/Minsk': 'BY',
  'Europe/Istanbul': 'TR',
  'Asia/Tashkent': 'UZ',
  'Asia/Samarkand': 'UZ',
  'Asia/Baku': 'AZ',
  'Asia/Bishkek': 'KG',
  'Europe/Chisinau': 'MD',
  'Asia/Dushanbe': 'TJ',
  'Asia/Ashgabat': 'TM',
  'Asia/Jerusalem': 'IL',
  'Asia/Tel_Aviv': 'IL',
}

const COUNTRY_BY_LANGUAGE: Record<string, YandexOAuthCountry> = {
  az: 'AZ',
  be: 'BY',
  he: 'IL',
  kk: 'KZ',
  ky: 'KG',
  ro: 'MD',
  tg: 'TJ',
  tk: 'TM',
  tr: 'TR',
  uz: 'UZ',
}

const RUSSIAN_TIMEZONES = new Set([
  'Europe/Kaliningrad',
  'Europe/Kirov',
  'Europe/Moscow',
  'Europe/Samara',
  'Europe/Saratov',
  'Europe/Ulyanovsk',
  'Europe/Volgograd',
  'Europe/Astrakhan',
  'Asia/Yekaterinburg',
  'Asia/Omsk',
  'Asia/Novosibirsk',
  'Asia/Barnaul',
  'Asia/Tomsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Chita',
  'Asia/Yakutsk',
  'Asia/Khandyga',
  'Asia/Vladivostok',
  'Asia/Ust-Nera',
  'Asia/Magadan',
  'Asia/Sakhalin',
  'Asia/Srednekolymsk',
  'Asia/Kamchatka',
  'Asia/Anadyr',
])

export type YandexOAuthRegionContext = {
  languages?: readonly string[]
  timeZone?: string
}

const browserRegionContext = (): YandexOAuthRegionContext => ({
  languages: typeof navigator === 'undefined' ? [] : navigator.languages,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
})

export const detectYandexOAuthCountry = (context: YandexOAuthRegionContext = browserRegionContext()): YandexOAuthCountry | null => {
  const timeZone = context.timeZone?.trim()
  if (timeZone && COUNTRY_BY_TIMEZONE[timeZone]) return COUNTRY_BY_TIMEZONE[timeZone]
  if (timeZone && RUSSIAN_TIMEZONES.has(timeZone)) return 'RU'

  const languages = context.languages ?? []
  for (const language of languages) {
    try {
      const locale = new Intl.Locale(language)
      const region = locale.region?.toUpperCase()
      if (region && region in YANDEX_OAUTH_HOST_BY_COUNTRY) return region as YandexOAuthCountry
    } catch {
      // Ignore malformed browser locale values and continue to the next hint.
    }
  }

  for (const language of languages) {
    const languageCode = language.toLowerCase().split(/[-_]/, 1)[0]
    if (languageCode && COUNTRY_BY_LANGUAGE[languageCode]) return COUNTRY_BY_LANGUAGE[languageCode]
    if (languageCode === 'ru') return 'RU'
  }
  return null
}

export const localizeYandexOAuthUrl = (rawUrl: string, context?: YandexOAuthRegionContext) => {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' || !YANDEX_OAUTH_HOSTS.has(url.hostname)) {
    throw new Error('Yandex OAuth returned an untrusted authorization URL.')
  }
  const country = detectYandexOAuthCountry(context)
  url.hostname = country ? YANDEX_OAUTH_HOST_BY_COUNTRY[country] : 'oauth.yandex.com'
  return url.toString()
}
