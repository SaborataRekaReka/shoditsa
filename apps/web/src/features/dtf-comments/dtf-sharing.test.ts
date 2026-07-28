import { describe, expect, it } from 'vitest'
import { dtfShareText } from './dtf-sharing'

describe('dtfShareText', () => {
  it('describes a DTF special without unrelated daily mode metadata', () => {
    const text = dtfShareText(3, 6, true)

    expect(text).toContain('Сходится! · Спецпоказ DTF')
    expect(text).toContain('🎮 3/6')
    expect(text).toContain('⬛⬛🟩')
    expect(text).not.toContain('Все годы')
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})
