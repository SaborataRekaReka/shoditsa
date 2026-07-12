export const getMoscowDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date)

export const previousDate = (date: string) => {
  const value = new Date(`${date}T12:00:00+03:00`)
  value.setUTCDate(value.getUTCDate() - 1)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
}
