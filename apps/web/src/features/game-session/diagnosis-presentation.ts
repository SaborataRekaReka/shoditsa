import { publicAssetUrl } from '../../app/public-asset'
import systemIllustrations from './diagnosis-system-illustrations.json'

const systemArtwork = (key: keyof typeof systemIllustrations) => publicAssetUrl(`images/diagnosis-systems/illustrated-v1/${systemIllustrations[key]}`)

const normalizeText = (value: string) => value
  .normalize('NFKD')
  .toLocaleLowerCase('ru-RU')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()

export const normalizeDiagnosisSystemKey = (value: string) => normalizeText(value)

export const diagnosisSystemIconByKey = new Map<string, string>([
  ['дыхательная система', systemArtwork('respiratory')],
  ['пищеварительная система', systemArtwork('digestive')],
  ['психика и поведение', systemArtwork('mental')],
  ['зубы и полость рта', systemArtwork('dental')],
  ['мочевыделительная система', systemArtwork('urinary')],
  ['нервная система', systemArtwork('nervous')],
  ['органы зрения', systemArtwork('vision')],
  ['органы слуха', systemArtwork('hearing')],
  ['кожа и подкожная клетчатка', systemArtwork('skin')],
  ['костно мышечная система', systemArtwork('musculoskeletal')],
  ['кровь и иммунная система', systemArtwork('blood-immune')],
  ['репродуктивная система', systemArtwork('reproductive')],
  ['сердечно сосудистая система', systemArtwork('cardiovascular')],
  ['эндокринная система', systemArtwork('endocrine')],
  ['глаза', systemArtwork('vision')],
  ['зрительная система', systemArtwork('vision')],
  ['слуховая система', systemArtwork('hearing')],
  ['внутреннее ухо', systemArtwork('hearing')],
  ['кожа', systemArtwork('skin')],
  ['подкожная клетчатка', systemArtwork('skin')],
  ['ногти', systemArtwork('skin')],
  ['опорно двигательная система', systemArtwork('musculoskeletal')],
  ['иммунная система', systemArtwork('blood-immune')],
  ['кроветворная система', systemArtwork('blood-immune')],
  ['лимфатическая система', systemArtwork('blood-immune')],
  ['психическое здоровье', systemArtwork('mental')],
  ['почки', systemArtwork('urinary')],
  ['зубочелюстная система', systemArtwork('dental')],
  ['вегетативная нервная система', systemArtwork('nervous')],
])

export const defaultDiagnosisSystemIcon = systemArtwork('general')
