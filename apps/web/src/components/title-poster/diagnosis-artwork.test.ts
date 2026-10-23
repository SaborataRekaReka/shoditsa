import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { diagnosisArtworkUrl } from './diagnosis-artwork'
import files from './diagnosis-artwork.json'
import { TitlePoster } from './TitlePoster'
import { GameResult } from '../../features/result/GameResult'
import type { TitleItem } from '../../types'

const diagnosis: TitleItem = {
  id: 'dx_migraine', mode: 'diagnosis', titleRu: 'Мигрень',
  titleOriginal: 'Migraine', alternativeTitles: [], bodySystems: ['нервная система'],
  popularityScore: 1,
}

describe('published diagnosis illustrations', () => {
  it.each([true, false])('shows a new diagnosis mascot in the completed result when won=%s', won => {
    const item = { ...diagnosis, id: 'dx_hiatal_hernia', titleRu: 'Грыжа пищеводного отверстия диафрагмы' }
    const html = renderToStaticMarkup(createElement(GameResult, {
      mode: 'diagnosis', won, attempts: 3, poster: createElement(TitlePoster, { item }),
      title: item.titleRu, meta: '', tags: [], award: null, copied: false,
      nextLabel: 'Играть дальше', nextActionLabel: 'Играть', configureLabel: 'Настроить',
      onNext: () => {}, onConfigure: () => {}, accountState: 'authenticated', autoScroll: false,
    }))
    expect(html).toContain(diagnosisArtworkUrl(item))
    expect(html).toContain('diagnosis-artwork')
  })
  it('ships one real local asset for each of the 320 diagnoses', () => {
    expect(Object.keys(files)).toHaveLength(320)
    expect(new Set(Object.values(files)).size).toBe(320)
    for (const file of Object.values(files)) {
      expect(file).toMatch(/^dx_[a-z0-9_]+\.[a-f0-9]{12}\.webp$/)
      expect(existsSync(resolve('public/images/diagnoses/mascot-v1', file))).toBe(true)
    }
  })
  it('does not request a missing image for an expanded-catalog diagnosis or another game', () => {
    expect(diagnosisArtworkUrl({ ...diagnosis, id: 'dx_new_diagnosis' })).toBeNull()
    expect(diagnosisArtworkUrl({ ...diagnosis, mode: 'movie' })).toBeNull()
    const html = renderToStaticMarkup(createElement(TitlePoster, { item: { ...diagnosis, id: 'dx_new_diagnosis' } }))
    expect(html).toContain('poster-fallback--diagnosis')
    expect(html).toContain('diagnosis-systems/nervous.svg')
    expect(html).not.toContain('/images/diagnoses/mascot-v1/')
  })
  it('renders the selected illustration with a descriptive alternative and preserves caller classes', () => {
    const html = renderToStaticMarkup(createElement(TitlePoster, { item: diagnosis, className: 'rewatch-poster__media' }))
    expect(html).toContain(diagnosisArtworkUrl(diagnosis))
    expect(html).toContain('rewatch-poster__media diagnosis-artwork')
    expect(html).toContain('Мигрень')
    expect(html).not.toContain('poster-fallback--diagnosis')
  })
})
