export type BlogPost = {
  slug: string
  category: 'news' | 'changelog'
  date: string
  title: string
  excerpt: string
  sections: Array<{ heading?: string; paragraphs?: string[]; items?: string[] }>
}

export const BLOG_CATEGORY_LABELS = { news: 'Новости', changelog: 'Обновления' } as const

/** New posts go first. Dates describe these entries, not deployment dates. */
export const BLOG_POSTS: readonly BlogPost[] = [
  {
    slug: 'support-and-blog',
    category: 'changelog',
    date: '2026-10-21',
    title: 'Связаться с нами стало проще',
    excerpt: 'Отдельная форма для вопросов, ошибок и идей. А новости и списки изменений теперь собираем в блоге.',
    sections: [
      { heading: 'Форма обратной связи', paragraphs: ['Если игра работает не так, возник вопрос по оплате или появилась идея, откройте раздел «Поддержка». Выберите тему, оставьте email для ответа и расскажите, что случилось. Аккаунт для этого не нужен.'] },
      { heading: 'Что появилось', items: ['Форма обращения в поддержку с ответом по email.', 'Блог с новостями и короткими списками изменений.', 'Ссылки на оба раздела в подвале сайта.'] },
    ],
  },
  {
    slug: 'hello',
    category: 'news',
    date: '2026-10-21',
    title: 'Теперь у «Сходится!» есть блог',
    excerpt: 'Место для небольших новостей о проекте: что появилось, что изменилось и над чем мы работаем.',
    sections: [
      { paragraphs: ['Здесь будем рассказывать о новостях «Сходится!» и изменениях, которые помогают играть удобнее. Коротко и по делу.'] },
      { heading: 'Что здесь читать', paragraphs: ['В новостях — события и заметки о проекте. В обновлениях — конкретные изменения и исправления. У каждой записи есть своя ссылка, чтобы её было удобно отправить друзьям.'] },
    ],
  },
]

export const blogPostBySlug = (slug: string) => BLOG_POSTS.find(post => post.slug === slug)
export const blogPostHref = (slug: string) => `/blog/${encodeURIComponent(slug)}`
export const formatBlogDate = (date: string) => new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${date}T12:00:00Z`))
