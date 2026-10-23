import files from './diagnosis-artwork.json'
import { publicAssetUrl } from '../../app/public-asset'
import type { TitleItem } from '../../types'

const illustrations: Readonly<Record<string, string>> = files

/** Only published artwork is requested; newly added diagnoses keep their system icon. */
export function diagnosisArtworkUrl(item: Pick<TitleItem, 'id' | 'mode'>) {
  const file = item.mode === 'diagnosis' ? illustrations[item.id] : undefined
  return file ? publicAssetUrl('images/diagnoses/mascot-v1/' + file) : null
}
