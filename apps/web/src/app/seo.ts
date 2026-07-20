import { isLegalDocumentSlug, type LegalDocumentSlug } from '../features/legal/legal'
import {
  DEFAULT_SOCIAL_IMAGE_PATH,
  GAME_SEO,
  HOME_SEO,
  INDEXABLE_ROBOTS,
  SITE_LANGUAGE,
  SITE_NAME,
  SITE_ORIGIN,
  gameSeoFromPathname,
  type SeoGameMode,
  type SeoPageContent,
} from './seo-content'

export type SeoRoute = SeoPageContent & {
  kind: 'home' | 'game' | 'utility' | 'unknown'
  mode?: SeoGameMode
  robots: string
  indexable: boolean
  imagePath: string
}

const NOINDEX_FOLLOW = 'noindex,follow,noarchive'
const NOINDEX_PRIVATE = 'noindex,nofollow,noarchive'

const LEGAL_SEO: Record<LegalDocumentSlug, { title: string; description: string }> = {
  terms: { title: 'Пользовательское соглашение и оферта — Сходится!', description: 'Условия использования сервиса, оказания и оплаты цифровых услуг «Сходится!».' },
  tariffs: { title: 'Тарифы и получение услуг — Сходится!', description: 'Актуальные тарифы клуба, спецпоказов и памятных цифровых жетонов «Сходится!».' },
  privacy: { title: 'Политика обработки персональных данных — Сходится!', description: 'Правила обработки и защиты персональных данных пользователей сервиса «Сходится!».' },
  'personal-data-consent': { title: 'Согласие на обработку персональных данных — Сходится!', description: 'Условия отдельного согласия на обработку персональных данных пользователей «Сходится!».' },
  refunds: { title: 'Оплата, получение услуг и возвраты — Сходится!', description: 'Порядок оплаты, активации цифровых услуг, отмены и возврата денежных средств.' },
  contacts: { title: 'Контакты и реквизиты — Сходится!', description: 'Контактные данные и реквизиты владельца и исполнителя сервиса «Сходится!».' },
}

const utilitySeo = (pathname: string): SeoRoute | null => {
  const legalMatch = pathname.match(/^\/legal\/([^/]+)$/)
  if (legalMatch && isLegalDocumentSlug(legalMatch[1])) {
    const document = legalMatch[1]
    const content = LEGAL_SEO[document]
    return {
      kind: 'utility', title: content.title, description: content.description, canonicalPath: pathname, heading: content.title.replace(/ — Сходится!$/, ''), lead: '', paragraphs: [], robots: INDEXABLE_ROBOTS, indexable: true, imagePath: DEFAULT_SOCIAL_IMAGE_PATH,
    }
  }
  if (pathname === '/partners' || pathname === '/create-a-game') return {
    kind: 'utility', title: 'Корпоративные игры для команд и событий — Сходится!', description: 'Создадим брендированную онлайн-игру для тимбилдинга, корпоратива, конференции или спецпроекта — под вашу аудиторию и задачу.', canonicalPath: '/partners', heading: 'Игры «Сходится!» для бизнеса', lead: 'Частный игровой сеанс под вашу команду, бренд и событие.', paragraphs: [], robots: INDEXABLE_ROBOTS, indexable: true, imagePath: DEFAULT_SOCIAL_IMAGE_PATH,
  }
  if (pathname === '/specials') return {
    kind: 'utility', title: 'Спецпоказы — Сходится!', description: 'Тематические игровые подборки с отдельным прогрессом и бесплатными превью.', canonicalPath: '/specials', heading: 'Спецпоказы', lead: '', paragraphs: [], robots: INDEXABLE_ROBOTS, indexable: true, imagePath: DEFAULT_SOCIAL_IMAGE_PATH,
  }
  if (pathname.startsWith('/specials/')) return {
    kind: 'utility', title: 'Спецпоказ — Сходится!', description: 'Тематический игровой спецпоказ.', canonicalPath: pathname, heading: 'Спецпоказ', lead: '', paragraphs: [], robots: NOINDEX_FOLLOW, indexable: false, imagePath: DEFAULT_SOCIAL_IMAGE_PATH,
  }
  if (pathname === '/login') return {
    kind: 'utility', title: 'Вход — Сходится!', description: 'Войдите в Сходится!, чтобы сохранить прогресс и продолжить ежедневные игры.', canonicalPath: '/login', heading: 'Вход', lead: '', paragraphs: [], robots: NOINDEX_FOLLOW, indexable: false, imagePath: DEFAULT_SOCIAL_IMAGE_PATH,
  }
  if (pathname === '/register') return {
    kind: 'utility', title: 'Регистрация — Сходится!', description: 'Создайте аккаунт, чтобы синхронизировать игровой прогресс между устройствами.', canonicalPath: '/register', heading: 'Регистрация', lead: '', paragraphs: [], robots: NOINDEX_FOLLOW, indexable: false, imagePath: DEFAULT_SOCIAL_IMAGE_PATH,
  }
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return {
    kind: 'utility', title: 'Админ-панель — Сходится!', description: 'Служебная административная панель.', canonicalPath: '/admin', heading: 'Админ-панель', lead: '', paragraphs: [], robots: NOINDEX_PRIVATE, indexable: false, imagePath: DEFAULT_SOCIAL_IMAGE_PATH,
  }
  if (pathname === '/archive') return {
    kind: 'utility', title: 'Архив игр — Сходится!', description: 'Личная история ежедневных игр.', canonicalPath: '/archive', heading: 'Архив', lead: '', paragraphs: [], robots: NOINDEX_FOLLOW, indexable: false, imagePath: DEFAULT_SOCIAL_IMAGE_PATH,
  }
  if (pathname === '/profile') return {
    kind: 'utility', title: 'Игровой профиль — Сходится!', description: 'Личный прогресс, статистика и достижения.', canonicalPath: '/profile', heading: 'Профиль', lead: '', paragraphs: [], robots: NOINDEX_PRIVATE, indexable: false, imagePath: DEFAULT_SOCIAL_IMAGE_PATH,
  }
  if (pathname.startsWith('/play/') || pathname.startsWith('/sessions/') || pathname.startsWith('/review/')) return {
    kind: 'utility', title: `Игровая сессия — ${SITE_NAME}`, description: 'Текущая игровая сессия.', canonicalPath: pathname, heading: 'Игровая сессия', lead: '', paragraphs: [], robots: NOINDEX_PRIVATE, indexable: false, imagePath: DEFAULT_SOCIAL_IMAGE_PATH,
  }
  return null
}

export const normalizeSeoPathname = (pathname: string) => {
  const withLeadingSlash = `/${String(pathname || '').split(/[?#]/, 1)[0]}`.replace(/\/{2,}/g, '/')
  return withLeadingSlash.replace(/\/+$/, '') || '/'
}

export const seoRouteFromPathname = (pathname: string): SeoRoute => {
  const normalized = normalizeSeoPathname(pathname)
  if (normalized === '/') return {
    ...HOME_SEO,
    kind: 'home',
    robots: INDEXABLE_ROBOTS,
    indexable: true,
    imagePath: DEFAULT_SOCIAL_IMAGE_PATH,
  }

  const game = gameSeoFromPathname(normalized)
  if (game) return {
    ...game,
    kind: 'game',
    robots: INDEXABLE_ROBOTS,
    indexable: true,
    imagePath: DEFAULT_SOCIAL_IMAGE_PATH,
  }

  return utilitySeo(normalized) ?? {
    kind: 'unknown',
    title: `Страница не найдена — ${SITE_NAME}`,
    description: 'Запрошенная страница не найдена.',
    canonicalPath: normalized,
    heading: 'Страница не найдена',
    lead: '',
    paragraphs: [],
    robots: NOINDEX_PRIVATE,
    indexable: false,
    imagePath: DEFAULT_SOCIAL_IMAGE_PATH,
  }
}

export const normalizeSiteUrl = (value: string | undefined) => {
  const raw = String(value ?? '').trim()
  if (!raw) return SITE_ORIGIN
  try {
    const parsed = new URL(raw)
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '') || SITE_ORIGIN
  } catch {
    return SITE_ORIGIN
  }
}

export const structuredDataForSeoRoute = (route: SeoRoute, siteUrl = SITE_ORIGIN) => {
  const canonicalUrl = new URL(route.canonicalPath, `${siteUrl}/`).toString()
  const websiteId = `${siteUrl}/#website`
  const applicationId = `${siteUrl}/#application`

  if (route.kind === 'home') return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite', '@id': websiteId, url: `${siteUrl}/`, name: SITE_NAME, alternateName: 'Сходится', inLanguage: SITE_LANGUAGE, description: route.description,
      },
      {
        '@type': 'WebApplication', '@id': applicationId, name: SITE_NAME, url: `${siteUrl}/`, description: route.description, applicationCategory: 'GameApplication', operatingSystem: 'Any', browserRequirements: 'Requires JavaScript and a modern web browser', inLanguage: SITE_LANGUAGE, isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' },
        featureList: Object.values(GAME_SEO).map((game) => game.heading),
      },
    ],
  }

  if (route.kind === 'game' && route.mode) return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite', '@id': websiteId, url: `${siteUrl}/`, name: SITE_NAME, alternateName: 'Сходится', inLanguage: SITE_LANGUAGE,
      },
      {
        '@type': 'WebPage', '@id': `${canonicalUrl}#webpage`, url: canonicalUrl, name: route.title, description: route.description, inLanguage: SITE_LANGUAGE, isPartOf: { '@id': websiteId }, mainEntity: { '@id': `${canonicalUrl}#game` },
      },
      {
        '@type': 'WebApplication', '@id': `${canonicalUrl}#game`, name: route.heading, url: canonicalUrl, description: route.description, applicationCategory: 'GameApplication', operatingSystem: 'Any', browserRequirements: 'Requires JavaScript and a modern web browser', inLanguage: SITE_LANGUAGE, isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' },
      },
      {
        '@type': 'BreadcrumbList', '@id': `${canonicalUrl}#breadcrumb`, itemListElement: [
          { '@type': 'ListItem', position: 1, name: SITE_NAME, item: `${siteUrl}/` },
          { '@type': 'ListItem', position: 2, name: GAME_SEO[route.mode].shortName, item: canonicalUrl },
        ],
      },
    ],
  }

  return {
    '@context': 'https://schema.org', '@type': 'WebPage', name: route.title, url: canonicalUrl, inLanguage: SITE_LANGUAGE, description: route.description,
  }
}

const ensureMetaByName = (name: string) => {
  const selector = `meta[name="${name}"]`
  const existing = document.head.querySelector<HTMLMetaElement>(selector)
  if (existing) return existing
  const element = document.createElement('meta')
  element.setAttribute('name', name)
  document.head.appendChild(element)
  return element
}

const ensureMetaByProperty = (property: string) => {
  const selector = `meta[property="${property}"]`
  const existing = document.head.querySelector<HTMLMetaElement>(selector)
  if (existing) return existing
  const element = document.createElement('meta')
  element.setAttribute('property', property)
  document.head.appendChild(element)
  return element
}

const ensureCanonicalLink = () => {
  const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (existing) return existing
  const link = document.createElement('link')
  link.setAttribute('rel', 'canonical')
  document.head.appendChild(link)
  return link
}

const ensureJsonLdScript = () => {
  const existing = document.head.querySelector<HTMLScriptElement>('script#seo-json-ld[type="application/ld+json"]')
  if (existing) return existing
  const script = document.createElement('script')
  script.id = 'seo-json-ld'
  script.type = 'application/ld+json'
  document.head.appendChild(script)
  return script
}

export const applyRuntimeSeo = (pathname = typeof window === 'undefined' ? '/' : window.location.pathname) => {
  if (typeof window === 'undefined') return

  const siteUrl = normalizeSiteUrl(import.meta.env.VITE_SITE_URL)
  const routeSeo = seoRouteFromPathname(pathname)
  const canonicalUrl = new URL(routeSeo.canonicalPath, `${siteUrl}/`).toString()
  const imageUrl = new URL(routeSeo.imagePath, `${siteUrl}/`).toString()

  document.documentElement.lang = 'ru'
  document.title = routeSeo.title
  ensureMetaByName('description').setAttribute('content', routeSeo.description)
  ensureMetaByName('robots').setAttribute('content', routeSeo.robots)
  ensureMetaByName('application-name').setAttribute('content', SITE_NAME)

  ensureMetaByProperty('og:locale').setAttribute('content', 'ru_RU')
  ensureMetaByProperty('og:type').setAttribute('content', 'website')
  ensureMetaByProperty('og:site_name').setAttribute('content', SITE_NAME)
  ensureMetaByProperty('og:title').setAttribute('content', routeSeo.title)
  ensureMetaByProperty('og:description').setAttribute('content', routeSeo.description)
  ensureMetaByProperty('og:url').setAttribute('content', canonicalUrl)
  ensureMetaByProperty('og:image').setAttribute('content', imageUrl)
  ensureMetaByProperty('og:image:alt').setAttribute('content', `${routeSeo.heading} — ${SITE_NAME}`)

  ensureMetaByName('twitter:card').setAttribute('content', 'summary_large_image')
  ensureMetaByName('twitter:title').setAttribute('content', routeSeo.title)
  ensureMetaByName('twitter:description').setAttribute('content', routeSeo.description)
  ensureMetaByName('twitter:image').setAttribute('content', imageUrl)
  ensureMetaByName('twitter:image:alt').setAttribute('content', `${routeSeo.heading} — ${SITE_NAME}`)

  ensureCanonicalLink().setAttribute('href', canonicalUrl)
  ensureJsonLdScript().textContent = JSON.stringify(structuredDataForSeoRoute(routeSeo, siteUrl)).replace(/</g, '\\u003c')
}
