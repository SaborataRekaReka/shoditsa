import { useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react'
import { Moon, Sun } from 'lucide-react'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { applyStudyTheme, getStudyTheme, setStudyTheme, subscribeStudyTheme } from './study-theme'
import './study-theme.css'

const light = () => 'light' as const
const noSubscription = () => () => {}

export function useStudyTheme(enabled = true) {
  const theme = useSyncExternalStore(enabled ? subscribeStudyTheme : noSubscription, enabled ? getStudyTheme : light, light)
  useLayoutEffect(() => { if (enabled) applyStudyTheme(theme) }, [enabled, theme])
  return [theme, setStudyTheme] as const
}

export function StudyThemeToggle({ menuItem = false }: { menuItem?: boolean }) {
  const [theme, setTheme] = useStudyTheme()
  const dark = theme === 'dark'
  return <QuestButton kind="theme" role={menuItem ? 'menuitemcheckbox' : 'switch'} aria-label="Тёмная тема" aria-checked={dark} title={dark ? 'Включить светлую тему' : 'Включить тёмную тему'} onClick={() => setTheme(dark ? 'light' : 'dark')}>
    <span className="quest-theme-track" aria-hidden="true"><span className="quest-theme-thumb" /><Sun size={15} /><Moon size={15} /></span>
  </QuestButton>
}

export function StudyFooter({ children }: { children?: ReactNode }) {
  return <footer className="qg-footer study-footer" aria-label="Информация о сайте">{children ?? <><a href="/">Игры</a><a href="/club">Клуб</a><a href="/blog">Блог</a><a href="/support">Помощь</a><a href="/legal/terms">Оферта</a><a href="/legal/privacy">Конфиденциальность</a></>}<StudyCookieSettings /><div className="study-footer-theme"><StudyThemeToggle /></div></footer>
}

export function StudyCookieSettings() {
  return <QuestButton kind="footer" onClick={() => window.dispatchEvent(new Event('shoditsa:cookie-settings'))}>Настройки cookie</QuestButton>
}
