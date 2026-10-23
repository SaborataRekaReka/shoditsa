import { LockKeyhole } from 'lucide-react'
import { publicAssetUrl } from '../../app/public-asset'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { STUDY_CLUB_OFFER_HREF, studyAccountHref } from './account-routing'
import type { ClubLibraryAccess } from './club-library-access'

type Props = {
  access: ClubLibraryAccess
  onRetry: () => void
}

/** The original welcome block is independent of the specials section. */
export function StudyClubGate({ access, onRetry }: Props) {
  if (access === 'member') return null
  const waiting = access === 'loading'
  const failed = access === 'error'
  const guest = access === 'guest'
  return <div className="club-library-gate" data-club-access={access} aria-busy={waiting}>
    <div className="club-library-gate-skeletons" aria-hidden="true">{[0, 1].map(index => <div className="club-library-gate-skeleton" key={index}>
      <span className="club-library-gate-cover" />
      <span className="club-library-gate-line" />
      <span className="club-library-gate-line club-library-gate-line--short" />
      <span className="club-library-gate-line" />
      <span className="club-library-gate-button" />
    </div>)}</div>
    <section className="club-library-gate-message" aria-labelledby="club-gate-title" aria-live="polite">
      <div className="club-library-gate-medal"><img src={publicAssetUrl('images/mascot/club-v1.webp')} width="132" height="132" alt="" />{!waiting && !failed && <span><LockKeyhole size={20} aria-hidden="true" /></span>}</div>
      <h2 id="club-gate-title">{waiting ? 'Готовим твой клуб' : failed ? 'Не удалось проверить билет' : guest ? 'Твоя клубная библиотека ждёт' : 'Открой больше любимых игр'}</h2>
      <p>{waiting ? 'Проверяем доступ к спецпоказам.' : failed ? 'Попробуй ещё раз — мы проверим твой доступ и покажем библиотеку.' : guest ? 'Войди в аккаунт, чтобы открыть свои спецпоказы. Клубный билет соберёт их все в одном месте.' : 'Тематические спецпоказы входят в клубный билет. Выбирай любимую тему и играй в своём ритме.'}</p>
      {failed ? <QuestButton onClick={onRetry}>Проверить ещё раз</QuestButton> : !waiting && <>
        <a className="quest-button quest-button--primary" href={guest ? studyAccountHref('login') : STUDY_CLUB_OFFER_HREF}>{guest ? 'Войти в аккаунт' : 'Вступить в клуб'}</a>
        {guest && <a className="club-library-gate-secondary" href={STUDY_CLUB_OFFER_HREF}>Что входит в Клуб</a>}
      </>}
    </section>
  </div>
}
