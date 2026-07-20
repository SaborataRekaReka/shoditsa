export const LEGAL_DOCUMENT_SLUGS = [
  'terms',
  'tariffs',
  'privacy',
  'personal-data-consent',
  'refunds',
  'contacts',
] as const

export type LegalDocumentSlug = (typeof LEGAL_DOCUMENT_SLUGS)[number]

export const isLegalDocumentSlug = (value: string): value is LegalDocumentSlug =>
  LEGAL_DOCUMENT_SLUGS.includes(value as LegalDocumentSlug)

export const LEGAL_DOCUMENT_LINKS: Array<{ slug: LegalDocumentSlug; label: string }> = [
  { slug: 'terms', label: 'Соглашение и оферта' },
  { slug: 'tariffs', label: 'Тарифы' },
  { slug: 'privacy', label: 'Конфиденциальность' },
  { slug: 'personal-data-consent', label: 'Согласие на обработку данных' },
  { slug: 'refunds', label: 'Оплата и возвраты' },
  { slug: 'contacts', label: 'Контакты и реквизиты' },
]

export const legalHref = (slug: LegalDocumentSlug) => `/legal/${slug}`

