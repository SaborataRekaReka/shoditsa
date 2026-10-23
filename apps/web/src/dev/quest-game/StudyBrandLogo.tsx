import { publicAssetUrl } from '../../app/public-asset'
import './study-brand.css'

/** The user-supplied SVG is embedded as an image, with its original artwork. */
export function StudyBrandLogo({ compact = false }: { compact?: boolean }) {
  return <img className={`study-brand-logo${compact ? ' study-brand-logo--compact' : ''}`} src={publicAssetUrl(compact ? 'images/logo_m_2_colored.svg' : 'images/logo.svg')} width={compact ? 44 : 170} height={compact ? 35 : 47} alt="" fetchPriority="high" />
}
