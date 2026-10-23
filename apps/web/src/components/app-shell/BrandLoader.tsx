import symbolSvg from '../../../../../public/images/symbol.svg?raw'
import { BrandWordmark } from './BrandWordmark'
import './BrandLoader.css'

/** One branded loading scene for route fallbacks, navigation and the component library. */
export function BrandLoader({ inline = false }: { inline?: boolean }) {
  return <div className={`brand-loader${inline ? ' brand-loader--inline' : ''}`} role="status" aria-label="Загружаем страницу">
    <div className="brand-loader__content" aria-hidden="true">
      <div className="brand-loader__scene">
        <span className="brand-loader__glow" />
        <span className="brand-loader__card brand-loader__card--mint" />
        <span className="brand-loader__card brand-loader__card--lilac" />
        <span className="brand-loader__symbol" dangerouslySetInnerHTML={{ __html: symbolSvg }} />
      </div>
      <BrandWordmark variant="compact" inline />
      <p className="brand-loader__caption">Сейчас всё сойдётся</p>
      <span className="brand-loader__dots"><i /><i /><i /></span>
    </div>
  </div>
}
