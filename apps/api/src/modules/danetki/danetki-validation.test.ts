import { describe, expect, it } from 'vitest'
import { normalizeDanetkiGuessFeedback } from './ai.js'
import { isDanetkiYesNoQuestion } from './service.js'

describe('Danetki player input', () => {
  it('accepts yes/no questions and rejects open questions', () => {
    expect(isDanetkiYesNoQuestion('Это произошло ночью?')).toBe(true)
    expect(isDanetkiYesNoQuestion('Был ли герой один?')).toBe(true)
    expect(isDanetkiYesNoQuestion('Почему это произошло?')).toBe(false)
    expect(isDanetkiYesNoQuestion('Расскажите разгадку')).toBe(false)
  })

  it('removes internal evaluation vocabulary from final-guess feedback', () => {
    const feedback = normalizeDanetkiGuessFeedback('Matched 2 key facts, coverage 0.4; missing fact_id_3')

    expect(feedback).toContain('причинно-следственную цепочку')
    expect(feedback).not.toMatch(/matched|coverage|fact[_\s-]?id|ключев\w*\s+факт/i)
  })
})
