import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { ContentMode } from '@shoditsa/contracts'
import {
  ArrowLeft, ArrowRight, BadgeCheck, Braces, Check, ChevronDown, CircleAlert, CloudUpload, Download, Eye, FileJson,
  GripVertical, Image as ImageIcon, Layers3, LayoutTemplate, LoaderCircle, Plus, RefreshCw, Save, Search, Sparkles, Trash2, Upload, X,
} from 'lucide-react'
import { adminApi, type ContentExchangePreview } from './api'
import {
  analyseUnknownJson, autoMapFields, createExchangeDocument, displayValue, ensureUniqueItemIds, inferContentMode, mapRecordToItem,
  readDetectedValue, targetsForMode, type AnalysedJson, type DetectedField, type FieldMapping, type JsonRecord, type TargetDefinition,
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
  { value: 'game', label: 'Игры' }, { value: 'music', label: 'Музыка' }, { value: 'diagnosis', label: 'Диагнозы' },
]
const MODE_LABEL = Object.fromEntries(MODE_OPTIONS.map((option) => [option.value, option.label])) as Record<ContentMode, string>
const KIND_LABEL: Record<DetectedField['kind'], string> = { text: 'текст', number: 'число', boolean: 'да/нет', list: 'список', 'object-list': 'объекты', object: 'объект', mixed: 'разные', empty: 'пусто' }
const STATUS_LABEL: Record<string, string> = { create: 'Новая', update: 'Обновление', unchanged: 'Без изменений', conflict: 'Конфликт', invalid: 'Ошибка' }

const sampleJson = {
  catalog: {
    movies: [
      { slug: 'arrival-2016', title_ru: 'Прибытие', original_title: 'Arrival', year: 2016, genres: ['фантастика', 'драма'], director: 'Дени Вильнёв', poster: 'https://images.kinorium.com/movie/1080/566896.jpg', backdrop: 'https://images.kinorium.com/movie/background/566896.jpg', hint: 'Лингвист пытается понять язык гостей, для которых время устроено иначе.', facts: ['Основано на рассказе Теда Чана', 'Музыку написал Йоханн Йоханнссон'] },
      { slug: 'blade-runner-2049', title_ru: 'Бегущий по лезвию 2049', original_title: 'Blade Runner 2049', year: 2017, genres: ['фантастика', 'неонуар'], director: 'Дени Вильнёв', hint: 'Открытие репликанта-полицейского может изменить хрупкий порядок будущего.', facts: ['Продолжение фильма 1982 года'] },
      { slug: 'dune-part-two', title_ru: 'Дюна: Часть вторая', original_title: 'Dune: Part Two', year: 2024, genres: ['фантастика', 'приключения'], director: 'Дени Вильнёв', hint: 'Наследник великого дома принимает культуру пустыни и ведёт борьбу за её будущее.', facts: ['Съёмки проходили в Иордании и Абу-Даби'] },
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
  return <div className={`game-builder-map-slot ${source ? 'is-mapped' : ''} ${visibility[target.key] === false ? 'is-hidden' : ''}`} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDrop={drop}>
    <button className="game-builder-map-slot__visibility" onClick={() => onToggle(target.key)} aria-label={visibility[target.key] === false ? `Показывать ${target.label}` : `Скрыть ${target.label}`} title={visibility[target.key] === false ? 'Показывать в карточке' : 'Скрыть в карточке'}><Eye /></button>
    <div><span>{target.label}{target.required && <b>обязательно</b>}</span><strong>{source?.label ?? 'Перетащите поле сюда'}</strong><small>{source ? compactSample(value) : target.hint}</small></div>
    {source ? <button className="game-builder-map-slot__clear" onClick={() => onClear(target.key)} aria-label={`Убрать ${target.label}`}><X /></button> : <GripVertical />}
  </div>
}

function PreviewDrop({ targetKey, mapped, children, className = '', onDropField }: { targetKey: string; mapped: boolean; children: ReactNode; className?: string; onDropField: (targetKey: string, fieldId: string) => void }) {
  const drop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); const fieldId = event.dataTransfer.getData('application/x-shoditsa-json-field') || event.dataTransfer.getData('text/plain'); if (fieldId) onDropField(targetKey, fieldId) }
  return <div className={`game-builder-preview-drop ${mapped ? 'is-mapped' : ''} ${className}`} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDrop={drop}>{children}</div>
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
  const header = typeof currentData.headerUrl === 'string' ? currentData.headerUrl : ''
  const title = displayValue(currentData.titleRu, 'Название карточки')
  const originalTitle = displayValue(currentData.titleOriginal, 'Оригинальное название')
  const hint = displayValue(currentData.plotHint, 'Перетащите сюда подсказку или описание')
  const facts = Array.isArray(currentData.facts) ? currentData.facts.slice(0, 3) : []
  const metaTargets = targets.filter((target) => target.group === 'attempt' && !['plotHint', 'facts'].includes(target.payloadKey) && visibility[target.key] !== false && (mapping[target.key] || ['year', 'genres'].includes(target.key))).slice(0, 6)

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
          {scene === 'title' ? <article className="game-builder-title-card" style={header ? { backgroundImage: `linear-gradient(90deg, rgba(9,10,8,.94), rgba(9,10,8,.28)), url(${JSON.stringify(header).slice(1, -1)})` } : undefined}>
            <PreviewDrop targetKey="headerUrl" mapped={Boolean(mapping.headerUrl || header)} className="game-builder-title-card__backdrop" onDropField={setTargetMapping}><span><ImageIcon />{header ? 'Титульный фон' : 'Перетащите широкий фон'}</span>{renderMediaUpload('headerUrl', true)}</PreviewDrop>
            <div className="game-builder-title-card__content"><span>{MODE_LABEL[mode]} · КАРТОЧКА {recordIndex + 1}</span><PreviewDrop targetKey="titleRu" mapped={Boolean(mapping.titleRu)} onDropField={setTargetMapping}><h2>{title}</h2></PreviewDrop><PreviewDrop targetKey="titleOriginal" mapped={Boolean(mapping.titleOriginal)} onDropField={setTargetMapping}><p>{originalTitle}</p></PreviewDrop><div className="game-builder-title-card__meta">{displayValue(currentData.year, 'Год')}<i />{displayValue(currentData.genres, 'Жанр')}</div></div>
            <PreviewDrop targetKey="posterUrl" mapped={Boolean(mapping.posterUrl || poster)} className="game-builder-title-card__poster" onDropField={setTargetMapping}>{poster ? <img src={poster} alt="" /> : <ImageIcon />}{renderMediaUpload('posterUrl', true)}</PreviewDrop>
          </article> : <article className="game-builder-attempt-card">
            <header><div><span>ПОПЫТКА</span><strong>01 / 10</strong></div><i>{MODE_LABEL[mode]}</i></header>
            <PreviewDrop targetKey="posterUrl" mapped={Boolean(mapping.posterUrl || poster)} className="game-builder-attempt-card__media" onDropField={setTargetMapping}>{poster ? <img src={poster} alt="" /> : <><ImageIcon /><span>Иллюстрация карточки</span></>}{renderMediaUpload('posterUrl', true)}</PreviewDrop>
            <PreviewDrop targetKey="plotHint" mapped={Boolean(mapping.plotHint)} className="game-builder-attempt-card__hint" onDropField={setTargetMapping}><small>ОСНОВНАЯ ПОДСКАЗКА</small><h3>{hint}</h3></PreviewDrop>
            <div className="game-builder-attempt-card__meta">{metaTargets.map((target) => <PreviewDrop key={target.key} targetKey={target.key} mapped={Boolean(mapping[target.key])} onDropField={setTargetMapping}><small>{target.label}</small><strong>{displayValue(currentData[target.payloadKey])}</strong></PreviewDrop>)}</div>
            {(mapping.facts || facts.length) && visibility.facts !== false && <PreviewDrop targetKey="facts" mapped={Boolean(mapping.facts)} className="game-builder-attempt-card__facts" onDropField={setTargetMapping}><small>ДОПОЛНИТЕЛЬНО</small>{facts.length ? facts.map((fact, index) => <p key={index}>{displayValue(fact)}</p>) : <p>Перетащите список фактов</p>}</PreviewDrop>}
            {customSlots.filter((slot) => visibility[slot.key] !== false && mapping[slot.key]).map((slot) => <PreviewDrop key={slot.key} targetKey={slot.key} mapped onDropField={setTargetMapping} className="game-builder-attempt-card__custom"><small>{slot.label}</small><strong>{displayValue(currentData[slot.payloadKey])}</strong></PreviewDrop>)}
            <div className="game-builder-attempt-card__answer"><Search /><span>Введите вариант ответа</span><kbd>ENTER</kbd></div>
          </article>}
        </div>
        <footer><span><Eye />Живое превью построено из карточки <code>{currentItem?.id}</code></span><div>{renderMediaUpload('headerUrl')}{renderMediaUpload('posterUrl')}</div></footer>
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
