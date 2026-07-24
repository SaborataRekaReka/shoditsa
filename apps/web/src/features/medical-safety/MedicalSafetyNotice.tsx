export const MEDICAL_SAFETY_NOTICE = 'Это развлекательная игра, не инструмент самодиагностики и не замена консультации врача. При симптомах обратитесь к медицинскому специалисту.'

export function MedicalSafetyNotice({ compact = false }: { compact?: boolean }) {
  return <p className={`medical-safety-notice${compact ? ' medical-safety-notice--compact' : ''}`} role="note">
    {MEDICAL_SAFETY_NOTICE}
  </p>
}
