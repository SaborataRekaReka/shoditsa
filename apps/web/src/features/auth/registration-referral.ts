export const REGISTRATION_REFERRALS = {
  dtf: {
    key: 'dtf',
    label: 'DTF',
    title: 'Приглашение от DTF',
    description: 'После регистрации круглый бейдж DTF появится в вашем профиле.',
  },
} as const

export type RegistrationReferral = keyof typeof REGISTRATION_REFERRALS

export const registrationReferralFromSearch = (search: string): RegistrationReferral | null => {
  const value = new URLSearchParams(search).get('ref')?.trim().toLocaleLowerCase('en-US')
  return value && value in REGISTRATION_REFERRALS ? value as RegistrationReferral : null
}
