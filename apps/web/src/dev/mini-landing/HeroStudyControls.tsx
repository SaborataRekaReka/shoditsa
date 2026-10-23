import './hero-study.css'

export const HERO_FONTS = [
  { id: 'inter', code: 'F1', name: 'Inter' },
  { id: 'manrope', code: 'F2', name: 'Manrope' },
  { id: 'golos', code: 'F3', name: 'Golos Text' },
] as const

export const HERO_INFO_LAYOUTS = [
  { id: 'inline', code: 'L1', name: 'Под описанием' },
  { id: 'below', code: 'L2', name: 'Под кнопками' },
  { id: 'split', code: 'L3', name: 'По смыслу' },
] as const

export type HeroFont = typeof HERO_FONTS[number]['id']
export type HeroInfoLayout = typeof HERO_INFO_LAYOUTS[number]['id']

export function HeroStudyControls({ font, info, onFontChange, onInfoChange }: {
  font: HeroFont
  info: HeroInfoLayout
  onFontChange: (font: HeroFont) => void
  onInfoChange: (info: HeroInfoLayout) => void
}) {
  const fontOption = HERO_FONTS.find(option => option.id === font)!
  const infoOption = HERO_INFO_LAYOUTS.find(option => option.id === info)!
  return <aside className="hero-study-controls" aria-label="Сравнение вариантов хиро">
    <div className="hero-study-controls__heading"><h2>Шрифт и сведения об игре</h2><output aria-live="polite">{fontOption.code} + {infoOption.code}</output><a href="/mini-landing.html?preview=reference&layout=sections">Исходный вариант ↗</a></div>
    <fieldset><legend>Шрифт описания</legend><div className="hero-study-controls__options">{HERO_FONTS.map(option => <button key={option.id} type="button" aria-pressed={font === option.id} data-font-sample={option.id} onClick={() => onFontChange(option.id)}><span>{option.code}</span>{option.name}</button>)}</div></fieldset>
    <fieldset><legend>Сведения об игре</legend><div className="hero-study-controls__options">{HERO_INFO_LAYOUTS.map(option => <button key={option.id} type="button" aria-pressed={info === option.id} onClick={() => onInfoChange(option.id)}><span>{option.code}</span>{option.name}</button>)}</div></fieldset>
  </aside>
}
