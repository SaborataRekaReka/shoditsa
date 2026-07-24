import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MEDICAL_SAFETY_NOTICE, MedicalSafetyNotice } from './MedicalSafetyNotice'

describe('MedicalSafetyNotice', () => {
  it('keeps the complete safety message visible and accessible', () => {
    const html = renderToStaticMarkup(createElement(MedicalSafetyNotice))

    expect(html).toContain('role="note"')
    expect(html).toContain(MEDICAL_SAFETY_NOTICE)
    expect(MEDICAL_SAFETY_NOTICE).toContain('не инструмент самодиагностики')
    expect(MEDICAL_SAFETY_NOTICE).toContain('обратитесь к медицинскому специалисту')
  })
})
