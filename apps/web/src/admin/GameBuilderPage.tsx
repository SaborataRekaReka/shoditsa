import { useMemo, useRef, useState, type DragEvent } from 'react'
import type { ContentMode } from '@shoditsa/contracts'
import {
  ArrowLeft, ArrowRight, BadgeCheck, Braces, Check, ChevronDown, ChevronRight, CircleAlert, Clapperboard, CloudUpload, Download, Eye, FileJson,
  GripVertical, Image as ImageIcon, Layers3, LayoutTemplate, LoaderCircle, Play, Plus, RefreshCw, Save, Search, Sparkles, Ticket, Trash2, Upload, X,
} from 'lucide-react'
import { adminApi, type ContentExchangePreview } from './api'
import {
  analyseUnknownJson, autoMapFields, createExchangeDocument, displayValue, ensureUniqueItemIds, inferContentMode, mapRecordToItem,
  readDetectedValue, readPayloadValue, targetsForMode, type AnalysedJson, type DetectedField, type FieldMapping, type JsonRecord, type TargetDefinition,
} from './game-builder-model'
import './game-builder.css'

type NoticeTone = 'success' | 'error' | 'info'
type CustomSlot = { key: string; payloadKey: string; label: string }
type StoredTemplate = {
  id: string
  schemaKey: string
  mode: ContentMode
  mapping: FieldMapping
  customSlots: CustomSlot[]
  visibility: Record<string, boolean>
  savedAt: string
}

const TEMPLATE_STORAGE = 'shoditsa:admin:game-builder-templates:v1'
const MODE_OPTIONS: Array<{ value: ContentMode; label: string }> = [
  { value: 'movie', label: 'Кино' }, { value: 'series', label: 'Сериалы' }, { value: 'anime', label: 'Аниме' },
  { value: 'game', label: 'Игры' }, { value: 'music', label: 'Музыка' }, { value: 'diagnosis', label: 'Диагнозы' }, { value: 'city', label: 'Города' },
]
const MODE_LABEL = Object.fromEntries(MODE_OPTIONS.map((option) => [option.value, option.label])) as Record<ContentMode, string>
const KIND_LABEL: Record<DetectedField['kind'], string> = { text: 'текст', number: 'число', boolean: 'да/нет', list: 'список', 'object-list': 'объекты', object: 'объект', mixed: 'разные', empty: 'пусто' }
const STATUS_LABEL: Record<string, string> = { create: 'Новая', update: 'Обновление', unchanged: 'Без изменений', conflict: 'Конфликт', invalid: 'Ошибка' }

const sampleJson = {
  catalog: {
    movies: [
      { slug: 'arrival-2016', title_ru: 'Прибытие', original_title: 'Arrival', year: 2016, age_rating: '16+', genres: ['фантастика', 'драма'], country: 'США', duration: 116, kp: 7.5, imdb: 7.9, director: 'Дени Вильнёв', actors: ['Эми Адамс', 'Джереми Реннер', 'Форест Уитакер'], poster: 'https://images.kinorium.com/movie/1080/566896.jpg', backdrop: 'https://images.kinorium.com/movie/background/566896.jpg', hint: 'Лингвист пытается понять язык гостей, для которых время устроено иначе.', facts: ['Основано на рассказе Теда Чана', 'Музыку написал Йоханн Йоханнссон'] },
      { slug: 'blade-runner-2049', title_ru: 'Бегущий по лезвию 2049', original_title: 'Blade Runner 2049', year: 2017, age_rating: '18+', genres: ['фантастика', 'неонуар'], country: ['США', 'Канада'], duration: 164, kp: 7.8, imdb: 8.0, director: 'Дени Вильнёв', actors: ['Райан Гослинг', 'Харрисон Форд'], hint: 'Открытие репликанта-полицейского может изменить хрупкий порядок будущего.', facts: ['Продолжение фильма 1982 года'] },
      { slug: 'dune-part-two', title_ru: 'Дюна: Часть вторая', original_title: 'Dune: Part Two', year: 2024, age_rating: '16+', genres: ['фантастика', 'приключения'], country: 'США', duration: 166, kp: 8.2, imdb: 8.5, director: 'Дени Вильнёв', actors: ['Тимоти Шаламе', 'Зендея'], hint: 'Наследник великого дома принимает культуру пустыни и ведёт борьбу за её будущее.', facts: ['Съёмки проходили в Иордании и Абу-Даби'] },
    ],
  },
}

const readTemplates = (): StoredTemplate[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(TEMPLATE_STORAGE) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

const compactSample = (value: unknown) => {
  const text = displayValue(value, 'пусто')
  return text.length > 88 ? `${text.slice(0, 85)}…` : text
}

const customTarget = (slot: CustomSlot): TargetDefinition => ({
  key: slot.key, payloadKey: slot.payloadKey, label: slot.label, hint: 'Пользовательское поле карточки', group: 'extra', valueType: 'unknown', aliases: [], visual: true,
})

const templateLayout = (targets: TargetDefinition[], mapping: FieldMapping, visibility: Record<string, boolean>) => ({
  version: 1,
  title: ['headerUrl', 'posterUrl', 'titleRu', 'titleOriginal'].filter((key) => mapping[key] && visibility[key] !== false),
  attempt: targets.filter((target) => target.visual && mapping[target.key] && visibility[target.key] !== false).map((target) => ({ field: target.payloadKey, label: target.label, region: target.group })),
})

function DropSlot({ target, mapping, fieldById, record, visibility, onDropField, onClear, onToggle }: {
  target: TargetDefinition
  mapping: FieldMapping
  fieldById: Map<string, DetectedField>
  record: JsonRecord | undefined
  visibility: Record<string, boolean>
  onDropField: (targetKey: string, fieldId: string) => void
  onClear: (targetKey: string) => void
  onToggle: (targetKey: string) => void
}) {
  const source = fieldById.get(mapping[target.key] ?? '')
  const value = record && source ? readDetectedValue(record, source) : undefined
  const drop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); const fieldId = event.dataTransfer.getData('application/x-shoditsa-json-field') || event.dataTransfer.getData('text/plain'); if (fieldId) onDropField(target.key, fieldId) }
  return <div className={`game-builder-map-slot ${source ? 'is-mapped' : ''} ${visibility[target.key] === false ? 'is-hidden' : ''} ${!target.visual ? 'is-data-only' : ''}`} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDrop={drop}>
    {target.visual ? <button className="game-builder-map-slot__visibility" onClick={() => onToggle(target.key)} aria-label={visibility[target.key] === false ? `Показывать ${target.label}` : `Скрыть ${target.label}`} title={visibility[target.key] === false ? 'Показывать в карточке' : 'Скрыть в карточке'}><Eye /></button> : <span className="game-builder-map-slot__data" title="Сохраняется в данные, но не показывается в кино-макете"><Braces /></span>}
    <div><span>{target.label}{target.required && <b>обязательно</b>}</span><strong>{source?.label ?? 'Перетащите поле сюда'}</strong><small>{source ? compactSample(value) : target.hint}</small></div>
    {source ? <button className="game-builder-map-slot__clear" onClick={() => onClear(target.key)} aria-label={`Убрать ${target.label}`}><X /></button> : <GripVertical />}
  </div>
}

const recordValue = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
const listValue = (value: unknown) => Array.isArray(value) ? value : value == null || value === '' ? [] : [value]
const previewPerson = (value: unknown) => {
  const person = recordValue(value)
  const name = displayValue(person.nameRu ?? person.name ?? person.title ?? value, 'Нет данных')
  return { name, photoUrl: typeof (person.photoUrl ?? person.image ?? person.avatar) === 'string' ? String(person.photoUrl ?? person.image ?? person.avatar) : '' }
}
const ratingText = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : displayValue(value, '—')

function MoviePeopleGroup({ targetKey, label, value, mapped, onDropField }: { targetKey: string; label: string; value: unknown; mapped: boolean; onDropField: (targetKey: string, fieldId: string) => void }) {
  const people = listValue(value).map(previewPerson).slice(0, targetKey === 'cast' ? 6 : 3)
  const drop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); const fieldId = event.dataTransfer.getData('application/x-shoditsa-json-field') || event.dataTransfer.getData('text/plain'); if (fieldId) onDropField(targetKey, fieldId) }
  return <div className={`people-group unknown people-${targetKey === 'directors' ? 'creator' : 'cast'} game-builder-native-drop ${mapped ? 'is-mapped' : ''}`} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDrop={drop} title={`Перетащите поле: ${label}`}>
    <div className="people-group__head"><span>{label}</span></div>
    <div className="people-row">{people.length ? people.map((person, index) => {
      const initials = person.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('ru-RU')
      return <div className="hint-person" key={`${person.name}-${index}`}><div className="hint-person__portrait">{person.photoUrl ? <img src={person.photoUrl} alt={person.name} /> : <span>{initials || '—'}</span>}</div><strong>{person.name}</strong></div>
    }) : <span className="people-empty">Перетащите поле</span>}</div>
  </div>
}

function MovieClueTile({ targetKey, label, value, mapped, onDropField }: { targetKey: string; label: string; value: unknown; mapped: boolean; onDropField: (targetKey: string, fieldId: string) => void }) {
  const drop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); const fieldId = event.dataTransfer.getData('application/x-shoditsa-json-field') || event.dataTransfer.getData('text/plain'); if (fieldId) onDropField(targetKey, fieldId) }
  return <div className={`clue-tile unknown clue-${targetKey === 'ratingKinopoisk' ? 'kp' : targetKey === 'ratingImdb' ? 'imdb' : targetKey} game-builder-native-drop ${mapped ? 'is-mapped' : ''}`} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDrop={drop} title={`Перетащите поле: ${label}`}><div className="clue-tile__top"><span>{label}</span></div><strong>{displayValue(value)}</strong></div>
}

export function GameBuilderPage({ notify, onNavigateContent }: { notify: (tone: NoticeTone, text: string) => void; onNavigateContent: () => void }) {
  const jsonInput = useRef<HTMLInputElement>(null)
  const [dataset, setDataset] = useState<AnalysedJson | null>(null)
  const [fileName, setFileName] = useState('')
  const [mode, setMode] = useState<ContentMode>('movie')
  const [mapping, setMapping] = useState<FieldMapping>({})
  const [customSlots, setCustomSlots] = useState<CustomSlot[]>([])
  const [visibility, setVisibility] = useState<Record<string, boolean>>({})
  const [recordIndex, setRecordIndex] = useState(0)
  const [scene, setScene] = useState<'title' | 'attempt'>('attempt')
  const [fieldSearch, setFieldSearch] = useState('')
  const [draggedField, setDraggedField] = useState<string | null>(null)
  const [mediaOverrides, setMediaOverrides] = useState<Record<number, JsonRecord>>({})
  const [uploading, setUploading] = useState<string | null>(null)
  const [preview, setPreview] = useState<ContentExchangePreview | null>(null)
  const [previewDocument, setPreviewDocument] = useState<Record<string, unknown> | null>(null)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)

  const baseTargets = useMemo(() => targetsForMode(mode), [mode])
  const targets = useMemo(() => [...baseTargets, ...customSlots.map(customTarget)], [baseTargets, customSlots])
  const fieldById = useMemo(() => new Map((dataset?.fields ?? []).map((field) => [field.id, field])), [dataset])
  const mappedItems = useMemo(() => {
    if (!dataset) return []
    const layout = templateLayout(targets, mapping, visibility)
    return ensureUniqueItemIds(dataset.records.map((record, index) => {
      const mapped = mapRecordToItem({ record, index, fields: dataset.fields, targets, mapping, mode, overrides: mediaOverrides[index] })
      return { ...mapped, data: { ...mapped.data, cardLayout: layout } }
    }))
  }, [dataset, mapping, mediaOverrides, mode, targets, visibility])
  const currentRecord = dataset?.records[recordIndex]
  const currentItem = mappedItems[recordIndex]
  const currentData = currentItem?.data ?? {}
  const mappedCount = targets.filter((target) => mapping[target.key]).length
  const requiredMissing = targets.filter((target) => target.required && target.payloadKey !== 'id' && !mapping[target.key])
  const canCheck = Boolean(dataset?.records.length && !requiredMissing.length)
  const usedFields = new Set(Object.values(mapping).filter(Boolean))
  const filteredFields = (dataset?.fields ?? []).filter((field) => !fieldSearch.trim() || `${field.label} ${KIND_LABEL[field.kind]}`.toLocaleLowerCase('ru-RU').includes(fieldSearch.trim().toLocaleLowerCase('ru-RU')))

  const invalidateServerPreview = () => { setPreview(null); setPreviewDocument(null) }
  const setTargetMapping = (targetKey: string, fieldId: string | null) => { setMapping((current) => ({ ...current, [targetKey]: fieldId })); invalidateServerPreview() }

  const applyAnalysed = (analysed: AnalysedJson, name: string) => {
    const inferredMode = inferContentMode(analysed.fields)
    const stored = readTemplates().filter((template) => template.schemaKey === analysed.schemaKey).sort((left, right) => right.savedAt.localeCompare(left.savedAt))[0]
    const nextMode = stored?.mode ?? inferredMode
    const nextTargets = targetsForMode(nextMode)
    setDataset(analysed); setFileName(name); setMode(nextMode); setRecordIndex(0); setMediaOverrides({}); setPreview(null); setPreviewDocument(null)
    setCustomSlots(stored?.customSlots ?? [])
    setVisibility(stored?.visibility ?? {})
    setMapping(stored?.mapping ?? autoMapFields(analysed.fields, nextTargets))
    notify('success', `${analysed.records.length.toLocaleString('ru-RU')} карточек · распознано ${analysed.fields.length} полей${stored ? ' · шаблон восстановлен' : ''}`)
  }

  const loadJsonValue = (value: unknown, name: string) => {
    try { applyAnalysed(analyseUnknownJson(value), name) } catch (error) { notify('error', error instanceof Error ? error.message : 'Не удалось распознать JSON') }
  }

  const loadFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 16 * 1024 * 1024) { notify('error', 'JSON-файл должен быть меньше 16 МБ'); return }
    try { loadJsonValue(JSON.parse(await file.text()), file.name) } catch { notify('error', 'Файл не является корректным JSON') }
  }

  const changeMode = (nextMode: ContentMode) => {
    setMode(nextMode)
    if (dataset) {
      const automatic = autoMapFields(dataset.fields, targetsForMode(nextMode))
      setMapping((current) => ({ ...automatic, ...Object.fromEntries(Object.entries(current).filter(([key, value]) => value && targetsForMode(nextMode).some((target) => target.key === key))) }))
    }
    invalidateServerPreview()
  }

  const resetMapping = () => {
    if (!dataset) return
    setCustomSlots([]); setVisibility({}); setMapping(autoMapFields(dataset.fields, baseTargets)); invalidateServerPreview(); notify('info', 'Автомаппинг рассчитан заново')
  }

  const addCustomSlot = (field?: DetectedField) => {
    let suffix = customSlots.length + 1
    while (customSlots.some((slot) => slot.payloadKey === `customField${suffix}`)) suffix += 1
    const slot = { key: `custom_${crypto.randomUUID()}`, payloadKey: `customField${suffix}`, label: field?.path.at(-1) || `Новое поле ${suffix}` }
    setCustomSlots((current) => [...current, slot]); setVisibility((current) => ({ ...current, [slot.key]: true }))
    if (field) setMapping((current) => ({ ...current, [slot.key]: field.id }))
    invalidateServerPreview()
  }

  const assignField = (field: DetectedField) => {
    const freeTargets = targets.filter((target) => !mapping[target.key])
    const automatic = autoMapFields([field], freeTargets)
    const target = freeTargets.find((entry) => automatic[entry.key] === field.id)
    if (target) setTargetMapping(target.key, field.id)
    else addCustomSlot(field)
  }

  const saveTemplate = () => {
    if (!dataset) return
    const templates = readTemplates().filter((template) => template.schemaKey !== dataset.schemaKey)
    templates.unshift({ id: crypto.randomUUID(), schemaKey: dataset.schemaKey, mode, mapping, customSlots, visibility, savedAt: new Date().toISOString() })
    localStorage.setItem(TEMPLATE_STORAGE, JSON.stringify(templates.slice(0, 10)))
    notify('success', 'Шаблон маппинга сохранён для JSON с такой структурой')
  }

  const exportTemplate = () => {
    if (!dataset) return
    const blob = new Blob([JSON.stringify({ format: 'shoditsa-game-builder-template', version: 1, schemaKey: dataset.schemaKey, mode, mapping, customSlots, visibility }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${fileName.replace(/\.json$/i, '') || 'game'}-mapping.json`; anchor.click(); URL.revokeObjectURL(url)
  }

  const uploadIllustration = async (targetKey: 'posterUrl' | 'headerUrl', file: File | undefined) => {
    if (!file || !dataset) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { notify('error', 'Для иллюстрации подходят JPEG, PNG и WebP'); return }
    if (file.size > 5 * 1024 * 1024) { notify('error', 'Иллюстрация должна быть меньше 5 МБ'); return }
    setUploading(targetKey)
    try {
      const uploaded = await adminApi.uploadBuilderMedia(file, targetKey)
      setMediaOverrides((current) => ({ ...current, [recordIndex]: { ...(current[recordIndex] ?? {}), [targetKey]: uploaded.url } }))
      invalidateServerPreview(); notify('success', targetKey === 'posterUrl' ? 'Постер загружен для этой карточки' : 'Титульный фон загружен для этой карточки')
    } catch (error) { notify('error', error instanceof Error ? error.message : 'Не удалось загрузить изображение') } finally { setUploading(null) }
  }

  const checkImport = async () => {
    if (!canCheck) return
    setChecking(true)
    try {
      const document = createExchangeDocument(mappedItems)
      const result = await adminApi.previewContentExchangeImport(document)
      setPreviewDocument(document); setPreview(result)
      const blocked = result.summary.invalid + result.summary.conflict
      notify(blocked ? 'info' : 'success', blocked ? `Проверка завершена · требуют внимания: ${blocked}` : `Все ${result.summary.total} карточек прошли проверку`)
    } catch (error) { notify('error', error instanceof Error ? error.message : 'Не удалось проверить импорт') } finally { setChecking(false) }
  }

  const applyImport = async () => {
    if (!preview || !previewDocument) return
    const actionable = preview.items.filter((item) => item.status === 'create' || item.status === 'update')
    if (!actionable.length) return
    setApplying(true)
    try {
      const result = await adminApi.applyContentExchangeImport({ document: previewDocument, previewHash: preview.previewHash, items: actionable.map(({ id, mode: itemMode }) => ({ id, mode: itemMode })), reason: 'Импорт через конструктор JSON', confirmation: true })
      notify(result.summary.failed ? 'info' : 'success', `В рабочую версию добавлено: ${result.summary.staged}${result.summary.failed ? ` · ошибок: ${result.summary.failed}` : ''}`)
      setPreview(null); setPreviewDocument(null)
    } catch (error) { notify('error', error instanceof Error ? error.message : 'Не удалось применить импорт') } finally { setApplying(false) }
  }

  const renderMediaUpload = (targetKey: 'posterUrl' | 'headerUrl', compact = false) => <label className={`game-builder-media-upload ${compact ? 'is-compact' : ''}`} title="Загрузить свою иллюстрацию">
    {uploading === targetKey ? <LoaderCircle /> : <Upload />}<span>{compact ? 'Загрузить' : targetKey === 'posterUrl' ? 'Свой постер' : 'Свой титульный фон'}</span>
    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { void uploadIllustration(targetKey, event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
  </label>

  if (!dataset) return <>
    <div className="game-builder-page-head"><div><span>Игровой контент</span><h1>Конструктор игры</h1><p>Загрузите JSON любой структуры. Поля распознаются и автоматически подставятся в знакомые ячейки карточки.</p></div></div>
    <section className="game-builder-empty" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void loadFile(event.dataTransfer.files[0]) }}>
      <div className="game-builder-empty__icon"><FileJson /></div><span>ШАГ 1</span><h2>Перетащите JSON сюда</h2><p>Подойдёт массив объектов или ответ API с карточками на любой глубине. Файл обрабатывается только в админ-панели.</p>
      <button className="admin-btn admin-btn--primary" onClick={() => jsonInput.current?.click()}><CloudUpload />Выбрать JSON</button>
      <button className="admin-btn admin-btn--secondary" onClick={() => loadJsonValue(sampleJson, 'movie-catalog-example.json')}><Sparkles />Открыть пример</button>
      <input ref={jsonInput} type="file" accept="application/json,.json" onChange={(event) => { void loadFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
      <footer><span><Check />Автопоиск массива</span><span><Check />Вложенные поля</span><span><Check />До 5 000 карточек</span></footer>
    </section>
  </>

  const poster = typeof currentData.posterUrl === 'string' ? currentData.posterUrl : ''
  const title = displayValue(currentData.titleRu, 'Название карточки')
  const originalTitle = displayValue(currentData.titleOriginal, 'Оригинальное название')
  const year = currentData.year
  const ageRating = currentData.ageRating
  const genres = listValue(currentData.genres).map((entry) => displayValue(entry)).filter(Boolean).slice(0, 4)
  const country = currentData.countries
  const runtime = readPayloadValue(currentData, 'runtimeMinutes')
  const kinopoiskRating = readPayloadValue(currentData, 'ratings.kinopoisk')
  const imdbRating = readPayloadValue(currentData, 'ratings.imdb')
  const directors = currentData.directors
  const cast = currentData.cast
  const today = new Date()
  const prettyToday = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(today)
  const gameSubject: Record<ContentMode, string> = { movie: 'фильм', series: 'сериал', anime: 'аниме', game: 'игру', music: 'артиста', diagnosis: 'диагноз', city: 'город' }
  const nativeDrop = (targetKey: string) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' },
    onDrop: (event: DragEvent<HTMLElement>) => { event.preventDefault(); const fieldId = event.dataTransfer.getData('application/x-shoditsa-json-field') || event.dataTransfer.getData('text/plain'); if (fieldId) setTargetMapping(targetKey, fieldId) },
    title: `Перетащите поле в ячейку «${targets.find((target) => target.key === targetKey)?.label ?? targetKey}»`,
  })

  return <>
    <div className="game-builder-page-head game-builder-page-head--loaded"><div><span>Игровой контент</span><h1>Конструктор игры</h1><p><FileJson />{fileName} <b>{dataset.records.length.toLocaleString('ru-RU')} карточек</b> <b>{dataset.fields.length} полей</b></p></div><div className="game-builder-head-actions"><button className="admin-btn admin-btn--secondary" onClick={saveTemplate}><Save />Сохранить шаблон</button><button className="admin-btn admin-btn--secondary" onClick={exportTemplate}><Download />Экспорт схемы</button><button className="admin-btn admin-btn--primary" onClick={() => void checkImport()} disabled={!canCheck || checking}>{checking ? <LoaderCircle /> : <BadgeCheck />}{checking ? 'Проверяем…' : 'Проверить импорт'}</button></div></div>
    <div className="game-builder-steps"><span className="is-done"><Check />JSON загружен</span><i /><span className={mappedCount ? 'is-done' : 'is-active'}><Layers3 />Поля сопоставлены</span><i /><span className="is-active"><LayoutTemplate />Карточка</span><i /><span className={preview ? 'is-done' : ''}><BadgeCheck />Проверка</span></div>
    <div className="game-builder-toolbar">
      <button className="game-builder-file" onClick={() => jsonInput.current?.click()}><RefreshCw />Заменить JSON</button><input ref={jsonInput} type="file" accept="application/json,.json" onChange={(event) => { void loadFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
      <label><span>Категория игры</span><select value={mode} onChange={(event) => changeMode(event.target.value as ContentMode)}>{MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown /></label>
      <button onClick={resetMapping}><Sparkles />Автомаппинг заново</button><span className="game-builder-toolbar__status"><i />{mappedCount} из {targets.length} ячеек заполнено</span>
    </div>
    <div className="game-builder-workspace">
      <aside className="game-builder-fields">
        <header><div><span>Источник</span><h2>Поля JSON</h2></div><b>{dataset.fields.length}</b></header>
        <label className="game-builder-fields__search"><Search /><input value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} placeholder="Найти поле…" />{fieldSearch && <button onClick={() => setFieldSearch('')}><X /></button>}</label>
        <div className="game-builder-fields__list">{filteredFields.map((field) => <button key={field.id} className={`${usedFields.has(field.id) ? 'is-used' : ''} ${draggedField === field.id ? 'is-dragging' : ''}`} draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-shoditsa-json-field', field.id); event.dataTransfer.setData('text/plain', field.id); event.dataTransfer.effectAllowed = 'copy'; setDraggedField(field.id) }} onDragEnd={() => setDraggedField(null)} onClick={() => assignField(field)}>
          <GripVertical /><span><strong>{field.label}</strong><small>{compactSample(field.sampleValues[0])}</small></span><i>{KIND_LABEL[field.kind]}</i><em>{Math.round(field.coverage * 100)}%</em>{usedFields.has(field.id) && <Check />}
        </button>)}</div>
        <footer><p><Sparkles />Совпавшие названия уже расставлены. Перетаскивайте остальные или нажмите на поле.</p></footer>
      </aside>

      <section className="game-builder-canvas">
        <header><div className="game-builder-scene-switch"><button className={scene === 'title' ? 'is-active' : ''} onClick={() => setScene('title')}>Титульник</button><button className={scene === 'attempt' ? 'is-active' : ''} onClick={() => setScene('attempt')}>Карточка попытки</button></div><div className="game-builder-record-nav"><button disabled={recordIndex === 0} onClick={() => setRecordIndex((value) => Math.max(0, value - 1))}><ArrowLeft /></button><span><strong>{recordIndex + 1}</strong> / {dataset.records.length}</span><button disabled={recordIndex === dataset.records.length - 1} onClick={() => setRecordIndex((value) => Math.min(dataset.records.length - 1, value + 1))}><ArrowRight /></button></div></header>
        <div className={`game-builder-stage is-${scene}`}>
          {scene === 'title' ? <section className="title-stage game-builder-film-title">
            <div className="title-game-mark"><span><Clapperboard /></span><i>Игра дня · №{String(today.getDate()).padStart(2, '0')}</i><h1>{MODE_LABEL[mode]}</h1></div>
            <time>{prettyToday} · {today.getFullYear()}</time><p>Угадайте {gameSubject[mode]} дня за десять попыток</p>
            <section className="admit-ticket">
              <div className="admit-ticket__stub"><span>ВХОД</span><strong>ОДИН</strong><small>№ {String(today.getDate()).padStart(2, '0')}</small><em>{String(today.getDate()).padStart(2, '0')}.{String(today.getMonth() + 1).padStart(2, '0')}</em><i /></div>
              <div className="admit-ticket__body"><div className="ticket-kicker"><span>Ежедневная премьера</span><i /><small>полночный сеанс</small></div><h1>Ежедневная игра: {MODE_LABEL[mode].toLocaleLowerCase('ru-RU')}</h1><p>Каждый день доступна новая загадка. У вас есть <strong>10 попыток</strong>, а каждый ответ открывает сравнительные подсказки.</p><div className="ticket-settings"><div className="period-select-wrap"><button type="button" className="period-control period-control--custom"><span className="period-control__top"><span>Период</span><strong><Ticket /> 3</strong></span><span className="period-control__value"><span>За всё время</span><ChevronRight /></span></button><p className="period-control__note">Период открыт. Можно начинать сеанс.</p></div></div></div>
            </section>
            <button type="button" className="ui-button ui-button--primary play-button"><Play />Начать игру <span className="keycap-hint keycap-hint--inline">Enter</span></button>
          </section> : <article className={`attempt-card attempt-card--screen game-builder-film-attempt ${visibility.posterUrl === false ? 'is-poster-hidden' : ''}`}>
            <div className="attempt-card__header">
              <span className="attempt-card__number">01</span>
              {visibility.posterUrl !== false && (poster ? <img className={`game-builder-native-drop ${mapping.posterUrl ? 'is-mapped' : ''}`} src={poster} alt="" {...nativeDrop('posterUrl')} /> : <div className={`poster-fallback game-builder-native-drop ${mapping.posterUrl ? 'is-mapped' : ''}`} {...nativeDrop('posterUrl')}><ImageIcon /><span>Нет постера</span></div>)}
              <div className="attempt-card__identity">
                <span className="attempt-label">Попытка 1</span>
                {visibility.titleRu !== false && <h2 className={`game-builder-native-drop ${mapping.titleRu ? 'is-mapped' : ''}`} {...nativeDrop('titleRu')}>{title}</h2>}
                <p className="gm-head__sub">{visibility.titleOriginal !== false && <span className={`gm-head__orig game-builder-native-drop ${mapping.titleOriginal ? 'is-mapped' : ''}`} {...nativeDrop('titleOriginal')}>{originalTitle}</span>}{visibility.year !== false && <><i className="gm-head__dot" aria-hidden="true">·</i><span className={`gm-year game-builder-native-drop ${mapping.year ? 'is-mapped' : ''}`} {...nativeDrop('year')}>{displayValue(year, 'Год')}</span></>}{visibility.ageRating !== false && <><i className="gm-head__dot" aria-hidden="true">·</i><span className={`gm-year gm-year--age game-builder-native-drop ${mapping.ageRating ? 'is-mapped' : ''}`} {...nativeDrop('ageRating')}>{displayValue(ageRating, 'Возраст')}</span></>}</p>
                {visibility.genres !== false && <div className={`gm-genres game-builder-native-drop ${mapping.genres ? 'is-mapped' : ''}`} {...nativeDrop('genres')}>{genres.length ? genres.map((genre) => <span className="gm-genre" key={genre}>{genre}</span>) : <span className="gm-genre">Жанры</span>}</div>}
              </div>
              {visibility.ratingKinopoisk !== false && <div className={`rating-badge game-builder-native-drop ${mapping.ratingKinopoisk ? 'is-mapped' : ''}`} {...nativeDrop('ratingKinopoisk')}><small>КП</small><strong>{ratingText(kinopoiskRating)}</strong></div>}
            </div>
            <div className="dx-score dx-score--miss" aria-label="Совпадений: 0"><span>Совпадений</span><div className="dx-score__bar">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</div><strong>0</strong></div>
            <div className="attempt-clue-grid">
              {visibility.countries !== false && <MovieClueTile targetKey="countries" label="Страна" value={country} mapped={Boolean(mapping.countries)} onDropField={setTargetMapping} />}
              {visibility.runtime !== false && <MovieClueTile targetKey="runtime" label="Хронометраж" value={runtime == null ? null : `${displayValue(runtime)} мин`} mapped={Boolean(mapping.runtime)} onDropField={setTargetMapping} />}
              {visibility.ratingKinopoisk !== false && <MovieClueTile targetKey="ratingKinopoisk" label="Кинопоиск" value={ratingText(kinopoiskRating)} mapped={Boolean(mapping.ratingKinopoisk)} onDropField={setTargetMapping} />}
              {visibility.ratingImdb !== false && <MovieClueTile targetKey="ratingImdb" label="IMDb" value={ratingText(imdbRating)} mapped={Boolean(mapping.ratingImdb)} onDropField={setTargetMapping} />}
              {visibility.directors !== false && <MoviePeopleGroup targetKey="directors" label="Режиссёр" value={directors} mapped={Boolean(mapping.directors)} onDropField={setTargetMapping} />}
              {visibility.cast !== false && <MoviePeopleGroup targetKey="cast" label="В ролях" value={cast} mapped={Boolean(mapping.cast)} onDropField={setTargetMapping} />}
              {customSlots.filter((slot) => visibility[slot.key] !== false && mapping[slot.key]).map((slot) => <MovieClueTile key={slot.key} targetKey={slot.key} label={slot.label} value={currentData[slot.payloadKey]} mapped onDropField={setTargetMapping} />)}
            </div>
          </article>}
        </div>
        <footer><span><Eye />Используется оригинальный кино-макет из игры · <code>{currentItem?.id}</code></span><div>{renderMediaUpload('posterUrl')}</div></footer>
      </section>

      <aside className="game-builder-mapping">
        <header><div><span>Схема карточки</span><h2>Ячейки</h2></div><b>{mappedCount}</b></header>
        <div className="game-builder-mapping__scroll">
          {(['identity', 'title', 'media', 'attempt'] as const).map((group) => {
            const groupTargets = targets.filter((target) => target.group === group)
            if (!groupTargets.length) return null
            const labels = { identity: 'Служебные поля', title: 'Титульник', media: 'Изображения', attempt: 'Карточка попытки' }
            return <section key={group}><h3>{labels[group]}<span>{groupTargets.filter((target) => mapping[target.key]).length}/{groupTargets.length}</span></h3>{groupTargets.map((target) => <DropSlot key={target.key} target={target} mapping={mapping} fieldById={fieldById} record={currentRecord} visibility={visibility} onDropField={setTargetMapping} onClear={(key) => setTargetMapping(key, null)} onToggle={(key) => { setVisibility((current) => ({ ...current, [key]: current[key] === false })); invalidateServerPreview() }} />)}</section>
          })}
          <section><h3>Свои поля<span>{customSlots.length}</span></h3>{customSlots.map((slot) => <div className="game-builder-custom-slot" key={slot.key}><input value={slot.label} aria-label="Название своего поля" onChange={(event) => { const label = event.target.value; setCustomSlots((current) => current.map((entry) => entry.key === slot.key ? { ...entry, label } : entry)); invalidateServerPreview() }} /><DropSlot target={customTarget(slot)} mapping={mapping} fieldById={fieldById} record={currentRecord} visibility={visibility} onDropField={setTargetMapping} onClear={(key) => setTargetMapping(key, null)} onToggle={(key) => { setVisibility((current) => ({ ...current, [key]: current[key] === false })); invalidateServerPreview() }} /><button onClick={() => { setCustomSlots((current) => current.filter((entry) => entry.key !== slot.key)); setMapping((current) => { const next = { ...current }; delete next[slot.key]; return next }); invalidateServerPreview() }}><Trash2 />Удалить</button></div>)}<button className="game-builder-add-field" onClick={() => addCustomSlot()}><Plus />Добавить визуальное поле</button></section>
        </div>
      </aside>
    </div>

    {requiredMissing.length > 0 && <div className="game-builder-validation-hint"><CircleAlert /><div><strong>Нужно сопоставить обязательные поля</strong><p>{requiredMissing.map((target) => target.label).join(', ')}. ID можно не указывать — он будет создан из названия.</p></div></div>}

    {preview && <section className="game-builder-import-preview">
      <header><div><span>Серверная проверка</span><h2>Импорт готов</h2><p>Новые и изменённые карточки попадут в рабочую версию. Публикация останется отдельным действием.</p></div><button onClick={() => { setPreview(null); setPreviewDocument(null) }}><X /></button></header>
      <div className="game-builder-import-stats"><article><strong>{preview.summary.total}</strong><span>всего</span></article><article className="is-create"><strong>{preview.summary.create}</strong><span>новых</span></article><article><strong>{preview.summary.update}</strong><span>обновлений</span></article><article><strong>{preview.summary.unchanged}</strong><span>без изменений</span></article><article className={preview.summary.invalid + preview.summary.conflict ? 'is-danger' : ''}><strong>{preview.summary.invalid + preview.summary.conflict}</strong><span>требуют внимания</span></article></div>
      <div className="game-builder-import-list">{preview.items.slice(0, 80).map((item) => <article key={`${item.mode}:${item.id}`}><span className={`is-${item.status}`}>{item.status === 'create' || item.status === 'update' ? <Check /> : item.status === 'invalid' || item.status === 'conflict' ? <CircleAlert /> : <BadgeCheck />}</span><div><strong>{item.title}</strong><small>{item.id} · {MODE_LABEL[item.mode]}{item.changedFields.length ? ` · ${item.changedFields.join(', ')}` : ''}</small>{item.message && <p>{item.message}</p>}</div><b className={`is-${item.status}`}>{STATUS_LABEL[item.status]}</b></article>)}</div>
      {preview.items.length > 80 && <p className="game-builder-import-more">Показаны первые 80 из {preview.items.length} карточек.</p>}
      <footer><button className="admin-btn admin-btn--secondary" onClick={() => { setPreview(null); setPreviewDocument(null) }}>Вернуться к схеме</button><button className="admin-btn admin-btn--secondary" onClick={onNavigateContent}><Braces />Открыть каталог</button><button className="admin-btn admin-btn--primary" disabled={applying || preview.summary.create + preview.summary.update === 0} onClick={() => void applyImport()}>{applying ? <LoaderCircle /> : <CloudUpload />}{applying ? 'Добавляем…' : `Добавить ${preview.summary.create + preview.summary.update} в рабочую версию`}</button></footer>
    </section>}
  </>
}
