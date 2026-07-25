import { publicAssetUrl } from '../../app/public-asset'

const normalizeText = (value: string) => value
  .normalize('NFKD')
  .toLocaleLowerCase('ru-RU')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()

export const normalizeDiagnosisSystemKey = (value: string) => normalizeText(value)

export const diagnosisSystemIconByKey = new Map<string, string>([
  ['дыхательная система', publicAssetUrl('images/diagnosis-systems/respiratory.svg')],
  ['пищеварительная система', publicAssetUrl('images/diagnosis-systems/digestive.svg')],
  ['психика и поведение', publicAssetUrl('images/diagnosis-systems/mental.svg')],
  ['зубы и полость рта', publicAssetUrl('images/diagnosis-systems/dental.svg')],
  ['мочевыделительная система', publicAssetUrl('images/diagnosis-systems/urinary.svg')],
  ['нервная система', publicAssetUrl('images/diagnosis-systems/nervous.svg')],
  ['органы зрения', publicAssetUrl('images/diagnosis-systems/vision.svg')],
  ['органы слуха', publicAssetUrl('images/diagnosis-systems/hearing.svg')],
  ['кожа и подкожная клетчатка', publicAssetUrl('images/diagnosis-systems/skin.svg')],
  ['костно мышечная система', publicAssetUrl('images/diagnosis-systems/musculoskeletal.svg')],
  ['кровь и иммунная система', publicAssetUrl('images/diagnosis-systems/blood-immune.svg')],
  ['репродуктивная система', publicAssetUrl('images/diagnosis-systems/reproductive.svg')],
  ['сердечно сосудистая система', publicAssetUrl('images/diagnosis-systems/cardiovascular.svg')],
  ['эндокринная система', publicAssetUrl('images/diagnosis-systems/endocrine.svg')],
])

export const defaultDiagnosisSystemIcon = publicAssetUrl('images/diagnosis-systems/nervous.svg')
