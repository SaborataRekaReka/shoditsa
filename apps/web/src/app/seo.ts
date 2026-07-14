type SeoRoute = {
  title: string
  description: string
  canonicalPath: string
  robots: string
  indexable: boolean
}

const DEFAULT_SITE_URL = 'https://shoditsa.ru'
const DEFAULT_IMAGE_PATH = '/images/hero.webp'
const DEFAULT_TITLE = 'Сходится! — ежедневные игры'
const DEFAULT_DESCRIPTION = 'Сходится! — платформа ежедневных игр, где ответ находят по признакам.'

const SEO_BY_PATH: Record<'home' | 'login' | 'register' | 'admin' | 'unknown', SeoRoute> = {
  home: {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    canonicalPath: '/',
    robots: 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1',
    indexable: true,
  },
  login: {
    title: 'Вход — Сходится!',
    description: 'Войдите в Сходится!, чтобы сохранить прогресс, открыть профиль и продолжить ежедневные игры.',
    canonicalPath: '/login',
    robots: 'noindex,follow',
    indexable: false,
  },
  register: {
    title: 'Регистрация — Сходится!',
    description: 'Создайте аккаунт в Сходится!, чтобы синхронизировать прогресс и получать больше игровых возможностей.',
    canonicalPath: '/register',
    robots: 'noindex,follow',
    indexable: false,
  },
  admin: {
    title: 'Админ-панель — Сходится!',
    description: 'Служебная административная панель Сходится!.',
    canonicalPath: '/admin',
    robots: 'noindex,nofollow,noarchive',
    indexable: false,
  },
  unknown: {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    canonicalPath: '/',
    robots: 'noindex,follow',
    indexable: false,
  },
}

const normalizeSiteUrl = (value: string | undefined) => {
  const fallback = DEFAULT_SITE_URL
  const raw = String(value ?? '').trim()
  if (!raw) return fallback
  try {
    const parsed = new URL(raw)
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '') || fallback
  } catch {
    return fallback
  }
}

const normalizePathname = (pathname: string) => {
  if (!pathname) return '/'
  const normalized = pathname.replace(/\/+$/, '')
  return normalized || '/'
}

const routeKeyFromPath = (pathname: string): keyof typeof SEO_BY_PATH => {
  if (pathname === '/') return 'home'
  if (pathname === '/login') return 'login'
  if (pathname === '/register') return 'register'
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin'
  return 'unknown'
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

export const applyRuntimeSeo = () => {
  if (typeof window === 'undefined') return

  const siteUrl = normalizeSiteUrl(import.meta.env.VITE_SITE_URL)
  const normalizedPath = normalizePathname(window.location.pathname)
  const routeKey = routeKeyFromPath(normalizedPath)
  const routeSeo = SEO_BY_PATH[routeKey]
  const canonicalUrl = new URL(routeSeo.canonicalPath, `${siteUrl}/`).toString()
  const imageUrl = new URL(DEFAULT_IMAGE_PATH, `${siteUrl}/`).toString()

  document.title = routeSeo.title

  ensureMetaByName('description').setAttribute('content', routeSeo.description)
  ensureMetaByName('robots').setAttribute('content', routeSeo.robots)

  ensureMetaByProperty('og:locale').setAttribute('content', 'ru_RU')
  ensureMetaByProperty('og:type').setAttribute('content', 'website')
  ensureMetaByProperty('og:site_name').setAttribute('content', 'Сходится!')
  ensureMetaByProperty('og:title').setAttribute('content', routeSeo.title)
  ensureMetaByProperty('og:description').setAttribute('content', routeSeo.description)
  ensureMetaByProperty('og:url').setAttribute('content', canonicalUrl)
  ensureMetaByProperty('og:image').setAttribute('content', imageUrl)

  ensureMetaByName('twitter:card').setAttribute('content', 'summary_large_image')
  ensureMetaByName('twitter:title').setAttribute('content', routeSeo.title)
  ensureMetaByName('twitter:description').setAttribute('content', routeSeo.description)
  ensureMetaByName('twitter:image').setAttribute('content', imageUrl)

  ensureCanonicalLink().setAttribute('href', canonicalUrl)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': routeSeo.indexable ? 'WebSite' : 'WebPage',
    name: 'Сходится!',
    url: canonicalUrl,
    inLanguage: 'ru-RU',
    description: routeSeo.description,
  }
  ensureJsonLdScript().textContent = JSON.stringify(jsonLd)
}