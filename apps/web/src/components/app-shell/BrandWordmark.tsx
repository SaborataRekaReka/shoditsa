import { publicAssetUrl } from '../../app/public-asset'
import wordmarkSvg from '../../../../../public/images/logo.svg?raw'
import './BrandWordmark.css'

export function BrandWordmark({ variant = 'header', className = '', inline = false, effect = 'none' }: {
  variant?: 'header' | 'footer' | 'compact'
  className?: string
  inline?: boolean
  effect?: 'none' | 'iridescent'
}) {
  const mask = `url("${publicAssetUrl('images/logo.svg')}")`
  return <span className={`brand-wordmark brand-wordmark--${variant}${effect === 'iridescent' ? ' brand-wordmark--iridescent' : ''} ${className}`.trim()}>{effect === 'iridescent'
    ? <span className="brand-wordmark__gradient" role="img" aria-label="Сходится!" style={{ maskImage: mask, WebkitMaskImage: mask }} />
    : inline
    ? <span className="brand-wordmark__image" role="img" aria-label="Сходится!" dangerouslySetInnerHTML={{ __html: wordmarkSvg }} />
    : <img className="brand-wordmark__image" src={publicAssetUrl('images/logo.svg')} width="1450" height="287" alt="Сходится!" />}</span>
}
