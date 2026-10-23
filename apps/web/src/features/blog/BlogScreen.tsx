import { ArrowRight } from 'lucide-react'
import type { AppHeaderProps } from '../../components/app-shell/AppShell'
import { localPresentationLink } from '../../app/local-presentation'
import { CommunityPage } from '../community/CommunityPage'
import { BLOG_CATEGORY_LABELS, BLOG_POSTS, blogPostBySlug, blogPostHref, formatBlogDate, type BlogPost } from './posts'

const PostMeta = ({ post }: { post: BlogPost }) => <div className="blog-meta"><span>{BLOG_CATEGORY_LABELS[post.category]}</span><time dateTime={post.date}>{formatBlogDate(post.date)}</time></div>

export function BlogScreen({ slug, ...props }: AppHeaderProps & { slug?: string }) {
  const post = slug ? blogPostBySlug(slug) : undefined
  if (slug && !post) return <CommunityPage {...props} title="Запись не найдена" intro="Возможно, ссылка устарела или в ней опечатка." backHref="/blog" backLabel="Все записи"><a href={localPresentationLink('/blog')}>Перейти в блог</a></CommunityPage>
  if (post) return <CommunityPage {...props} title={post.title} intro={post.excerpt} backHref="/blog" backLabel="Все записи">
    <article className="blog-article" aria-label={post.title}>
      <PostMeta post={post} />
      {post.sections.map((section, index) => <section key={index}>
        {section.heading && <h2>{section.heading}</h2>}
        {section.paragraphs?.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        {section.items && <ul>{section.items.map(item => <li key={item}>{item}</li>)}</ul>}
      </section>)}
      <footer className="blog-article__footer">Есть вопрос или идея? <a href={localPresentationLink('/support')}>Напишите в поддержку</a>.</footer>
    </article>
  </CommunityPage>
  return <CommunityPage {...props} title="Блог" intro="Новости «Сходится!» и коротко о том, что изменилось.">
    <div className="blog-layout">
      <div className="blog-list">{BLOG_POSTS.map(post => <article className="blog-card" key={post.slug}>
        <PostMeta post={post} />
        <h2><a href={localPresentationLink(blogPostHref(post.slug))}>{post.title}</a></h2>
        <p>{post.excerpt}</p>
        <a className="blog-card__link" href={localPresentationLink(blogPostHref(post.slug))} aria-label={`Читать: ${post.title}`}>Читать дальше <ArrowRight size={18} aria-hidden="true" /></a>
      </article>)}</div>
      <aside className="support-aside"><h2>На связи</h2><p>Нашли ошибку или хотите что-то предложить? Расскажите нам.</p><p><a href={localPresentationLink('/support')}>Написать в поддержку</a></p></aside>
    </div>
  </CommunityPage>
}
