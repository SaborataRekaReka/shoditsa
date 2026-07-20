import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  Check,
  Clapperboard,
  Lock,
  Play,
  Sparkles,
} from 'lucide-react'
import { AppHeader } from '../../components/app-shell/AppShell'
import { api, queryKeys } from '../../api/client'
import {
  SERVER_RUNTIME,
  useServerRuntime,
} from '../../hooks/use-server-runtime'
import { trackClientEvent } from '../../app/client-events'
import { publicAssetUrl } from '../../app/public-asset'
import { CheckoutButton } from './CheckoutButton'
import './CommercialShell.css'

type ShellProps = {
  onHome: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
}

const money = (minor: number | null, currency: string | null) =>
  minor === null || !currency
    ? null
    : new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(minor / 100)

const fallbackCover = publicAssetUrl(
  'images/title-posters/game-ticket-poster.webp',
)

export function SpecialsScreen({
  onHome,
  onArchive,
  onStats,
  onRules,
  onReview,
}: ShellProps) {
  const packs = useQuery({
    queryKey: queryKeys.packs,
    queryFn: api.packs,
    enabled: SERVER_RUNTIME,
  })
  return (
    <>
      <AppHeader
        onHome={onHome}
        onArchive={onArchive}
        onStats={onStats}
        onRules={onRules}
        onReview={onReview}
      />
      <main className="specials-screen">
        <button className="specials-back" type="button" onClick={onHome}>
          <ArrowLeft /> На главную
        </button>
        <header className="specials-hero">
          <div className="specials-hero__copy">
            <span>
              <Sparkles /> Спецпоказы
            </span>
            <h1>
              Тематические
              <br />
              сеансы
            </h1>
            <p>
              Отдельные подборки с собственным прогрессом. Первые игры некоторых
              показов можно открыть бесплатно.
            </p>
          </div>
          <div className="specials-hero__poster" aria-hidden="true">
            <img src={fallbackCover} alt="" />
            <span>
              NOW
              <br />
              SHOWING
            </span>
          </div>
        </header>
        {packs.isLoading && <p>Готовим афишу…</p>}
        {packs.isError && (
          <p role="alert">Не удалось загрузить афишу. Попробуйте ещё раз.</p>
        )}
        <section className="specials-grid">
          {(packs.data?.items ?? []).map((pack) => (
            <a
              key={pack.id}
              href={`/specials/${encodeURIComponent(pack.id)}`}
              className="special-card"
            >
              <figure>
                <img
                  src={pack.coverUrl || fallbackCover}
                  alt=""
                  loading="lazy"
                />
              </figure>
              <div className="special-card__copy">
                <span>
                  <Clapperboard /> {pack.totalItems} игр · {pack.completedItems}{' '}
                  пройдено
                </span>
                <h2>{pack.title}</h2>
                <p>{pack.subtitle || pack.description}</p>
              </div>
              <strong>
                {pack.owned
                  ? 'Куплено навсегда'
                  : pack.access === 'club'
                    ? 'В клубе'
                    : pack.access === 'free'
                      ? 'Бесплатно'
                      : (money(pack.priceMinor, pack.currency) ?? 'Открыть')}
              </strong>
            </a>
          ))}
        </section>
      </main>
    </>
  )
}

export function SpecialDetailScreen({
  packId,
  onHome,
  onArchive,
  onStats,
  onRules,
  onReview,
  onSession,
}: ShellProps & { packId: string; onSession: (id: string) => void }) {
  const runtime = useServerRuntime()
  const [starting, setStarting] = useState<number | null>(null)
  const [error, setError] = useState('')
  const packQuery = useQuery({
    queryKey: queryKeys.pack(packId),
    queryFn: () => api.pack(packId),
    enabled: SERVER_RUNTIME && Boolean(packId),
  })
  const catalog = useQuery({
    queryKey: queryKeys.commerceCatalog,
    queryFn: api.commerceCatalog,
    enabled: SERVER_RUNTIME,
  })
  const pack = packQuery.data?.pack
  const product = catalog.data?.products.find(
    (entry) => entry.id === pack?.productId,
  )
  const authenticated = Boolean(runtime.me && !runtime.me.user.isAnonymous)

  useEffect(() => {
    if (!pack) return
    trackClientEvent('pack_opened', {
      packId: pack.id,
      access: pack.access,
      owned: pack.owned,
    })
    if (pack.access === 'locked')
      trackClientEvent('pack_paywall_view', {
        packId: pack.id,
        productId: pack.productId,
      })
  }, [pack])

  const start = async (position: number) => {
    if (starting !== null) return
    setStarting(position)
    setError('')
    try {
      const response = await api.startPack(packId, position)
      onSession(response.session.id)
    } catch (value) {
      setError(
        value instanceof Error ? value.message : 'Не удалось начать игру.',
      )
    } finally {
      setStarting(null)
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
      <main className="specials-screen">
        <a className="specials-back" href="/specials">
          <ArrowLeft /> Все спецпоказы
        </a>
        {packQuery.isLoading && <p>Открываем зал…</p>}
        {packQuery.isError && (
          <p role="alert">Спецпоказ не найден или временно недоступен.</p>
        )}
        {pack && (
          <>
            <header className="specials-hero specials-hero--detail">
              <div className="specials-hero__copy">
                <span>
                  <Clapperboard /> {pack.totalItems} сеансов
                </span>
                <h1>{pack.title}</h1>
                <p>{pack.subtitle}</p>
                <p>{pack.description}</p>
                <div className="specials-access">
                  <strong>
                    {pack.owned
                      ? 'Ваш навсегда'
                      : pack.access === 'club'
                        ? 'Доступ по клубному билету'
                        : pack.access === 'free'
                          ? 'Бесплатный показ'
                          : pack.access === 'preview'
                            ? `${pack.previewItems} игры бесплатно`
                            : `Полный показ · ${money(pack.priceMinor, pack.currency) ?? 'по билету'}`}
                  </strong>
                  {pack.access === 'club' && !pack.owned && (
                    <small>
                      Это временный доступ: он действует, пока активен клубный
                      билет.
                    </small>
                  )}
                </div>
                {pack.access === 'locked' &&
                  product &&
                  catalog.data?.enabled && (
                    <CheckoutButton
                      product={product}
                      authenticated={authenticated}
                      hasClub={Boolean(runtime.dashboard?.membership.active)}
                      label="Купить спецпоказ навсегда"
                      placement="pack_paywall"
                      returnUrl={`/specials/${encodeURIComponent(pack.id)}`}
                    />
                  )}
              </div>
              <div className="specials-hero__poster">
                <img
                  src={pack.coverUrl || fallbackCover}
                  alt={`Афиша «${pack.title}»`}
                />
              </div>
            </header>
            <section className="special-entries" aria-label="Игры спецпоказа">
              {pack.entries.map((entry) => (
                <article
                  key={entry.position}
                  className={entry.accessible ? '' : 'is-locked'}
                >
                  <span>
                    {entry.completed ? (
                      <Check />
                    ) : entry.accessible ? (
                      <Play />
                    ) : (
                      <Lock />
                    )}
                  </span>
                  <div>
                    <strong>Сеанс №{entry.position}</strong>
                    <small>
                      {entry.completed
                        ? 'Пройден'
                        : entry.preview
                          ? 'Бесплатный просмотр'
                          : entry.accessible
                            ? 'Готов к началу'
                            : 'Нужен доступ'}
                    </small>
                  </div>
                  <button
                    type="button"
                    disabled={!entry.accessible || starting !== null}
                    onClick={() => void start(entry.position)}
                  >
                    {starting === entry.position
                      ? 'Открываем…'
                      : entry.completed
                        ? 'Открыть снова'
                        : 'Играть'}
                  </button>
                </article>
              ))}
            </section>
            {error && (
              <p className="specials-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </main>
    </>
  )
}
