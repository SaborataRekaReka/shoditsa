import { useState, type FormEvent, type MouseEvent } from 'react'
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarCheck2,
  Check,
  Clock3,
  ExternalLink,
  FileCheck2,
  Image,
  Lightbulb,
  Link2,
  MonitorPlay,
  PencilLine,
  Rocket,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { publicAssetUrl } from '../../app/public-asset'
import { api } from '../../api/client'
import { ActionButton, AppHeader, ScreenBack } from '../../components/app-shell/AppShell'
import './CorporatePage.css'

type Props = {
  onHome: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
}

const heroArt = publicAssetUrl('images/corporate/corporate-hero.webp')

const formats = [
  {
    image: publicAssetUrl('images/corporate/format-team.webp'),
    alt: 'Коллаж: командная игра за круглым столом',
    label: 'Командное событие',
    audience: 'Для своих',
    duration: '15–30 минут',
    title: 'Вовлечь всех, а не только самых громких',
    text: 'Факты о коллегах, проектах и офисной жизни превращаются в игру для тимбилдинга, корпоратива или пятничного созвона.',
  },
  {
    image: publicAssetUrl('images/corporate/format-comms.webp'),
    alt: 'Коллаж: коммуникация и обмен идеями',
    label: 'Внутренние коммуникации',
    audience: 'Про компанию',
    duration: '20–40 минут',
    title: 'Рассказать о компании через игру',
    text: 'Онбординг, запуск продукта, ценности или итоги года становятся живым форматом, который хочется обсуждать.',
  },
  {
    image: publicAssetUrl('images/corporate/format-event.webp'),
    alt: 'Коллаж: брендированная игровая зона на событии',
    label: 'Бренд-активация',
    audience: 'Для гостей',
    duration: '10–25 минут',
    title: 'Сделать событие заметным',
    text: 'Отдельная игра для конференции, стенда, клиентского вечера или спецпроекта — по QR-коду и в визуальном стиле бренда.',
  },
]

const deliverables = [
  ['01', 'Сценарий под вашу задачу', 'Находим тему и механику, даже если есть только дата и общий повод.'],
  ['02', 'Редакторская сборка', 'Формулируем вопросы, собираем ответы и вручную проверяем содержание.'],
  ['03', 'Визуальный выпуск', 'Добавляем фирменные цвета, логотипы, фотографии и экран события.'],
  ['04', 'Частный игровой сеанс', 'Передаём ссылку, проверяем запуск и остаёмся на связи в день игры.'],
]

const steps = [
  { number: '01', icon: Lightbulb, title: 'Бриф', text: 'Уточняем аудиторию, повод, площадку и желаемый результат.' },
  { number: '02', icon: PencilLine, title: 'Сценарий', text: 'Предлагаем тему, механику и структуру игрового сеанса.' },
  { number: '03', icon: FileCheck2, title: 'Продакшн', text: 'Собираем контент, оформляем и вручную проверяем ответы.' },
  { number: '04', icon: Rocket, title: 'Запуск', text: 'Передаём частную ссылку и остаёмся на связи в день события.' },
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

  const scrollToSection = (event: MouseEvent<HTMLAnchorElement>, sectionId: 'brief' | 'formats') => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const section = document.getElementById(sectionId)
    if (!section) return

    event.preventDefault()
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}#${sectionId}`,
    )
    section.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

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

      <main className="corporate-page">
        <ScreenBack onBack={onHome} label="На главную" />

        <section className="corporate-hero" aria-labelledby="partners-title">
          <div className="corporate-hero__media" aria-hidden="true">
            <img src={heroArt} alt="" fetchPriority="high" />
          </div>
          <div className="corporate-hero__veil" />

          <div className="corporate-hero__copy">
            <div className="corporate-hero__badges" aria-label="Условия формата">
              <span>Без установки</span>
              <span><b>Private</b> Только ваша команда</span>
            </div>
            <span className="corporate-eyebrow"><BriefcaseBusiness /> Сходится! для бизнеса</span>
            <h1 id="partners-title">Игра, которая <em>работает</em> на вашу команду</h1>
            <p>Создадим интерактивный игровой сеанс под ваше событие, бренд и аудиторию — от идеи и редакторской сборки до готовой частной ссылки.</p>
            <div className="corporate-hero__actions">
              <a className="ui-button ui-button--primary corporate-hero__action" href="/partners#brief" onClick={(event) => scrollToSection(event, 'brief')}>
                Обсудить проект <ArrowRight />
              </a>
              <a className="ui-button ui-button--ghost corporate-hero__action" href="/partners#formats" onClick={(event) => scrollToSection(event, 'formats')}>
                Посмотреть форматы
              </a>
            </div>
          </div>

          <div className="corporate-hero__stats" aria-label="Ключевые параметры">
            <div><strong>10–500+</strong><span>участников</span></div>
            <div><strong>15–40</strong><span>минут игры</span></div>
            <div><strong>1 ссылка</strong><span>без установки</span></div>
            <p><strong>Для офиса, онлайна и большой сцены</strong>Запустим к нужной дате и останемся на связи</p>
          </div>
        </section>

        <section className="corporate-section" id="formats">
          <header className="corporate-section__heading">
            <div>
              <span className="corporate-eyebrow"><Sparkles /> Три сценария</span>
              <h2>Не просто квиз. Инструмент для вашей задачи</h2>
            </div>
            <p>Сохраняем лёгкость игры, а содержание и подачу настраиваем под контекст компании, аудиторию и площадку.</p>
          </header>

          <div className="corporate-formats">
            {formats.map((format, index) => (
              <article className="corporate-format-card" key={format.label}>
                <div className="corporate-format-card__visual">
                  <img src={format.image} alt={format.alt} loading="lazy" />
                  <span className="corporate-format-card__index">0{index + 1}</span>
                  <span className="corporate-format-card__label">{format.label}</span>
                </div>
                <div className="corporate-format-card__body">
                  <div className="corporate-format-card__meta"><span>{format.audience}</span><span>{format.duration}</span></div>
                  <h3>{format.title}</h3>
                  <p>{format.text}</p>
                  <a className="ui-button ui-button--secondary corporate-format-card__action" href="/partners#brief" onClick={(event) => scrollToSection(event, 'brief')}>Подобрать формат <ArrowRight /></a>
                </div>
              </article>
            ))}
          </div>

          <div className="corporate-trust">
            <p>Один формат — на любом экране</p>
            <div>
              <span><MonitorPlay /> Работает в браузере</span>
              <span><ShieldCheck /> Доступ по частной ссылке</span>
              <span><CalendarCheck2 /> Готово к вашей дате</span>
            </div>
          </div>
        </section>

        <section className="corporate-section" id="preview">
          <header className="corporate-section__heading">
            <div>
              <span className="corporate-eyebrow"><Sparkles /> Пример экрана</span>
              <h2>Участники узнают себя уже с первого вопроса</h2>
            </div>
            <p>Показываем сам продукт: узнаваемую игровую карточку, собранную из материалов компании.</p>
          </header>

          <div className="corporate-preview">
            <div className="corporate-preview__stage">
              <article className="corporate-question-card">
                <header><b>Раунд 03 / 10</b><span>Команда «Север»</span></header>
                <h3>Какой проект команда впервые запустила прямо из кухни?</h3>
                <div className="corporate-question-card__answers">
                  <span>Приложение для курьеров</span>
                  <span className="is-correct">Новогодний спецпроект <Check /></span>
                  <span>Первый корпоративный блог</span>
                  <span>Систему аналитики</span>
                </div>
                <footer>
                  <span>12 человек уже ответили</span>
                  <i><b /><b /><b /><b /><b /></i>
                </footer>
              </article>
            </div>

            <aside className="corporate-preview__copy">
              <span className="corporate-eyebrow"><Sparkles /> В вашей версии</span>
              <h3>Своей будет каждая деталь</h3>
              <p>Берём узнаваемую механику «Сходится!» и собираем отдельный выпуск под конкретную аудиторию.</p>
              <div className="corporate-features">
                <article><PencilLine /><div><strong>Ваши вопросы и факты</strong><span>Редактируем формулировки и вручную проверяем каждый ответ.</span></div></article>
                <article><Image /><div><strong>Фирменный визуальный слой</strong><span>Цвета, логотип, фотографии и материалы события.</span></div></article>
                <article><Link2 /><div><strong>Одна частная ссылка</strong><span>Открывается с телефона и компьютера без установки.</span></div></article>
              </div>
            </aside>
          </div>
        </section>

        <section className="corporate-section">
          <div className="corporate-value">
            <div className="corporate-value__lead">
              <span className="corporate-eyebrow"><Sparkles /> Что получаете</span>
              <h2>От вас — факты. От нас — готовая игра.</h2>
              <p>Берём на себя редактуру, дизайн и запуск. Команде остаётся перейти по ссылке и начать.</p>
            </div>
            <div className="corporate-value__list">
              {deliverables.map(([number, title, text]) => (
                <article key={number}>
                  <span>{number}</span>
                  <div><strong>{title}</strong><p>{text}</p></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="corporate-section" id="process" aria-labelledby="process-title">
          <header className="corporate-section__heading">
            <div>
              <span className="corporate-eyebrow"><Sparkles /> Как это работает</span>
              <h2 id="process-title">От задачи до запуска — четыре понятных шага</h2>
            </div>
            <p>Один контакт с нашей стороны, прозрачные этапы и согласование до публикации.</p>
          </header>

          <div className="corporate-process">
            {steps.map(({ number, icon: Icon, title, text }) => (
              <article key={number}>
                <header><span><Icon /></span><b>{number}</b></header>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="corporate-order" id="brief">
          <div className="corporate-order__intro">
            <span className="corporate-eyebrow"><Sparkles /> Заявка на спецвыпуск</span>
            <h2>Расскажите, что должно сойтись</h2>
            <p>Ответим по рабочей почте, уточним задачу и предложим формат, сроки и стоимость.</p>
            <div className="corporate-order__promise">
              <Clock3 />
              <div><strong>Без оплаты на этом этапе</strong><small>Сначала обсуждаем идею и объём работ.</small></div>
            </div>
            <div className="corporate-order__promise">
              <ShieldCheck />
              <div><strong>Материалы останутся частными</strong><small>Игра не появится в публичном каталоге.</small></div>
            </div>
          </div>

          {sent ? (
            <div className="corporate-order__success" role="status">
              <Check />
              <h3>Заявка отправлена</h3>
              <p>Спасибо! Мы получили описание и вернёмся с уточнениями по указанной почте.</p>
              <ActionButton type="button" variant="secondary" onClick={onHome}>Вернуться к играм</ActionButton>
            </div>
          ) : (
            <form className="corporate-order__form" onSubmit={(event) => void submit(event)}>
              <label>
                <span>Как к вам обращаться</span>
                <input name="contactName" minLength={2} maxLength={120} placeholder="Имя" autoComplete="name" required />
              </label>
              <label>
                <span>Рабочая почта</span>
                <input name="email" type="email" maxLength={254} placeholder="name@company.ru" autoComplete="email" required />
              </label>
              <label>
                <span>Компания или проект</span>
                <input name="company" maxLength={160} placeholder="Название компании" autoComplete="organization" />
              </label>
              <label>
                <span>Участников</span>
                <input name="participants" type="number" min={2} max={10000} defaultValue={20} required />
              </label>
              <label>
                <span>Желаемая дата</span>
                <input name="eventDate" type="date" />
              </label>
              <label className="corporate-order__wide">
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
              <label className="corporate-order__honeypot" aria-hidden="true">
                <span>Сайт</span>
                <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
              <label className="corporate-order__consent corporate-order__wide">
                <input type="checkbox" required />
                <span>Согласен на обработку контактных данных для ответа на заявку.</span>
              </label>
              <ActionButton className="corporate-order__wide" type="submit" disabled={pending}>
                {pending ? 'Отправляем…' : <>Обсудить проект <ExternalLink /></>}
              </ActionButton>
              {error && <p className="corporate-order__error corporate-order__wide" role="alert">{error}</p>}
            </form>
          )}
        </section>
      </main>
    </>
  )
}
