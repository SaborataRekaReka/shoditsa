export type ProfileTab = 'overview' | 'stats' | 'achievements' | 'settings'

export const PROFILE_TABS: Array<{ id: ProfileTab; label: string }> = [
  { id: 'overview', label: 'Обзор' },
  { id: 'stats', label: 'Статистика' },
  { id: 'achievements', label: 'Достижения' },
  { id: 'settings', label: 'Настройки' },
]
