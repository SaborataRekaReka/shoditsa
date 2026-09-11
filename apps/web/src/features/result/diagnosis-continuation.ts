import type { ArchiveCalendarResponse } from '@shoditsa/contracts'

export const diagnosisArchiveRange = (today: string, freeDays: number) => ({
  from: new Date(Date.parse(`${today}T12:00:00Z`) - (Math.max(1, freeDays) - 1) * 86_400_000).toISOString().slice(0, 10),
  to: today,
})

/** Never reuse a started case or offer a club-only date as a free continuation. */
export const nextFreeDiagnosisDate = (calendar: ArchiveCalendarResponse | undefined, sourceDate: string) => (
  calendar?.items
    .filter((item) => item.available && item.access === 'free' && !item.session && item.date !== sourceDate)
    .map((item) => item.date)
    .sort((left, right) => right.localeCompare(left))[0] ?? null
)
