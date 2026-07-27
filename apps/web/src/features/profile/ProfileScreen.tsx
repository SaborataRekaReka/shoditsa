import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FULL_HOUSE_MODE_IDS, isPlayableModeId } from '@shoditsa/contracts'
import { BarChart3, Check, ChevronLeft, ChevronRight, CreditCard, Crown, Film, Heart, Lock, Mail, Medal, Play, ShieldCheck, Target, Ticket, Trophy, UserRound } from 'lucide-react'
import { MODE_CONFIG, MODE_TABS } from '../../app/mode-config'
import { MODE_PRESENTATION } from '../../app/mode-presentation'
import { publicAssetUrl } from '../../app/public-asset'
import { api, queryKeys } from '../../api/client'
import { ActionButton, AppHeader } from '../../components/app-shell/AppShell'
import { CATEGORY_TICKET_CONFIG } from '../../components/category-ticket/category-ticket.config'
import { UserBadgeList } from '../../components/user-badges/UserBadgeList'
import { ControlButton, InlineAlert, Tabs, TextInput } from '../../components/ui'
import { allGames, loadAttendanceStats, loadDailyAttendance, loadWallet } from '../../storage'
import { formatDays, getMoscowDate, prettyDate } from '../../game'
import type { SavedGame, TitleMode } from '../../types'
import { authErrorMessage } from '../auth/auth-helpers'
import { useAuthSession } from '../auth/use-auth-session'
import { TipCheckoutTrigger } from '../commerce/TipCheckout'
import { AccountAccessPanel } from './AccountAccessPanel'
import { archiveItemToSavedGame, toLegacyAttendance, toLegacyDailyAttendance, toLegacyWallet } from '../server-runtime/adapters'
import { SERVER_RUNTIME, useServerRuntime } from '../../hooks/use-server-runtime'
import './ProfileScreen.css'

const modeMeta = (mode: TitleMode) => MODE_CONFIG[mode]
const modeIcon = (mode: TitleMode) => { const Icon = MODE_PRESENTATION[mode].icon; return <Icon /> }

export type ProfileTab = 'overview' | 'stats' | 'achievements' | 'settings'

export const PROFILE_TABS: Array<{ id: ProfileTab; label: string }> = [
  { id: 'overview', label: 'Обзор' },
  { id: 'stats', label: 'Статистика' },
  { id: 'achievements', label: 'Достижения' },
  { id: 'settings', label: 'Настройки' },
]

const profileTabFromLocation = (): ProfileTab => {
  if (typeof window === 'undefined') return 'overview'
  const value = new URLSearchParams(window.location.search).get('tab')
  return PROFILE_TABS.some((tab) => tab.id === value) ? value as ProfileTab : 'overview'
}

const profileStatus = (completedGames: number) => completedGames >= 80
  ? 'Мастер экрана'
  : completedGames >= 30
    ? 'Опытный игрок'
    : completedGames >= 5
      ? 'Игрок'
      : 'Новичок'

type SupporterTier = 'paper' | 'silver' | 'gold'

const supporterTimes = (count: number) => {
  const mod100 = count % 100
  const mod10 = count % 10
  return mod100 >= 11 && mod100 <= 14 ? 'раз' : mod10 >= 2 && mod10 <= 4 ? 'раза' : 'раз'
}

export function ProfileScreen({ onHome, onArchive, onStats, onRules, onReview, onSelectMode, onClub }: {
  onHome: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
  onSelectMode: (mode: TitleMode) => void
  onClub: () => void
}) {
  const { session, loading, refresh: refreshSession } = useAuthSession()
  const serverRuntime = useServerRuntime()
  const queryClient = useQueryClient()
  const serverArchive = useQuery({
    queryKey: queryKeys.archive({ profile: true }),
    queryFn: () => api.archive(),
    enabled: SERVER_RUNTIME && Boolean(serverRuntime.me),
  })
  const commerceProfile = useQuery({
    queryKey: queryKeys.commerce,
    queryFn: api.meCommerce,
    enabled: SERVER_RUNTIME && Boolean(serverRuntime.me),
  })
  const [activeTab, setActiveTab] = useState<ProfileTab>(profileTabFromLocation)
  const [profileName, setProfileName] = useState('')
  const [profileNotice, setProfileNotice] = useState('')
  const [profileError, setProfileError] = useState('')
  const [subscriptionNotice, setSubscriptionNotice] = useState('')
  const [subscriptionError, setSubscriptionError] = useState('')
  const cancelSubscription = useMutation({
    mutationFn: (id: string) => api.cancelCommerceSubscription(id),
    onSuccess: () => {
      setSubscriptionError('')
      setSubscriptionNotice('Автопродление отключено. Уже оплаченный клубный доступ останется активным до конца срока.')
      void queryClient.invalidateQueries({ queryKey: queryKeys.commerce })
    },
    onError: (error) => {
      setSubscriptionNotice('')
      setSubscriptionError(authErrorMessage(error))
    },
  })
  const attendance = SERVER_RUNTIME ? toLegacyAttendance(serverRuntime.dashboard?.attendance) : loadAttendanceStats()
  const wallet = SERVER_RUNTIME ? toLegacyWallet(serverRuntime.dashboard) : loadWallet()
  const today = SERVER_RUNTIME
    ? toLegacyDailyAttendance(serverRuntime.dashboard?.today, serverRuntime.meta?.moscowDate ?? getMoscowDate())
    : loadDailyAttendance(getMoscowDate())
  const completedGames: SavedGame[] = SERVER_RUNTIME
    ? (serverArchive.data?.items ?? []).filter((entry) => isPlayableModeId(entry.mode)).map(archiveItemToSavedGame)
    : allGames().filter((game) => game.status === 'won' || game.status === 'lost')
  const wonGames = completedGames.filter((game) => game.status === 'won')
  const winRate = completedGames.length ? Math.round(wonGames.length / completedGames.length * 100) : 0
  const recentGames = completedGames.slice(0, 4)
  const profile = serverRuntime.me?.profile
  const displayName = session && !session.isAnonymous
    ? profile?.displayName || session.name || session.email?.split('@')[0] || 'Игрок'
    : 'Гость кинозала'
  const initials = displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('ru-RU')
  const todayDate = serverRuntime.meta?.moscowDate ?? getMoscowDate()
  const activeSession = serverRuntime.dashboard?.activeSessions.find((entry) => isPlayableModeId(entry.mode) && entry.kind === 'daily' && entry.puzzleDate === todayDate)
  const selectTab = (tab: ProfileTab) => {
    setActiveTab(tab)
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (tab === 'overview') url.searchParams.delete('tab')
    else url.searchParams.set('tab', tab)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
  const saveProfileName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!SERVER_RUNTIME || !session || session.isAnonymous) return
    setProfileNotice('')
    setProfileError('')
    try {
      await api.updateProfile({ displayName: profileName.trim() || null })
      await queryClient.invalidateQueries({ queryKey: queryKeys.me })
      await refreshSession()
      setProfileNotice('Имя профиля сохранено.')
    } catch (error) {
      setProfileError(authErrorMessage(error))
    }
  }

  useEffect(() => {
    setProfileName(profile?.displayName || session?.name || '')
  }, [profile?.displayName, session?.name])

  useEffect(() => {
    const syncTab = () => setActiveTab(profileTabFromLocation())
    window.addEventListener('popstate', syncTab)
    return () => window.removeEventListener('popstate', syncTab)
  }, [])

  const weeklyAttendance = useMemo(() => {
    const date = new Date(`${todayDate}T12:00:00+03:00`)
    const mondayOffset = (date.getUTCDay() + 6) % 7
    return ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((label, index) => ({
      label,
      isToday: index === mondayOffset,
      hasActivity: index === mondayOffset && today.completedModes.length > 0,
      isFullHouse: index === mondayOffset && today.fullHouse,
    }))
  }, [today.completedModes.length, today.fullHouse, todayDate])
  const supporterCounts = (commerceProfile.data?.entitlements ?? []).reduce<Record<SupporterTier, number>>((counts, entitlement) => {
    if (entitlement.key === 'supporter' && (entitlement.scope === 'paper' || entitlement.scope === 'silver' || entitlement.scope === 'gold')) {
      counts[entitlement.scope] += 1
    }
    return counts
  }, { paper: 0, silver: 0, gold: 0 })
  const supporterTotal = supporterCounts.paper + supporterCounts.silver + supporterCounts.gold
  const supporterTopTier: SupporterTier | null = supporterCounts.gold
    ? 'gold'
    : supporterCounts.silver
      ? 'silver'
      : supporterCounts.paper
        ? 'paper'
        : null
  const supporterTiers = [
    { scope: 'paper' as const, label: 'Бумажные', count: supporterCounts.paper, Icon: Ticket },
    { scope: 'silver' as const, label: 'Серебряные', count: supporterCounts.silver, Icon: Medal },
    { scope: 'gold' as const, label: 'Золотые', count: supporterCounts.gold, Icon: Crown },
  ]
  const bullseyeUnlocked = wonGames.some((game) => game.attempts.length === 1)
  const fullHouseProgress = today.fullHouse ? MODE_TABS.length : today.completedModes.length
  const achievementCards = [
    { key: 'first-game', title: 'Первая игра', description: 'Закончите первую игру.', unlocked: completedGames.length > 0, current: Math.min(completedGames.length, 1), target: 1, image: publicAssetUrl('images/badges/first-game.webp') },
    { key: 'bullseye', title: 'Точно в цель', description: 'Выиграйте с первой попытки.', unlocked: bullseyeUnlocked, current: bullseyeUnlocked ? 1 : 0, target: 1, image: publicAssetUrl('images/badges/bullseye.webp') },
    { key: 'full-house', title: 'Полный зал', description: `Закончите все ${MODE_TABS.length} игр за день.`, unlocked: attendance.fullHouseDays > 0 || today.fullHouse, current: fullHouseProgress, target: MODE_TABS.length, image: publicAssetUrl('images/badges/full-house.webp') },
  ]
  const profileCategoryConfig = CATEGORY_TICKET_CONFIG
  const nextDailyCategory = profileCategoryConfig.find((category) => category.mode === activeSession?.mode)
    ?? profileCategoryConfig.find((category) => !today.completedModes.includes(category.mode))
    ?? profileCategoryConfig[0]
  const openDailyMode = (mode: TitleMode) => onSelectMode(mode)

  return <>
    <AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} profileActive />
    <main className="profile-screen profile-screen--new">
      <div className="screen-back-row"><ControlButton className="screen-back" onClick={onHome} aria-label="На главную"><ChevronLeft /></ControlButton><span>Профиль</span></div>

      <section className="profile-hero">
        <div className="profile-hero__identity">
          <div className="profile-avatar profile-avatar--large" aria-hidden="true">{loading ? <UserRound /> : initials || <UserRound />}</div>
          <div className="profile-hero__copy">
            <h1>{loading ? 'Загружаем профиль...' : displayName}</h1>
            <p className="profile-hero__email">{session && !session.isAnonymous ? <><Mail /> {session.email}</> : 'Ваш прогресс сохранён в текущем браузере.'}</p>
            <UserBadgeList badges={serverRuntime.me?.badges ?? []} />
            <div className="profile-hero__meta">
              <span>{profileStatus(completedGames.length)}</span>
              {supporterTopTier && <i className={`profile-cashier-badge profile-cashier-badge--${supporterTopTier}`}>
                <Heart aria-hidden="true" />
                Кассир поддержан {supporterTotal} {supporterTimes(supporterTotal)}
              </i>}
            </div>
          </div>
        </div>
        <ControlButton className="profile-hero__club" type="button" onClick={onClub}>
          <span className="profile-hero__club-mark" aria-hidden="true"><Crown /></span>
          <span className="profile-hero__club-copy">
            <small>Клуб «Сходится!»</small>
            <strong>{serverRuntime.dashboard?.membership.active
              ? serverRuntime.dashboard.membership.endsAt
                ? `Активен до ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(serverRuntime.dashboard.membership.endsAt))}`
                : 'Клубный билет активен'
              : 'Архив и свободная игра'}</strong>
          </span>
          <ChevronRight aria-hidden="true" />
        </ControlButton>
      </section>

      {session?.isAnonymous && <aside className="profile-guest-banner">
        <span><ShieldCheck /></span>
        <div><strong>Сохраните игровой прогресс</strong><p>Создайте аккаунт, чтобы не потерять серию, билеты и статистику при смене браузера или устройства.</p></div>
        <a className="profile-guest-banner__primary" href="/register">Создать аккаунт</a>
        <a className="profile-guest-banner__secondary" href="/login">Уже есть аккаунт</a>
      </aside>}

      <nav aria-label="Разделы личного кабинета">
        <Tabs surface="dark" className="profile-tabs" label="Разделы личного кабинета" items={PROFILE_TABS} value={activeTab} onChange={selectTab} />
      </nav>

      {activeTab === 'overview' && <>
        <section className="profile-overview profile-overview--dashboard" aria-label="Общая статистика">
          <article><i aria-hidden="true"><Film /></i><span>Сыграно</span><strong>{completedGames.length}</strong><small>игр завершено</small></article>
          <article><i aria-hidden="true"><Target /></i><span>Точность</span><strong>{completedGames.length ? `${winRate}%` : '—'}</strong><small>{completedGames.length ? `${wonGames.length} побед` : 'появится после игры'}</small></article>
          <article><i aria-hidden="true"><Trophy /></i><span>Серия</span><strong>{attendance.currentDailyStreak}<em> дн.</em></strong><small>лучший результат: {attendance.bestDailyStreak}</small></article>
          <article><i aria-hidden="true"><Ticket /></i><span>Билеты</span><strong>{wallet.tickets}</strong><small>доступно сейчас</small></article>
        </section>

        {session && !session.isAnonymous && <section className={`profile-cashier-support${supporterTotal ? ' is-supported' : ''}`} aria-label="Жетоны поддержки кассира">
          <div className="profile-cashier-support__seal" aria-hidden="true">
            <Heart />
            <strong>{supporterTotal}</strong>
            <span>жетонов</span>
          </div>
          <div className="profile-cashier-support__copy">
            <span>Личная коллекция</span>
            <h2>{supporterTotal
              ? `Вы поддержали кассира ${supporterTotal} ${supporterTimes(supporterTotal)}`
              : 'Первый жетон ждёт своего сеанса'}</h2>
            <p>Каждая покупка остаётся отдельным цифровым жетоном и навсегда пополняет этот счётчик.</p>
          </div>
          <div className="profile-cashier-support__tokens">
            {supporterTiers.map(({ scope, label, count, Icon }) => <div className={`profile-cashier-token profile-cashier-token--${scope}${count ? ' is-collected' : ''}`} key={scope}>
              <i aria-hidden="true"><Icon /></i>
              <span><small>{label}</small><strong>× {count}</strong></span>
            </div>)}
          </div>
          <TipCheckoutTrigger
            className="profile-cashier-support__action"
            placement="profile_support"
            label={supporterTotal ? 'Добавить жетон' : 'Подарить первый жетон'}
            hint="99 · 299 · 699 ₽"
          />
        </section>}

        <div className="profile-overview-layout">
          <section className="profile-section profile-route">
            <div className="profile-section__head"><div><span>Сегодня</span><h2>Ваш игровой маршрут</h2><p>Выберите любую категорию и начните первую серию</p></div><strong>{today.completedModes.length}/{MODE_TABS.length}</strong></div>
            <div className="profile-route__grid">{profileCategoryConfig.map((category) => {
              const isComplete = today.completedModes.includes(category.mode)
              const isActive = activeSession?.mode === category.mode
              const Icon = category.icon
              return <ControlButton className={`profile-route-card${isComplete ? ' is-complete' : ''}${isActive ? ' is-active' : ''}`} onClick={() => openDailyMode(category.mode)} key={category.mode} style={{ '--profile-card-color': category.color } as CSSProperties}>
                <span className="profile-route-card__visual"><img src={category.watermarkUrl} alt="" /><i><Icon /></i></span>
                <strong>{category.title}</strong>
                <em>{isComplete ? 'Сыграно' : isActive ? 'В игре' : 'Не сыграно'}</em>
                {isComplete ? <Check /> : <ChevronRight />}
              </ControlButton>
            })}</div>
            <ControlButton className="profile-route__cta" type="button" onClick={() => openDailyMode(nextDailyCategory.mode)}><Play /> {activeSession ? 'Продолжить игру' : 'Выбрать игру'}</ControlButton>
          </section>

          <div className="profile-overview-side">
            <section className="profile-section profile-week">
              <div className="profile-week__main">
                <div className="profile-section__head"><div><span>Серия</span><h2>Неделя в игре</h2></div></div>
                <div className="profile-week__days">{weeklyAttendance.map((day) => <div className={`${day.hasActivity ? 'is-active' : ''}${day.isFullHouse ? ' is-full-house' : ''}${day.isToday ? ' is-today' : ''}`} key={day.label}><span>{day.label}</span><i>{day.isFullHouse ? FULL_HOUSE_MODE_IDS.length : day.hasActivity ? '•' : ''}</i></div>)}</div>
              </div>
              <aside className="profile-week__streak"><Trophy /><strong>{attendance.currentDailyStreak}</strong><span>{formatDays(attendance.currentDailyStreak)} подряд</span><p>{attendance.currentDailyStreak ? 'Серия продолжается' : 'Сыграйте сегодня, чтобы начать серию'}</p></aside>
            </section>

            <section className="profile-section profile-rewards">
              <div className="profile-section__head"><div><span>Первые шаги</span><h2>Ближайшие награды</h2></div></div>
              <div className="profile-rewards__grid">{achievementCards.map((achievement) => <article className={achievement.unlocked ? 'is-unlocked' : ''} key={achievement.key}>
                <img src={achievement.image} alt="" />
                <div><strong>{achievement.title}</strong><b>{achievement.current}/{achievement.target}</b><i><span style={{ width: `${Math.min(100, Math.round(achievement.current / achievement.target * 100))}%` }} /></i></div>
                <small>{achievement.unlocked ? <Check /> : <Lock />}</small>
              </article>)}</div>
            </section>
          </div>
        </div>

        <section className="profile-section profile-history profile-history--new">
          <div className="profile-section__head"><div><span>Недавнее</span><h2>Последние сеансы</h2></div><ControlButton onClick={onArchive}>Весь архив <ChevronRight /></ControlButton></div>
          {recentGames.length ? <div className="profile-history__list">{recentGames.map((game) => <article key={game.key}><i>{modeIcon(game.mode)}</i><div><strong>{modeMeta(game.mode).title}</strong><small>{prettyDate(game.date)} · {game.attempts.length}/10 попыток</small></div><span className={game.status === 'won' ? 'is-won' : ''}>{game.status === 'won' ? 'Сошлось' : 'Не сошлось'}</span></article>)}</div> : <p className="profile-empty">Здесь появятся завершённые игры. Откройте первую карточку из афиши.</p>}
        </section>
      </>}

      {activeTab === 'stats' && <section className="profile-section profile-stats-tab">
        <div className="profile-section__head"><div><span>Статистика</span><h2>По категориям</h2></div><ControlButton onClick={onStats}>Подробный отчёт <BarChart3 /></ControlButton></div>
        <div className="profile-stats-grid">{CATEGORY_TICKET_CONFIG.map((category) => {
          const stats = (serverRuntime.dashboard?.stats ?? []).filter((entry) => entry.mode === category.mode)
          const played = stats.reduce((sum, entry) => sum + entry.played, 0)
          const won = stats.reduce((sum, entry) => sum + entry.won, 0)
          const Icon = category.icon
          return <article key={category.mode} style={{ '--profile-card-color': category.color } as CSSProperties}><span><Icon /></span><strong>{category.title}</strong><b>{played}</b><small>{won ? `побед: ${won}` : 'сеансов пока нет'}</small></article>
        })}</div>
      </section>}

      {activeTab === 'achievements' && <section className="profile-section profile-achievements-tab">
        <div className="profile-section__head"><div><span>Коллекция</span><h2>Достижения</h2></div><strong>{achievementCards.filter((achievement) => achievement.unlocked).length}/{achievementCards.length}</strong></div>
        <div className="profile-achievements-grid">{achievementCards.map((achievement) => <article className={achievement.unlocked ? 'is-unlocked' : ''} key={achievement.key}><span className="profile-achievement-placeholder__icon"><img src={achievement.image} alt="" /></span><div><strong>{achievement.title}</strong><p>{achievement.description}</p><small>{achievement.unlocked ? 'Открыто' : `Прогресс: ${achievement.current}/${achievement.target}`}</small></div></article>)}</div>
        <p className="profile-section__note">Новые достижения появятся здесь после завершённых игр.</p>
      </section>}

      {activeTab === 'settings' && <section className="profile-settings-grid">
        <section className="profile-section">
          <div className="profile-section__head"><div><span>Профиль</span><h2>Основные данные</h2></div><UserRound /></div>
          {session && !session.isAnonymous && SERVER_RUNTIME ? <form className="profile-settings-form" onSubmit={saveProfileName}><label>Имя игрока<TextInput surface="dark" value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={80} /></label><label>Email<TextInput surface="dark" value={session.email ?? ''} readOnly /></label><ActionButton type="submit">Сохранить имя</ActionButton>{profileNotice && <InlineAlert tone="success" className="account-access__notice">{profileNotice}</InlineAlert>}{profileError && <InlineAlert tone="danger" className="server-error">{profileError}</InlineAlert>}</form> : <p className="modal-lead">Настройки профиля станут доступны после создания аккаунта.</p>}
        </section>
        <section className="profile-section profile-auth" id="profile-account-access">
          <div className="profile-section__head"><div><span>Безопасность</span><h2>Вход и пароль</h2></div><Lock /></div>
          {SERVER_RUNTIME && session && !session.isAnonymous
            ? <AccountAccessPanel session={session} loadingSession={loading} refreshSession={refreshSession} />
            : SERVER_RUNTIME
              ? <div className="profile-settings-auth-prompt"><p>Вход и регистрация вынесены на отдельную защищённую страницу.</p><div><a href="/register">Создать аккаунт</a><a href="/login">Войти</a></div></div>
              : <p className="modal-lead">Эта сборка работает автономно, поэтому управление серверным аккаунтом недоступно.</p>}
        </section>
        <section className="profile-section profile-subscriptions">
          <div className="profile-section__head"><div><span>Платежи</span><h2>Автопродление клуба</h2></div><CreditCard /></div>
          {commerceProfile.isLoading
            ? <p className="modal-lead">Загружаем настройки платежей…</p>
            : commerceProfile.data?.subscriptions.length
              ? <div className="profile-subscription-list">{commerceProfile.data.subscriptions.map((subscription) => {
                const active = ['pending', 'active', 'past_due'].includes(subscription.status)
                const status = subscription.status === 'active'
                  ? 'Активно'
                  : subscription.status === 'pending'
                    ? 'Настраивается'
                    : subscription.status === 'past_due'
                      ? 'Ожидает повторного списания'
                      : subscription.status === 'canceled'
                        ? 'Отключено'
                        : subscription.status === 'rejected'
                          ? 'Остановлено после ошибок оплаты'
                          : 'Завершено'
                return <article key={subscription.id}>
                  <div><strong>{subscription.productId === 'club_365d' ? 'Годовой клуб' : 'Клуб на 30 дней'}</strong><small>{status}{subscription.nextPaymentAt ? ` · следующее списание ${prettyDate(subscription.nextPaymentAt.slice(0, 10))}` : ''}</small></div>
                  {active && <ActionButton
                    type="button"
                    disabled={cancelSubscription.isPending}
                    onClick={() => {
                      if (confirm('Отключить автопродление? Уже оплаченный доступ сохранится до конца срока.')) cancelSubscription.mutate(subscription.id)
                    }}
                  >Отключить</ActionButton>}
                </article>
              })}</div>
              : <p className="modal-lead">Автопродление не подключено. Его можно включить при покупке клубного доступа.</p>}
          {subscriptionNotice && <InlineAlert tone="success">{subscriptionNotice}</InlineAlert>}
          {subscriptionError && <InlineAlert tone="danger">{subscriptionError}</InlineAlert>}
        </section>
      </section>}
    </main>
  </>
}
