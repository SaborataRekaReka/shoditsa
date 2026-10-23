import { publicAssetUrl } from '../../app/public-asset'
import './study-profile-art.css'
import { SectionIconArtwork } from './SectionIconArtwork'

export const studyProfileAsset = (name: 'account-avatar-v1' | 'profile-card-v1' | 'profile-journal-v1' | 'guest-welcome-v1' | 'settings-v1' | 'support-v1') => publicAssetUrl(`images/shoditsa-study/profile-v1/${name}.png`)

export function StudySupportIcon({ size = 24 }: { size?: number }) {
  return <img className="study-support-icon" src={studyProfileAsset('support-v1')} width={size} height={size} alt="" />
}

export function StudySettingsIcon({ size = 24 }: { size?: number }) {
  return <img className="study-settings-icon" src={studyProfileAsset('settings-v1')} width={size} height={size} alt="" />
}

/** The navigation card, account avatar and profile scene have different roles. */
export function StudyProfileIcon({ size = 36 }: { size?: number }) {
  return <svg className="quest-glyph study-profile-icon" data-glyph="profile" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><SectionIconArtwork name="profile" /></svg>
}

export function StudyProfileIllustration() {
  return <img className="study-profile-illustration" src={studyProfileAsset('profile-journal-v1')} width="168" height="112" alt="" />
}
