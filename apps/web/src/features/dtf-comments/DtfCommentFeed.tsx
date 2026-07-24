import { MessageCircle, MoreHorizontal, UserRound } from 'lucide-react'

export type DtfCommentCardData = {
  key: string
  text: string
  unlockAfterAttempts: number | null
  authorArchetype: string
}

export const dtfCommentUnlockLabel = (attempts: number | null) => {
  if (!attempts) return 'Доступен сразу'
  return `После ${attempts} ${attempts === 1 ? 'попытки' : 'попыток'}`
}

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
  disclaimer,
}: {
  subtitle: string
  disclaimer: string
}) {
  return <section className="dtf-comment-intro" aria-label="Правила комментариев DTF">
    <MessageCircle aria-hidden="true" />
    <div>
      <strong>Читайте комментарии и угадайте игру</strong>
      {subtitle && <span>{subtitle}</span>}
      {disclaimer && <small>{disclaimer}</small>}
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

  return <section className="dtf-comment-feed" aria-label="Открытые комментарии DTF">
    {orderedComments.map((comment) => {
      const isNew = comment.key === newestKey
      const author = comment.authorArchetype || 'Игрок DTF'
      return <article
        key={comment.key}
        className={`dtf-comment-card${isNew ? ' dtf-comment-card--new' : ''}`}
      >
        <div className={`dtf-comment-card__avatar dtf-comment-card__avatar--${avatarVariant(comment.key)}`} aria-hidden="true">
          <UserRound />
        </div>
        <div className="dtf-comment-card__body">
          <header>
            <div className="dtf-comment-card__author">
              <strong>{author}</strong>
              <span>комментарий игрока</span>
            </div>
            <div className="dtf-comment-card__status">
              <span>{dtfCommentUnlockLabel(comment.unlockAfterAttempts)}</span>
              {isNew && <b>Новый</b>}
            </div>
          </header>
          <p>{comment.text}</p>
          <footer>
            <span><MessageCircle /> DTF</span>
            <MoreHorizontal aria-hidden="true" />
          </footer>
        </div>
      </article>
    })}
  </section>
}
