import { useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  MessageCircle,
  UserRound,
} from 'lucide-react'

export type DtfCommentCardData = {
  key: string
  text: string
  unlockAfterAttempts: number | null
  authorArchetype: string
  authorName: string
  authorAvatarUrl: string
  authorIsVerified: boolean
  authorIsPlus: boolean
  publishedAt: string
  likesCount: number | null
  dislikesCount: number | null
  replyCount: number | null
}

export const dtfCommentUnlockLabel = (attempts: number | null) => {
  if (!attempts) return 'Доступен сразу'
  return `После ${attempts} ${attempts === 1 ? 'попытки' : 'попыток'}`
}

export const dtfCommentDateLabel = (value: string) => {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

const legacyGameReference = (prefix: string, suffix: string, sequel: boolean) => {
  const startsSentence = !prefix.trimEnd() || /(?:[.!?](?:["»')\]]*)|>)$/u.test(prefix.trimEnd())
  let phrase = sequel ? 'продолжение этой игры' : 'эта игра'
  if (!sequel && /(?:^|[^\p{L}\p{N}])(?:арка|релиз|релиза|разрабы|разработчики|разработчиков|разработка|разработки|история|истории|историей|трейлер|трейлере|провал|провала|фанаты|версия|версии|ремастер|продолжение|создатели)\s*$/iu.test(prefix)) {
    phrase = 'этой игры'
  } else if (!sequel && (/\/\s*$/u.test(prefix) || /(?:^|[^\p{L}\p{N}])(?:про|в|на)\s*$/iu.test(prefix) || /(?:^|[^\p{L}\p{N}])(?:любить|создавшая|рожают)\s*$/iu.test(prefix) || /^\s+меняли(?:$|[^\p{L}\p{N}])/iu.test(suffix))) {
    phrase = 'эту игру'
  } else if (!sequel && /(?:^|[^\p{L}\p{N}])(?:dlss|длсс|fsr)\s*$/iu.test(prefix)) {
    phrase = 'этой игре'
  }
  return startsSentence
    ? phrase.charAt(0).toLocaleUpperCase('ru-RU') + phrase.slice(1)
    : phrase
}

export const dtfCommentDisplayText = (value: string) => value
  .replace(/\[\s*название игры\s*\](\s+2)?/giu, (match, sequelNumber, offset, source) => legacyGameReference(
    source.slice(0, offset),
    source.slice(offset + match.length),
    Boolean(sequelNumber),
  ))
  .replace(/эта игра\s+шикарное произведение/giu, 'эта игра — шикарное произведение')
  .replace(/эта игра\s+неиронично крутая игра/giu, 'это неиронично крутая игра')
  .replace(/эта игра\s+самая продаваемая игра/giu, 'это самая продаваемая игра')
  .replace(/продолжение этой игры\s+-\s+/giu, 'продолжение этой игры — ')
  .replace(/(^|[.!?]\s+|>\s*)(эта игра|этой игры|эту игру|этой игре|это неиронично|это самая|продолжение этой игры)/giu, (_match, lead, phrase) => (
    `${lead}${phrase.charAt(0).toLocaleUpperCase('ru-RU')}${phrase.slice(1)}`
  ))

export const newestDtfCommentKey = (
  comments: DtfCommentCardData[],
  attemptsCount: number,
) => [...comments]
  .reverse()
  .find((comment) => comment.unlockAfterAttempts === attemptsCount)?.key
  ?? null

const avatarVariant = (key: string) => (
  [...key].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4
)

export function DtfCommentIntro({
  subtitle,
}: {
  subtitle: string
}) {
  return <section className="dtf-comment-intro" aria-label="Правила комментариев DTF">
    <MessageCircle aria-hidden="true" />
    <div>
      <strong>Читайте комментарии и угадайте игру</strong>
      {subtitle && <span>{subtitle}</span>}
    </div>
  </section>
}

export function DtfCommentFeed({
  comments,
  attemptsCount,
}: {
  comments: DtfCommentCardData[]
  attemptsCount: number
}) {
  const newestKey = newestDtfCommentKey(comments, attemptsCount)
  const orderedComments = [...comments].reverse()
  const feedRef = useRef<HTMLElement | null>(null)
  const [viewportHeight, setViewportHeight] = useState<number | null>(null)
  const commentKeys = orderedComments.map((comment) => comment.key).join('|')

  useLayoutEffect(() => {
    const feed = feedRef.current
    if (!feed) return
    const cards = Array.from(feed.querySelectorAll<HTMLElement>(':scope > .dtf-comment-card')).slice(0, 2)
    const measure = () => {
      const gap = Number.parseFloat(window.getComputedStyle(feed).rowGap) || 0
      const height = Math.ceil(cards.reduce((total, card) => total + Math.max(card.scrollHeight, card.getBoundingClientRect().height), 0)
        + gap * Math.max(0, cards.length - 1))
      setViewportHeight((current) => current === height ? current : height)
    }
    measure()
    feed.scrollTop = 0
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    cards.forEach((card) => observer.observe(card))
    return () => observer.disconnect()
  }, [commentKeys])

  return <section
    ref={feedRef}
    className="dtf-comment-feed"
    aria-label="Открытые комментарии DTF"
    tabIndex={orderedComments.length > 2 ? 0 : undefined}
    style={viewportHeight ? { height: `${viewportHeight}px` } : undefined}
  >
    {orderedComments.map((comment) => {
      const isNew = comment.key === newestKey
      const author = comment.authorName || comment.authorArchetype || 'Игрок DTF'
      const authorContent = <>
        <strong>{author}</strong>
        {comment.authorIsVerified && <BadgeCheck aria-label="Подтверждённый профиль" />}
        {comment.authorIsPlus && <span>DTF Plus</span>}
      </>
      return <article
        key={comment.key}
        className={`dtf-comment-card${isNew ? ' dtf-comment-card--new' : ''}`}
      >
        <div className={`dtf-comment-card__avatar dtf-comment-card__avatar--${avatarVariant(comment.key)}`}>
          <UserRound aria-hidden="true" />
          {comment.authorAvatarUrl && <img
            src={comment.authorAvatarUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
          />}
        </div>
        <div className="dtf-comment-card__body">
          <header>
            <div className="dtf-comment-card__author">
              {authorContent}
            </div>
            <div className="dtf-comment-card__status">
              {comment.publishedAt && <time dateTime={comment.publishedAt}>{dtfCommentDateLabel(comment.publishedAt)}</time>}
              <span>{dtfCommentUnlockLabel(comment.unlockAfterAttempts)}</span>
              {isNew && <b>Новый</b>}
            </div>
          </header>
          <p>{dtfCommentDisplayText(comment.text)}</p>
          <footer>
            <div className="dtf-comment-card__metrics" aria-label="Реакции на комментарий">
              {comment.likesCount != null && <span className="dtf-comment-card__metric--likes" title="Лайки">
                <ArrowUp aria-hidden="true" /> {comment.likesCount}
              </span>}
              {Boolean(comment.dislikesCount) && <span title="Дизлайки">
                <ArrowDown aria-hidden="true" /> {comment.dislikesCount}
              </span>}
              {comment.replyCount != null && <span title="Ответы">
                <MessageCircle aria-hidden="true" /> {comment.replyCount}
              </span>}
            </div>
            <span className="dtf-comment-card__source" aria-label="DTF">DTF</span>
          </footer>
        </div>
      </article>
    })}
  </section>
}
