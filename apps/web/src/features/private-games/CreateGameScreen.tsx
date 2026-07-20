import { useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarCheck2,
  Check,
  CircleCheckBig,
  Clock3,
  MonitorPlay,
  Palette,
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

const formats = [
  {
    icon: UsersRound,
    label: 'Командное событие',
    title: 'Вовлечь всех, а не только самых громких',
    text: 'Для тимбилдинга, корпоратива или пятничного созвона. Участники играют со своих устройств — вместе в зале или онлайн.',
    meta: '10–500+ участников',
  },
  {
    icon: BriefcaseBusiness,
    label: 'Внутренние коммуникации',
    title: 'Рассказать о компании через игру',
    text: 'Онбординг, запуск продукта, ценности и итоги года превращаются в живой формат, который хочется обсуждать.',
    meta: 'Ваши факты и визуальный стиль',
  },
  {
    icon: Sparkles,
    label: 'Бренд-активация',
    title: 'Сделать событие заметным',
    text: 'Игра для конференции, стенда, клиентского вечера или спецпроекта — с отдельной ссылкой и нужной механикой.',
    meta: 'Под ключ к дате события',
  },
]

const steps = [
  ['01', 'Бриф', 'Уточняем аудиторию, повод, площадку и желаемый результат.'],
  ['02', 'Сценарий', 'Предлагаем тему, механику и структуру игрового сеанса.'],
  ['03', 'Продакшн', 'Собираем контент, оформляем и вручную проверяем ответы.'],
  ['04', 'Запуск', 'Передаём частную ссылку и остаёмся на связи в день события.'],
]

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

        <section className="create-game-hero" aria-labelledby="partners-title">
          <div className="create-game-hero__copy">
            <span className="create-game-eyebrow">
              <BriefcaseBusiness /> Сходится! для бизнеса
            </span>
            <h1 id="partners-title">
              Игра, которая <em>работает</em> на вашу команду
            </h1>
            <p>
              Создадим интерактивный игровой сеанс под ваше событие, бренд и аудиторию — от идеи до готовой частной ссылки.
            </p>
            <div className="create-game-hero__actions">
              <a className="create-game-button create-game-button--primary" href="#brief">
                Обсудить проект <ArrowRight />
              </a>
              <a className="create-game-button create-game-button--ghost" href="#formats">
                Посмотреть форматы
              </a>
            </div>
            <div className="create-game-hero__facts" aria-label="Ключевые параметры">
              <span><strong>10–500+</strong> участников</span>
              <span><strong>15–40</strong> минут игры</span>
              <span><strong>1 ссылка</strong> без установки</span>
            </div>
          </div>

          <div className="create-game-art" aria-label="Пример брендированного игрового сеанса">
            <div className="create-game-art__halo" />
            <img src={privateGameArt} alt="Коллаж игровых тем «Сходится!»" />
            <div className="create-game-ticket">
              <div className="create-game-ticket__top">
                <span>PRIVATE SESSION</span>
                <Sparkles />
              </div>
              <strong>Ваша команда.<br />Ваша история.</strong>
              <small>Собрано редакцией «Сходится!»</small>
            </div>
            <div className="create-game-float-card create-game-float-card--top">
              <Palette /> <span>В стиле<br /><strong>вашего бренда</strong></span>
            </div>
            <div className="create-game-float-card create-game-float-card--bottom">
              <CircleCheckBig /> <span>Контент<br /><strong>проверен вручную</strong></span>
            </div>
          </div>
        </section>

        <section className="create-game-trust" aria-label="Преимущества формата">
          <p>Подходит для офиса, онлайна и большой сцены</p>
          <div>
            <span><MonitorPlay /> Работает в браузере</span>
            <span><ShieldCheck /> Доступ по частной ссылке</span>
            <span><CalendarCheck2 /> Готово к вашей дате</span>
          </div>
        </section>

        <section className="create-game-formats" id="formats">
          <div className="create-game-section-heading">
            <span>Сценарии</span>
            <h2>Не просто квиз.<br />Инструмент для вашей задачи</h2>
            <p>Сохраняем лёгкость игры, а содержание и подачу настраиваем под контекст компании.</p>
          </div>
          <div className="create-game-format-grid">
            {formats.map(({ icon: Icon, label, title, text, meta }, index) => (
              <article key={label} className={`create-game-format-card create-game-format-card--${index + 1}`}>
                <div className="create-game-format-card__top">
                  <span><Icon /></span>
                  <small>0{index + 1}</small>
                </div>
                <p>{label}</p>
                <h3>{title}</h3>
                <div className="create-game-format-card__line" />
                <div className="create-game-format-card__detail">
                  <p>{text}</p>
                  <strong><Check /> {meta}</strong>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="create-game-value">
          <div className="create-game-value__lead">
            <span>Что получаете</span>
            <h2>Всё, чтобы просто отправить ссылку и начать</h2>
          </div>
          <div className="create-game-value__list">
            <article>
              <span>01</span>
              <div><strong>Сценарий под задачу</strong><p>Поможем найти идею и механику, даже если у вас пока есть только дата.</p></div>
            </article>
            <article>
              <span>02</span>
              <div><strong>Редакторская сборка</strong><p>Берём на себя вопросы, ответы, визуалы, тональность и финальную вычитку.</p></div>
            </article>
            <article>
              <span>03</span>
              <div><strong>Отдельный игровой сеанс</strong><p>Участники заходят по ссылке с телефона или компьютера — без регистрации и установки.</p></div>
            </article>
          </div>
        </section>

        <section className="create-game-process" aria-labelledby="process-title">
          <div className="create-game-section-heading create-game-section-heading--row">
            <div><span>Как это работает</span><h2 id="process-title">От задачи до запуска — четыре шага</h2></div>
            <p>Один контакт с нашей стороны, прозрачные этапы и согласование до публикации.</p>
          </div>
          <div className="create-game-process__grid">
            {steps.map(([number, title, text]) => (
              <article key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="create-game-order" id="brief">
          <div className="create-game-order__intro">
            <span>Давайте знакомиться</span>
            <h2>Расскажите о событии</h2>
            <p>Ответим по рабочей почте, уточним задачу и предложим формат, сроки и стоимость.</p>
            <div className="create-game-order__promise">
              <Clock3 />
              <div><strong>Без оплаты на этом этапе</strong><small>Сначала обсудим идею и зафиксируем объём работ.</small></div>
            </div>
            <div className="create-game-order__promise">
              <ShieldCheck />
              <div><strong>Ваши материалы останутся частными</strong><small>Игра не появится в публичном каталоге.</small></div>
            </div>
          </div>

          {sent ? (
            <div className="create-game-success" role="status">
              <Check />
              <h3>Заявка отправлена</h3>
              <p>Спасибо! Мы получили описание и вернёмся с уточнениями по указанной почте.</p>
              <button type="button" onClick={onHome}>Вернуться к играм</button>
            </div>
          ) : (
            <form onSubmit={(event) => void submit(event)}>
              <label>
                <span>Как к вам обращаться</span>
                <input name="contactName" minLength={2} maxLength={120} placeholder="Имя" required />
              </label>
              <label>
                <span>Рабочая почта</span>
                <input name="email" type="email" maxLength={254} placeholder="name@company.ru" required />
              </label>
              <label>
                <span>Компания или проект</span>
                <input name="company" maxLength={160} placeholder="Название компании" />
              </label>
              <label>
                <span>Участников</span>
                <input name="participants" type="number" min={2} max={10000} defaultValue={20} required />
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
                  placeholder="Повод, формат, тема и любые важные детали"
                  required
                />
              </label>
              <label className="create-game-honeypot" aria-hidden="true">
                <span>Сайт</span>
                <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
              <label className="create-game-consent create-game-wide">
                <input type="checkbox" required />
                <span>Согласен на обработку контактных данных для ответа на заявку.</span>
              </label>
              <button className="create-game-wide" type="submit" disabled={pending}>
                {pending ? 'Отправляем…' : <>Обсудить проект <ArrowRight /></>}
              </button>
              {error && <p className="create-game-wide" role="alert">{error}</p>}
            </form>
          )}
        </section>
      </main>
    </>
  )
}
