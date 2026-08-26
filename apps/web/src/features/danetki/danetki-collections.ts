import { DANETKI_CATALOG_ITEMS, type DanetkiCatalogItem } from './danetki-catalog'

export const DANETKI_COLLECTION_SLUGS = ['dlya-detey', 'slozhnye', 'legkie', 'novye'] as const

export type DanetkiCollectionSlug = typeof DANETKI_COLLECTION_SLUGS[number]

export type DanetkiCollectionDefinition = {
  slug: DanetkiCollectionSlug
  canonicalPath: `/danetki/${DanetkiCollectionSlug}`
  title: string
  description: (count: number) => string
  heading: string
  eyebrow: string
  lead: string
  countLabel: string
  factLabel: string
  factValue: string
  sectionHeading: string
  sectionLead: (count: number) => string
  contentHeading: string
  paragraphs: [string, string]
  guideHeading: string
  guideSteps: [string, string, string]
  internalLinkLabel: string
}

const DEFINITIONS: Record<DanetkiCollectionSlug, DanetkiCollectionDefinition> = {
  'dlya-detey': {
    slug: 'dlya-detey',
    canonicalPath: '/danetki/dlya-detey',
    title: 'Данетки для детей с ответами — логические загадки | Сходится!',
    description: (count) => `Данетки для детей с ответами: ${count} понятных историй на логику для дома, школы и детской компании. Условия, вопросы и игра с ведущим без спойлеров.`,
    heading: 'Данетки для детей с ответами',
    eyebrow: 'Детская подборка · без взрослого контента',
    lead: 'Понятные школьникам истории про уроки, животных, спорт и повседневные открытия. Ответы спрятаны, поэтому сначала можно найти разгадку самостоятельно.',
    countLabel: 'Детских историй',
    factLabel: 'Возраст',
    factValue: 'Ориентир 7–12 лет',
    sectionHeading: 'Детские данетки',
    sectionLead: (count) => `${count} историй, отобранных по понятности сюжета и безопасной развязке.`,
    contentHeading: 'Как играть в детские данетки',
    paragraphs: [
      'Детская данетка — это короткая необычная ситуация, которую ребёнок распутывает вопросами с ответами «да» или «нет». Такой формат тренирует внимание к формулировкам, причинно-следственное мышление и умение спокойно проверять версии.',
      'Подборка подходит для семейного вечера, классного часа и небольшой детской компании. В каждой истории есть условие, стартовые вопросы и полный ответ под спойлером; выбранную загадку можно запустить с ведущим без раскрытия решения.',
    ],
    guideHeading: 'Удобный сценарий для детей',
    guideSteps: [
      'Взрослый или ведущий читает только условие, не открывая ответ.',
      'Игроки по очереди задают короткие вопросы и отделяют факты от догадок.',
      'Когда версия объясняет все детали, команда сверяется с ответом или запускает игру с ведущим.',
    ],
    internalLinkLabel: 'Данетки для детей',
  },
  slozhnye: {
    slug: 'slozhnye',
    canonicalPath: '/danetki/slozhnye',
    title: 'Сложные данетки с ответами — трудные загадки | Сходится!',
    description: (count) => `Сложные данетки с ответами: ${count} трудных историй для опытных игроков. Проверяйте версии, открывайте подсказки или играйте с ведущим.`,
    heading: 'Сложные данетки с ответами',
    eyebrow: 'Высокая сложность · для опытных игроков',
    lead: 'Истории, в которых первая очевидная версия почти всегда ведёт в тупик. Здесь важны точные вопросы, скрытые предпосылки и цельное объяснение каждой детали.',
    countLabel: 'Сложных историй',
    factLabel: 'Уровень',
    factValue: 'Высокий',
    sectionHeading: 'Самые сложные данетки',
    sectionLead: (count) => `${count} трудных дел с многоступенчатой логикой и ответами под спойлером.`,
    contentHeading: 'Чем сложные данетки отличаются от обычных',
    paragraphs: [
      'В сложной данетке недостаточно угадать один неожиданный факт. Правильная версия должна связать место, время, мотив и действия участников, а случайная догадка быстро проверяется дополнительными вопросами.',
      'Эти истории лучше разгадывать вдвоём или командой: один игрок проверяет обстоятельства, другой ищет скрытое допущение, третий собирает общую версию. Если расследование остановилось, используйте стартовые вопросы или сыграйте с ведущим.',
    ],
    guideHeading: 'Как подступиться к сложному делу',
    guideSteps: [
      'Разделите условие на проверяемые факты и собственные предположения.',
      'Последовательно уточните место, время, роли участников и причинность событий.',
      'Перед ответом проверьте, объясняет ли версия каждую странность без исключений.',
    ],
    internalLinkLabel: 'Сложные данетки',
  },
  legkie: {
    slug: 'legkie',
    canonicalPath: '/danetki/legkie',
    title: 'Лёгкие данетки с ответами — простые загадки | Сходится!',
    description: (count) => `Лёгкие данетки с ответами: ${count} коротких историй для знакомства с игрой. Найдите разгадку сами или задавайте вопросы ведущему.`,
    heading: 'Лёгкие данетки с ответами',
    eyebrow: 'Быстрый старт · простые истории',
    lead: 'Короткие загадки с одной ключевой неожиданностью. Подойдут новичкам, разминке перед сложной игрой и компании, которая впервые знакомится с данетками.',
    countLabel: 'Лёгких историй',
    factLabel: 'Темп',
    factValue: 'Обычно 4–7 минут',
    sectionHeading: 'Простые и лёгкие данетки',
    sectionLead: (count) => `${count} историй с понятным условием и компактной разгадкой.`,
    contentHeading: 'Лёгкие данетки для первого раунда',
    paragraphs: [
      'Лёгкие данетки сохраняют главный принцип игры — необычное условие и вопросы «да» или «нет», — но требуют меньше промежуточных догадок. Обычно достаточно найти одну скрытую особенность ситуации и проверить её несколькими вопросами.',
      'Начните с условия, попробуйте назвать наиболее простое объяснение и не бойтесь уточнять очевидные детали. Ответ каждой истории спрятан под спойлером, а режим с ведущим позволяет пройти ту же данетку как настоящее расследование.',
    ],
    guideHeading: 'Как провести быстрый раунд',
    guideSteps: [
      'Прочитайте условие и сформулируйте первую проверяемую версию.',
      'Задайте вопросы о главном герое, месте и необычной детали.',
      'Соберите ответ за несколько минут и переходите к следующей истории.',
    ],
    internalLinkLabel: 'Лёгкие данетки',
  },
  novye: {
    slug: 'novye',
    canonicalPath: '/danetki/novye',
    title: 'Новые данетки с ответами — свежие истории | Сходится!',
    description: (count) => `Новые данетки с ответами: ${count} последних историй редакционной коллекции «Сходится!». Читайте условия и играйте с ведущим без спойлеров.`,
    heading: 'Новые данетки с ответами',
    eyebrow: 'Последние публикации · редакционная коллекция',
    lead: 'Свежие истории, добавленные в каталог последними. Здесь удобно искать новые сюжеты, если классические данетки уже знакомы вашей компании.',
    countLabel: 'Последних историй',
    factLabel: 'Порядок',
    factValue: 'Сначала новые',
    sectionHeading: 'Новые данетки',
    sectionLead: (count) => `${count} последних опубликованных историй с условиями и ответами.`,
    contentHeading: 'Что считается новой данеткой',
    paragraphs: [
      'В эту подборку автоматически попадают последние опубликованные истории из редакционного каталога. Дата относится к появлению данетки на «Сходится!», поэтому наверху всегда находятся самые свежие добавления, а не случайная выборка.',
      'Каждая новая история проходит ту же проверку структуры: понятное условие, полная разгадка, стартовые вопросы и факты для ведущего. Подборка обновляется вместе с библиотекой и не требует отдельного ручного копирования страниц.',
    ],
    guideHeading: 'Как следить за обновлениями',
    guideSteps: [
      'Открывайте подборку после пополнения каталога — новые истории появляются наверху автоматически.',
      'Проверяйте условие без ответа и переходите в игру с ведущим, если сюжет вам незнаком.',
      'После расследования выбирайте похожие истории или возвращайтесь к общему каталогу.',
    ],
    internalLinkLabel: 'Новые данетки',
  },
}

export const isDanetkiCollectionSlug = (value: string | null | undefined): value is DanetkiCollectionSlug =>
  DANETKI_COLLECTION_SLUGS.includes(String(value ?? '') as DanetkiCollectionSlug)

export const danetkiCollectionDefinition = (slug: DanetkiCollectionSlug) => DEFINITIONS[slug]

export const danetkiCollectionItems = (slug: DanetkiCollectionSlug): DanetkiCatalogItem[] => {
  if (slug === 'dlya-detey') return DANETKI_CATALOG_ITEMS.filter((item) => item.genres.includes('детская'))
  if (slug === 'slozhnye') return DANETKI_CATALOG_ITEMS.filter((item) => item.difficulty === 'hard')
  if (slug === 'legkie') return DANETKI_CATALOG_ITEMS.filter((item) => item.difficulty === 'easy')
  return [...DANETKI_CATALOG_ITEMS]
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt) || right.popularityScore - left.popularityScore)
    .slice(0, 12)
}

export const danetkiCollectionFromPathname = (pathname: string) => {
  const slug = pathname.match(/^\/danetki\/([^/]+)\/?$/)?.[1]
  return isDanetkiCollectionSlug(slug) ? danetkiCollectionDefinition(slug) : null
}

export const danetkiCatalogItemsForPathname = (pathname: string) => {
  const collection = danetkiCollectionFromPathname(pathname)
  return collection ? danetkiCollectionItems(collection.slug) : DANETKI_CATALOG_ITEMS
}

export const DANETKI_COLLECTION_DEFINITIONS = DANETKI_COLLECTION_SLUGS.map(danetkiCollectionDefinition)
