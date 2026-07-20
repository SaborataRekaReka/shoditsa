import { useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  BriefcaseBusiness,
  Check,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from 'lucide-react'
import { AppHeader } from '../../components/app-shell/AppShell'
import { api } from '../../api/client'
import { publicAssetUrl } from '../../app/public-asset'
import '../commerce/CommercialShell.css'

type Props = {
  onHome: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
}

const privateGameArt = publicAssetUrl('images/profile-hero-collage.webp')

export function CreateGameScreen({
  onHome,
  onArchive,
  onStats,
  onRules,
  onReview,
}: Props) {
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    const data = new FormData(event.currentTarget)
    setPending(true)
    setError('')
    try {
      await api.createPrivateGameOrder({
        contactName: String(data.get('contactName') ?? ''),
        email: String(data.get('email') ?? ''),
        company: String(data.get('company') ?? '') || undefined,
        participants: Number(data.get('participants')),
        eventDate: String(data.get('eventDate') ?? '') || null,
        description: String(data.get('description') ?? ''),
        consent: true,
        website: String(data.get('website') ?? ''),
      })
      setSent(true)
    } catch (value) {
      setError(
        value instanceof Error
          ? value.message
          : 'Не удалось отправить заявку. Попробуйте ещё раз.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <AppHeader
        onHome={onHome}
        onArchive={onArchive}
        onStats={onStats}
        onRules={onRules}
        onReview={onReview}
      />
      <main className="create-game-screen">
        <button type="button" className="create-game-back" onClick={onHome}>
          <ArrowLeft /> На главную
        </button>
        <section className="create-game-hero">
          <div className="create-game-hero__copy">
            <span>
              <BriefcaseBusiness /> Корпоративным клиентам
            </span>
            <h1>
              Свой сеанс
              <br />
              «Сходится!»
            </h1>
            <p>
              Игра для команды, события, конференции или частного праздника — с
              вашей темой, отдельной ссылкой и знакомыми правилами.
            </p>
          </div>
          <div className="create-game-art">
            <img src={privateGameArt} alt="Коллаж игровых тем «Сходится!»" />
            <div className="create-game-ticket">
              <Sparkles />
              <strong>
                PRIVATE
                <br />
                SCREENING
              </strong>
              <small>для вашей компании</small>
            </div>
          </div>
        </section>
        <section className="create-game-benefits">
          <article>
            <UsersRound />
            <strong>Под вашу аудиторию</strong>
            <p>Согласуем тему, число участников и формат проведения.</p>
          </article>
          <article>
            <ShieldCheck />
            <strong>Без публичного каталога</strong>
            <p>Готовая игра открывается только по частной ссылке.</p>
          </article>
          <article>
            <Check />
            <strong>С ручной проверкой</strong>
            <p>Редактор подготовит набор и проверит ответы до события.</p>
          </article>
        </section>
        <section className="create-game-order">
          <div>
            <span>Заявка</span>
            <h2>Расскажите о событии</h2>
            <p>
              На этом этапе оплаты в игре нет. Мы свяжемся с вами, уточним
              задачу и отдельно согласуем сроки и стоимость.
            </p>
          </div>
          {sent ? (
            <div className="create-game-success" role="status">
              <Check />
              <h3>Заявка отправлена</h3>
              <p>
                Спасибо! Мы получили описание и вернёмся с уточнениями по
                указанной почте.
              </p>
              <button type="button" onClick={onHome}>
                Вернуться к играм
              </button>
            </div>
          ) : (
            <form onSubmit={(event) => void submit(event)}>
              <label>
                <span>Как к вам обращаться</span>
                <input
                  name="contactName"
                  minLength={2}
                  maxLength={120}
                  placeholder="Имя"
                  required
                />
              </label>
              <label>
                <span>Рабочая почта</span>
                <input
                  name="email"
                  type="email"
                  maxLength={254}
                  placeholder="name@company.ru"
                  required
                />
              </label>
              <label>
                <span>Компания или проект</span>
                <input
                  name="company"
                  maxLength={160}
                  placeholder="Необязательно"
                />
              </label>
              <label>
                <span>Участников</span>
                <input
                  name="participants"
                  type="number"
                  min={2}
                  max={10000}
                  defaultValue={20}
                  required
                />
              </label>
              <label>
                <span>Желаемая дата</span>
                <input name="eventDate" type="date" />
              </label>
              <label className="create-game-wide">
                <span>Что хотите устроить</span>
                <textarea
                  name="description"
                  minLength={20}
                  maxLength={4000}
                  rows={6}
                  placeholder="Тема, повод, формат и любые важные детали"
                  required
                />
              </label>
              <label className="create-game-honeypot" aria-hidden="true">
                <span>Сайт</span>
                <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
              <label className="create-game-consent create-game-wide">
                <input type="checkbox" required />{' '}
                <span>
                  Согласен на обработку контактных данных для ответа на заявку.
                </span>
              </label>
              <button
                className="create-game-wide"
                type="submit"
                disabled={pending}
              >
                {pending ? 'Отправляем…' : 'Отправить заявку'}
              </button>
              {error && (
                <p className="create-game-wide" role="alert">
                  {error}
                </p>
              )}
            </form>
          )}
        </section>
      </main>
    </>
  )
}
