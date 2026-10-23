import { PageHeading } from '../../components/ui/PageHeading'
import { useEffect, useState, type FormEvent } from 'react'
import { StudyRightSidebar } from './StudyRightSidebar'
import { useQueryClient } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { useAuthSession } from '../../features/auth/use-auth-session'
import { AccountAccessPanel } from '../../features/profile/AccountAccessPanel'
import { api, queryKeys } from '../../api/client'
import { studyAccountHref, studyPasswordRecoveryHref, STUDY_CLUB_OFFER_HREF } from './account-routing'
import { StudyThemeToggle } from './StudyTheme'
import './study-settings.css'
import { SERVER_RUNTIME } from '../../hooks/use-server-runtime'

type SettingsSection = 'preferences' | 'profile' | 'password'
const sections = [
  { id: 'preferences', label: 'Оформление' },
  { id: 'profile', label: 'Профиль' },
  { id: 'password', label: 'Пароль и вход' },
] as const

function GuestAccountSettings({ section }: { section: SettingsSection }) {
  return section === 'password' ? <section className="study-settings-group">
    <h2>Смена пароля</h2>
    <p>Войди в аккаунт, чтобы изменить пароль. Если не помнишь его, восстанови доступ по почте.</p>
    <div className="study-settings-actions"><a className="quest-button quest-button--outline" href={studyPasswordRecoveryHref()}>Восстановить доступ</a><a className="quest-button quest-button--text" href={studyAccountHref('login')}>Войти в аккаунт</a></div>
  </section> : <>
    <section className="study-settings-group"><h2>Данные профиля</h2>
      <dl className="study-settings-fields"><div><dt>Имя</dt><dd>Гость</dd></div><div><dt>Почта</dt><dd className="study-settings-empty">Не указана</dd></div></dl>
    </section>
    <section className="study-settings-group"><h2>Сохрани свой прогресс</h2><p>Войди, чтобы менять данные профиля и продолжать игры на любом устройстве.</p>
      <div className="study-settings-actions"><a className="quest-button quest-button--primary" href={studyAccountHref('login')}>Войти в аккаунт</a><a className="quest-button quest-button--text" href={studyAccountHref('register')}>Создать аккаунт</a></div>
    </section>
  </>
}

function ConnectedAccountSettings({ section }: { section: SettingsSection }) {
  const { session, loading, refresh } = useAuthSession()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => { setName(session?.name ?? '') }, [session?.name])
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setNotice('')
    try {
      await api.updateProfile({ displayName: name.trim() || null })
      await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.me }), refresh()])
      setNotice('Имя сохранено.')
    } catch { setNotice('Не удалось сохранить имя. Попробуй ещё раз.') }
    finally { setSaving(false) }
  }
  if (loading) return <p role="status">Загружаем аккаунт…</p>
  if (!session || session.isAnonymous) return <GuestAccountSettings section={section} />
  return section === 'password' ? <section className="study-settings-group"><h2>Безопасность аккаунта</h2><AccountAccessPanel session={session} loadingSession={loading} refreshSession={refresh} /></section> : <section className="study-settings-group"><h2>Данные профиля</h2>
    <form className="study-settings-profile-form" onSubmit={save}><label>Имя<input value={name} onChange={event => setName(event.target.value)} maxLength={80} autoComplete="nickname" /></label><p>{session.email || 'Почта не указана'}</p><QuestButton type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить'}</QuestButton>{notice && <p role="status">{notice}</p>}</form>
  </section>
}

/** A full settings page: content on the left, section navigation on the right. */
export function StudySettings({ onReset }: { onReset?: () => void }) {
  const [section, setSection] = useState<SettingsSection>('profile')
  const connected = SERVER_RUNTIME
  return <>
    <main className="qg-main study-settings" id="quest-main">
      <PageHeading title="Настройки" description={sections.find(item => item.id === section)!.label} />
      {section === 'preferences' ? <>
        <section className="study-settings-group"><h2>Оформление</h2><div className="study-settings-row"><span>Тёмная тема</span><StudyThemeToggle /></div><p className="study-settings-caption">Выбранная тема сохраняется на всех страницах.</p></section>
        {onReset && <section className="study-settings-group"><h2>Текущая игра</h2><div className="study-settings-actions"><QuestButton kind="outline" onClick={onReset}><RotateCcw size={19} />Начать заново</QuestButton></div></section>}
      </> : connected ? <ConnectedAccountSettings section={section} /> : <GuestAccountSettings section={section} />}
    </main>
    <StudyRightSidebar className="study-settings-aside" label="Разделы настроек">
      <nav className="study-settings-nav" aria-label="Настройки аккаунта"><h2>Аккаунт</h2><div>{sections.map(item => <QuestButton key={item.id} kind="settings-nav" selected={section === item.id} aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}>{item.label}</QuestButton>)}</div></nav>
      <section className="study-settings-club"><h2>Клуб</h2><a href={STUDY_CLUB_OFFER_HREF}>Выбрать клубный билет</a></section>
      <nav className="study-settings-support" aria-label="Помощь и документы"><h2>Помощь</h2><a href="/legal/privacy">Конфиденциальность</a><a href="/legal/terms">Условия использования</a></nav>
    </StudyRightSidebar>
  </>
}
