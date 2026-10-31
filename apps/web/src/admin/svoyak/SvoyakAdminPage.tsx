import { SvoyakMediaRecoveryPanel } from './SvoyakMediaRecoveryPanel'
import { questionSourceId, SvoyakSourcePanel, SvoyakAdmissionReview } from './SvoyakSourcePanel'
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Save, Search, Upload, Trash2, Copy, Rocket, RefreshCw } from 'lucide-react'
import type {
  ActiveQuestion,
  EditableQuestion,
  QuestionMedia,
  SvoyakAdminState,
  SvoyakWorkspace,
} from '@shoditsa/contracts/svoyak'
import { request } from '../api'
import { SvoyakQuestionContent } from '../../features/svoyak/SvoyakQuestionContent'
import '../../features/svoyak/svoyak-game.css'
import './svoyak-admin.css'

const endpoint = '/admin/svoyak'
const message = (e: unknown) => (e instanceof Error ? e.message : 'Не удалось выполнить действие')
const emptyMedia = (): QuestionMedia => ({ kind: 'image', url: '', caption: '', phase: 'question' })

export function SvoyakAdminPage() {
  const [state, setState] = useState<SvoyakAdminState | null>(null),
    [work, setWork] = useState<SvoyakWorkspace | null>(null)
  const [selected, setSelected] = useState(''),
    [query, setQuery] = useState(''),
    [pack, setPack] = useState(''),
    [topic, setTopic] = useState('')
  const [status, setStatus] = useState(''),
    [mediaFilter, setMediaFilter] = useState(''),
    [page, setPage] = useState(0)
  const [reviewFilter, setReviewFilter] = useState(''),
    [original, setOriginal] = useState(false)
  const [view, setView] = useState<'question' | 'answer' | 'host'>('question'),
    [mobile, setMobile] = useState(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [dirty, setDirty] = useState(false)
  const [packName, setPackName] = useState(''),
    [newPack, setNewPack] = useState(false),
    [packDraft, setPackDraft] = useState('')
  const accept = (data: SvoyakAdminState) => {
    setState(data)
    setWork(data.workspace)
    setDirty(false)
  }
  const load = async () => {
    setError('')
    setBusy(true)
    try {
      accept(await request<SvoyakAdminState>(endpoint))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])
  // Keep unsaved work if the administrator navigates to another admin section.
  useEffect(() => {
    if (!dirty) return
    const guard = (e: MouseEvent) => {
      const target = e.target as Element
      if (
        target.closest('.admin-sidebar button,.admin-sidebar a') &&
        !confirm('Есть несохранённые правки. Уйти без сохранения?')
      ) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('click', guard, true)
    return () => document.removeEventListener('click', guard, true)
  }, [dirty])
  const change = (fn: (w: SvoyakWorkspace) => SvoyakWorkspace) => {
    setWork((w) => (w ? fn(w) : w))
    setDirty(true)
    setNotice('')
  }
  const update = (id: string, values: Partial<EditableQuestion>) =>
    change((w) => ({
      ...w,
      questions: w.questions.map((q) =>
        q.id === id
          ? {
              ...q,
              ...(state?.sources?.[questionSourceId(w.questions.find((q) => q.id === id)?.sourceQuestionId ?? id)] &&
              Object.keys(values).some((k) => !['review', 'enabled', 'packId', 'packTitle', 'source'].includes(k))
                ? { enabled: false, review: undefined }
                : {}),
              ...values,
            }
          : q
      ),
    }))
  const filtered = useMemo(
    () =>
      work?.questions.filter(
        (q) =>
          (!pack || q.packId === Number(pack)) &&
          (!topic || q.topic === topic) &&
          (!status || (status === 'enabled') === q.enabled) &&
          (!mediaFilter ||
            (mediaFilter === 'media') ===
              Boolean(
                q.media?.length || state?.sources?.[questionSourceId(q.sourceQuestionId ?? q.id)]?.media.length
              )) &&
          (!reviewFilter ||
            state?.sources?.[questionSourceId(q.sourceQuestionId ?? q.id)]?.reviewStatus === reviewFilter) &&
          (!query ||
            [
              q.id,
              q.prompt,
              q.answer,
              q.theme,
              q.packTitle,
              state?.sources?.[questionSourceId(q.sourceQuestionId ?? q.id)]?.originalPrompt ?? '',
              state?.sources?.[questionSourceId(q.sourceQuestionId ?? q.id)]?.originalAnswer ?? '',
              ...q.aliases,
            ]
              .join(' ')
              .toLocaleLowerCase('ru')
              .includes(query.toLocaleLowerCase('ru')))
      ) ?? [],
    [work, pack, topic, status, mediaFilter, query, reviewFilter, state?.sources]
  )
  const current = work?.questions.find((q) => q.id === selected) ?? filtered[0],
    index = filtered.findIndex((q) => q.id === current?.id)
  const source = current ? state?.sources?.[questionSourceId(current.sourceQuestionId ?? current.id)] : undefined
  useEffect(() => setPage(0), [pack, topic, status, mediaFilter, query, reviewFilter])
  useEffect(() => {
    setView('question')
    setOriginal(false)
  }, [current?.id])
  const pages = Math.max(1, Math.ceil(filtered.length / 60)),
    safePage = Math.min(page, pages - 1)
  const choose = (q: EditableQuestion) => {
    setSelected(q.id)
    setPage(Math.max(0, Math.floor(filtered.findIndex((x) => x.id === q.id) / 60)))
  }
  const save = async () => {
    if (!work) return
    setBusy(true)
    setError('')
    try {
      const data = await request<SvoyakAdminState>(endpoint + '/workspace', {
        method: 'PUT',
        body: JSON.stringify(work),
      })
      accept(data)
      setNotice('Черновик сохранён. Игроки увидят правки после публикации.')
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const action = async (type: 'publish' | 'discard') => {
    if (
      !work ||
      !confirm(
        type === 'publish'
          ? 'Опубликовать сохранённый черновик? Новые игры получат эту версию вопросов.'
          : 'Удалить весь сохранённый черновик и вернуться к опубликованной базе?'
      )
    )
      return
    setBusy(true)
    setError('')
    try {
      accept(
        await request<SvoyakAdminState>(endpoint + '/' + type, {
          method: 'POST',
          body: JSON.stringify({ version: work.version }),
        })
      )
      setNotice(type === 'publish' ? 'Новая версия опубликована.' : 'Черновик удалён.')
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const createQuestion = (copy?: EditableQuestion) => {
    if (!work) return
    const target = work.catalog.packs.find((p) => p.id === Number(pack)) ?? work.catalog.packs[0]
    if (!target) {
      setNewPack(true)
      setError('Сначала создайте пак')
      return
    }
    const id = 'manual:' + crypto.randomUUID()
    const q: EditableQuestion = copy
      ? {
          ...structuredClone(copy),
          id,
          enabled: false,
          review: undefined,
          sourceQuestionId:
            copy.sourceQuestionId ?? (state?.sources?.[questionSourceId(copy.id)] ? copy.id : undefined),
          hash: '',
        }
      : {
          id,
          hash: '',
          packId: target.id,
          packTitle: target.title,
          themeId: current?.themeId ?? 'manual:' + crypto.randomUUID(),
          theme: current?.theme ?? 'Новая тема',
          topic: topic || current?.topic || work.catalog.topics[0]?.id || 'everyday',
          prompt: 'Новый вопрос',
          answer: 'Ответ',
          aliases: [],
          note: '',
          source: '',
          difficulty: 3,
          age: 18,
          duplicateIds: [],
          enabled: false,
          media: [],
        }
    change((w) => ({ ...w, questions: [q, ...w.questions] }))
    setSelected(id)
    setQuery('')
    setReviewFilter('')
    setStatus('')
    setMediaFilter('')
    setTopic('')
    setPack(String(q.packId))
    setPage(0)
  }
  const createPack = () => {
    if (!packName.trim() || !work) return
    const id = Math.max(0, ...work.catalog.packs.map((p) => p.id)) + 1
    change((w) => ({
      ...w,
      catalog: {
        ...w.catalog,
        packs: [...w.catalog.packs, { id, title: packName.trim(), total: 0, playable: 0, topics: [] }],
      },
    }))
    setPack(String(id))
    setPackName('')
    setNewPack(false)
    setSelected('')
  }
  const renamePack = () => {
    if (!packDraft.trim() || !pack) return
    const title = packDraft.trim()
    change((w) => ({
      ...w,
      catalog: { ...w.catalog, packs: w.catalog.packs.map((p) => (p.id === Number(pack) ? { ...p, title } : p)) },
      questions: w.questions.map((q) => (q.packId === Number(pack) ? { ...q, packTitle: title } : q)),
    }))
    setPackDraft('')
  }
  const mediaChange = (i: number, values: Partial<QuestionMedia>) => {
    if (current) update(current.id, { media: (current.media ?? []).map((m, n) => (i === n ? { ...m, ...values } : m)) })
  }
  const upload = async (file: File) => {
    if (!current) return
    const id = current.id
    if (file.size > 18 * 1024 * 1024) {
      setError('Максимальный размер файла — 18 МБ')
      return
    }
    setBusy(true)
    setError('')
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
        reader.readAsDataURL(file)
      })
      const result = await request<{ url: string; kind: QuestionMedia['kind'] }>(endpoint + '/media', {
        method: 'POST',
        body: JSON.stringify({ base64, contentType: file.type }),
        timeoutMs: 120000,
      })
      change((w) => ({
        ...w,
        questions: w.questions.map((q) =>
          q.id === id ? { ...q, media: [...(q.media ?? []), { ...emptyMedia(), ...result }] } : q
        ),
      }))
      setNotice('Файл загружен. Сохраните черновик, чтобы закрепить его за вопросом.')
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  if (!work || !state)
    return (
      <section className="admin-panel">
        <h1>Своя игра</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className="admin-btn" onClick={load}>
              Повторить
            </button>
          </>
        ) : (
          <p role="status">Загружаем базу вопросов…</p>
        )}
      </section>
    )
  const preview: ActiveQuestion | undefined = current
    ? {
        id: current.id,
        theme: current.theme,
        points: current.difficulty * 100,
        prompt: original && source ? source.originalPrompt || 'В исходнике нет текстового условия.' : current.prompt,
        phase: view === 'answer' ? 'resolved' : 'reading',
        durationMs: 30000,
        remainingMs: 30000,
        deadline: null,
        answeringId: null,
        rejectedIds: [],
        result: null,
        media: (original && source
          ? source.originalMedia.filter((m) => m.url).map((m) => ({ ...m, url: m.url! }))
          : current.media
        )?.filter((m) => m.phase === 'question' || view === 'answer'),
        ...(view !== 'question'
          ? {
              answer: {
                text: original && source ? source.originalAnswer : current.answer,
                aliases: current.aliases,
                note: current.note,
                source: current.source,
                packTitle: current.packTitle,
              },
            }
          : {}),
      }
    : undefined
  const enabled = work.questions.filter((q) => q.enabled).length
  return (
    <div className="svoyak-admin">
      <header className="svoyak-admin__head">
        <div>
          <span>Вся библиотека вопросов и паков</span>
          <h1>Своя игра</h1>
          <p>
            {work.questions.length.toLocaleString('ru')} вопросов, {work.catalog.packs.length} паков. Допущено:{' '}
            {enabled.toLocaleString('ru')}.
          </p>
        </div>
        <div className="svoyak-admin__actions">
          <button
            className="admin-btn admin-btn--secondary"
            disabled={busy || dirty}
            onClick={load}
            aria-label="Обновить базу"
          >
            <RefreshCw size={18} />
          </button>
          <button className="admin-btn admin-btn--primary" disabled={busy || !dirty} onClick={save}>
            <Save size={18} />
            Сохранить черновик
          </button>
          <button
            className="admin-btn admin-btn--primary"
            disabled={busy || dirty || !state.draft}
            onClick={() => void action('publish')}
          >
            <Rocket size={18} />
            Опубликовать
          </button>
        </div>
      </header>
      <div className="svoyak-admin__status">
        <strong>
          {dirty ? 'Есть несохранённые правки' : state.draft ? 'Сохранён черновик' : 'Библиотека загружена'}
        </strong>
        <span>Изменения вступают в силу после публикации. Начатые партии сохраняют свою версию.</span>
        {state.draft && (
          <button
            className="admin-btn admin-btn--ghost"
            disabled={busy || dirty}
            onClick={() => void action('discard')}
          >
            Удалить черновик
          </button>
        )}
      </div>
      {error && (
        <p className="svoyak-admin__error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="svoyak-admin__notice" role="status">
          {notice}
        </p>
      )}
      {state.library && (
        <p className="svoyak-admin__library-note">
          Вся исходная библиотека: {state.library.summary.total.toLocaleString('ru')} вопросов,{' '}
          {state.library.summary.packs} паков, {state.library.summary.withMedia} вопросов с медиа. Недопущенные вопросы
          видны только администратору.
        </p>
      )}
      <SvoyakMediaRecoveryPanel
        onOpenQuestion={(id) => {
          const question = work.questions.find((q) => questionSourceId(q.id) === questionSourceId(id))
          if (!question) return
          setPack('')
          setTopic('')
          setStatus('')
          setMediaFilter('')
          setReviewFilter('')
          setQuery('')
          setSelected(question.id)
          setPage(Math.floor(work.questions.findIndex((q) => q.id === question.id) / 60))
          setView('question')
          requestAnimationFrame(() =>
            document
              .querySelector('.svoyak-admin__preview-panel')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          )
        }}
      />
      <section className="admin-panel svoyak-admin__filters" aria-label="Поиск и фильтры">
        <label className="admin-field">
          <span>Поиск по вопросу, ответу, теме или ID</span>
          <div className="svoyak-admin__search">
            <Search size={18} />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelected('')
              }}
              placeholder="Найти вопрос…"
            />
          </div>
        </label>
        <label className="admin-field">
          <span>Пак</span>
          <select
            value={pack}
            onChange={(e) => {
              setPack(e.target.value)
              setSelected('')
              setPackDraft('')
            }}
          >
            <option value="">Все паки</option>
            {work.catalog.packs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} ({work.questions.filter((q) => q.packId === p.id).length})
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Интерес</span>
          <select
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value)
              setSelected('')
            }}
          >
            <option value="">Все интересы</option>
            {work.catalog.topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Допуск</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setSelected('')
            }}
          >
            <option value="">Все вопросы</option>
            <option value="enabled">В игре</option>
            <option value="disabled">Не допущены к игре</option>
          </select>
        </label>
        <label className="admin-field">
          <span>Медиа</span>
          <select
            value={mediaFilter}
            onChange={(e) => {
              setMediaFilter(e.target.value)
              setSelected('')
            }}
          >
            <option value="">Любые</option>
            <option value="media">С медиа</option>
            <option value="text">Только текст</option>
          </select>
        </label>
        <label className="admin-field">
          <span>Исходная проверка</span>
          <select
            value={reviewFilter}
            onChange={(e) => {
              setReviewFilter(e.target.value)
              setSelected('')
            }}
          >
            <option value="">Все статусы</option>
            <option value="approved">Принят в исходной редакции</option>
            <option value="needs_review">Нужна проверка</option>
            <option value="unreviewed">Не проверен</option>
            <option value="rejected">Отклонён</option>
          </select>
        </label>
      </section>
      <div className="svoyak-admin__actions">
        <button className="admin-btn admin-btn--secondary" disabled={busy} onClick={() => createQuestion()}>
          <Plus size={18} />
          Новый вопрос
        </button>
        <button className="admin-btn admin-btn--secondary" disabled={busy} onClick={() => setNewPack((v) => !v)}>
          <Plus size={18} />
          Новый пак
        </button>
        {pack && (
          <>
            <input
              aria-label="Новое название пака"
              placeholder="Новое название пака"
              value={packDraft}
              onChange={(e) => setPackDraft(e.target.value)}
            />
            <button
              className="admin-btn admin-btn--secondary"
              disabled={!packDraft.trim() || busy}
              onClick={renamePack}
            >
              Переименовать пак
            </button>
            <button
              className="admin-btn admin-btn--secondary"
              disabled={busy}
              onClick={() => {
                if (confirm('Снять все вопросы выбранного пака с игры?'))
                  change((w) => ({
                    ...w,
                    questions: w.questions.map((q) => (q.packId === Number(pack) ? { ...q, enabled: false } : q)),
                  }))
              }}
            >
              Снять пак с игры
            </button>
            {!work.questions.some((q) => q.packId === Number(pack)) && (
              <button
                className="admin-btn"
                disabled={busy}
                onClick={() => {
                  change((w) => ({
                    ...w,
                    catalog: { ...w.catalog, packs: w.catalog.packs.filter((p) => p.id !== Number(pack)) },
                  }))
                  setPack('')
                }}
              >
                Удалить пустой пак
              </button>
            )}
          </>
        )}
      </div>
      {newPack && (
        <form
          className="admin-panel svoyak-admin__actions"
          onSubmit={(e) => {
            e.preventDefault()
            createPack()
          }}
        >
          <label className="admin-field">
            <span>Название нового пака</span>
            <input autoFocus value={packName} maxLength={300} onChange={(e) => setPackName(e.target.value)} />
          </label>
          <button className="admin-btn admin-btn--primary" disabled={!packName.trim() || busy}>
            Создать пак
          </button>
        </form>
      )}
      <div className="svoyak-admin__workspace">
        <section className="admin-panel svoyak-admin__list" aria-label="Все вопросы">
          <header>
            <h2>Найдено: {filtered.length.toLocaleString('ru')}</h2>
          </header>
          <div className="svoyak-admin__rows">
            {filtered.slice(safePage * 60, (safePage + 1) * 60).map((q) => (
              <button key={q.id} className={q.id === current?.id ? 'is-selected' : ''} onClick={() => choose(q)}>
                <span>
                  <strong>{q.theme}</strong>
                  <small>
                    {q.enabled ? 'В игре' : 'Не допущен'}
                    {q.media?.length || state.sources?.[questionSourceId(q.sourceQuestionId ?? q.id)]?.media.length
                      ? ', есть медиа'
                      : ''}
                  </small>
                </span>
                <p>{q.prompt || 'Вопрос задан медиа'}</p>
                <small>{q.packTitle}</small>
              </button>
            ))}
            {!filtered.length && <p>Вопросов по этим фильтрам нет.</p>}
          </div>
          <footer>
            <button
              className="admin-btn"
              aria-label="Предыдущая страница"
              disabled={!safePage}
              onClick={() => setPage(safePage - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              {safePage + 1} / {pages}
            </span>
            <button
              className="admin-btn"
              aria-label="Следующая страница"
              disabled={safePage + 1 >= pages}
              onClick={() => setPage(safePage + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </footer>
        </section>
        {current && preview ? (
          <div className="svoyak-admin__detail">
            <section className="admin-panel svoyak-admin__preview-panel">
              <header>
                <div>
                  <span>Тот же экран, что в игре</span>
                  <h2>Визуальная проверка</h2>
                </div>
                <div className="svoyak-admin__actions">
                  <button
                    className="admin-btn"
                    disabled={index <= 0}
                    aria-label="Предыдущий вопрос"
                    onClick={() => choose(filtered[index - 1])}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span>
                    {index + 1} / {filtered.length}
                  </span>
                  <button
                    className="admin-btn"
                    disabled={index < 0 || index >= filtered.length - 1}
                    aria-label="Следующий вопрос"
                    onClick={() => choose(filtered[index + 1])}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </header>
              <div className="svoyak-admin__actions" aria-label="Вид предпросмотра">
                {(
                  [
                    ['question', 'Вопрос игроку'],
                    ['answer', 'Ответ раскрыт'],
                    ['host', 'Ключ ведущего'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    className="admin-btn admin-btn--secondary"
                    aria-pressed={view === id}
                    onClick={() => setView(id)}
                  >
                    {label}
                  </button>
                ))}
                {source && (
                  <label>
                    <input type="checkbox" checked={original} onChange={(e) => setOriginal(e.target.checked)} />
                    Оригинал
                  </label>
                )}
                <label>
                  <input type="checkbox" checked={mobile} onChange={(e) => setMobile(e.target.checked)} /> Телефон
                </label>
              </div>
              <div
                className={`svoyak-admin__player${mobile ? ' is-mobile' : ''}`}
                data-public-theme="quest-study"
                data-quest-skin="shoditsa"
                data-quest-tone="light"
              >
                <div className="svoyak-preview">
                  <div className="svoyak-stage__head">
                    <div>
                      <h2>{current.theme}</h2>
                      <strong>{preview.points}</strong>
                    </div>
                    <span>Предпросмотр</span>
                  </div>
                  <SvoyakQuestionContent
                    key={`${current.id}:${view}:${original}`}
                    current={preview}
                    host={view === 'host'}
                  />
                </div>
              </div>
            </section>
            {source && (
              <SvoyakSourcePanel key={current.id} source={source} id={current.sourceQuestionId ?? current.id} />
            )}
            <fieldset className="admin-panel svoyak-admin__editor" disabled={busy}>
              <legend>Редактирование вопроса</legend>
              <div className="svoyak-admin__actions">
                <label>
                  <input
                    type="checkbox"
                    checked={current.enabled}
                    onChange={(e) => update(current.id, { enabled: e.target.checked })}
                  />{' '}
                  Допущен к игре
                </label>
                <button className="admin-btn admin-btn--secondary" onClick={() => createQuestion(current)}>
                  <Copy size={16} />
                  Дублировать
                </button>
                {!source && (
                  <button
                    className="admin-btn admin-btn--secondary"
                    onClick={() => {
                      if (confirm('Удалить вопрос из черновика? Опубликованная версия сохранится.')) {
                        change((w) => ({ ...w, questions: w.questions.filter((q) => q.id !== current.id) }))
                        setSelected('')
                      }
                    }}
                  >
                    <Trash2 size={16} />
                    Удалить
                  </button>
                )}
              </div>
              <label className="admin-field">
                <span>Вопрос</span>
                <textarea
                  rows={5}
                  maxLength={10000}
                  value={current.prompt}
                  onChange={(e) => update(current.id, { prompt: e.target.value })}
                />
              </label>
              <label className="admin-field">
                <span>Правильный ответ</span>
                <textarea
                  rows={2}
                  maxLength={10000}
                  value={current.answer}
                  onChange={(e) => update(current.id, { answer: e.target.value })}
                />
              </label>
              <div className="svoyak-admin__field-grid">
                <label className="admin-field">
                  <span>Пак вопроса</span>
                  <select
                    value={current.packId}
                    onChange={(e) => {
                      const p = work.catalog.packs.find((p) => p.id === Number(e.target.value))!
                      update(current.id, { packId: p.id, packTitle: p.title })
                    }}
                  >
                    {work.catalog.packs.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-field">
                  <span>Интерес вопроса</span>
                  <select value={current.topic} onChange={(e) => update(current.id, { topic: e.target.value })}>
                    {work.catalog.topics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-field">
                  <span>Название темы</span>
                  <input
                    value={current.theme}
                    maxLength={300}
                    onChange={(e) => update(current.id, { theme: e.target.value })}
                  />
                </label>
                <label className="admin-field">
                  <span>Группа темы (ID)</span>
                  <input
                    list="svoyak-theme-ids"
                    value={current.themeId}
                    maxLength={200}
                    onChange={(e) => update(current.id, { themeId: e.target.value })}
                  />
                  <datalist id="svoyak-theme-ids">
                    {[
                      ...new Map(
                        work.questions.filter((q) => q.packId === current.packId).map((q) => [q.themeId, q.theme])
                      ).entries(),
                    ].map(([id, title]) => (
                      <option key={id} value={id}>
                        {title}
                      </option>
                    ))}
                  </datalist>
                </label>
                <label className="admin-field">
                  <span>Сложность в теме</span>
                  <select
                    value={current.difficulty}
                    onChange={(e) => update(current.id, { difficulty: Number(e.target.value) })}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-field">
                  <span>Возраст</span>
                  <select value={current.age} onChange={(e) => update(current.id, { age: Number(e.target.value) })}>
                    {[0, 6, 12, 16, 18].map((n) => (
                      <option key={n} value={n}>
                        {n}+
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="svoyak-admin__hint">
                Полные авторские темы сохраняются. Вопросы из неполных тем объединяются в сборные темы по интересу.
                Сложность задаёт порядок внутри темы; стоимость в игре зависит от места вопроса и раунда.
              </p>
              <label className="admin-field">
                <span>Зачёт: каждый вариант с новой строки</span>
                <textarea
                  rows={3}
                  value={current.aliases.join('\n')}
                  onChange={(e) => update(current.id, { aliases: e.target.value.split('\n') })}
                />
              </label>
              <label className="admin-field">
                <span>Примечание ведущему</span>
                <textarea
                  rows={3}
                  value={current.note}
                  onChange={(e) => update(current.id, { note: e.target.value })}
                />
              </label>
              <label className="admin-field">
                <span>Источник</span>
                <input
                  value={current.source}
                  maxLength={2000}
                  onChange={(e) => update(current.id, { source: e.target.value })}
                />
              </label>
              <section className="svoyak-admin__media">
                <h2>Медиа вопроса</h2>
                <p>Изображения, аудио и видео до 18 МБ. Без автозапуска. Медиа ответа игрок увидит после раскрытия.</p>
                {(current.media ?? []).map((m, i) => (
                  <div className="svoyak-admin__media-item" key={i}>
                    <div className="svoyak-admin__field-grid">
                      <label className="admin-field">
                        <span>Тип медиа {i + 1}</span>
                        <select
                          value={m.kind}
                          onChange={(e) => mediaChange(i, { kind: e.target.value as QuestionMedia['kind'] })}
                        >
                          <option value="image">Изображение</option>
                          <option value="audio">Аудио</option>
                          <option value="video">Видео</option>
                        </select>
                      </label>
                      <label className="admin-field">
                        <span>Когда показывать</span>
                        <select
                          value={m.phase}
                          onChange={(e) => mediaChange(i, { phase: e.target.value as QuestionMedia['phase'] })}
                        >
                          <option value="question">В вопросе</option>
                          <option value="answer">После ответа</option>
                        </select>
                      </label>
                    </div>
                    <label className="admin-field">
                      <span>Ссылка на файл</span>
                      <input
                        type="url"
                        value={m.url}
                        placeholder="https://…"
                        onChange={(e) => mediaChange(i, { url: e.target.value })}
                      />
                    </label>
                    <label className="admin-field">
                      <span>Подпись / описание</span>
                      <input
                        value={m.caption}
                        maxLength={500}
                        onChange={(e) => mediaChange(i, { caption: e.target.value })}
                      />
                    </label>
                    <button
                      className="admin-btn admin-btn--secondary"
                      onClick={() => update(current.id, { media: current.media?.filter((_, n) => n !== i) })}
                    >
                      <Trash2 size={16} />
                      Убрать медиа {i + 1}
                    </button>
                  </div>
                ))}
                <div className="svoyak-admin__actions">
                  <label className="admin-btn admin-btn--secondary">
                    <Upload size={18} />
                    Загрузить файл
                    <input
                      className="svoyak-admin__file"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,audio/mpeg,audio/wav,audio/ogg,audio/webm,video/mp4,video/webm"
                      disabled={busy || (current.media?.length ?? 0) >= 12}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) void upload(f)
                        e.target.value = ''
                      }}
                    />
                  </label>
                  <button
                    className="admin-btn admin-btn--secondary"
                    disabled={(current.media?.length ?? 0) >= 12}
                    onClick={() => update(current.id, { media: [...(current.media ?? []), emptyMedia()] })}
                  >
                    <Plus size={18} />
                    Добавить ссылку
                  </button>
                </div>
              </section>
              {source && (
                <SvoyakAdmissionReview question={current} onChange={(review) => update(current.id, { review })} />
              )}
              <small className="svoyak-admin__id">ID: {current.id}</small>
              <button className="admin-btn admin-btn--primary" disabled={busy || !dirty} onClick={save}>
                <Save size={18} />
                Сохранить все правки
              </button>
            </fieldset>
          </div>
        ) : (
          <section className="admin-panel">
            <h2>Выберите вопрос или создайте новый</h2>
          </section>
        )}
      </div>
      <details className="admin-panel svoyak-admin__history">
        <summary>История версий ({state.revisions.length})</summary>
        <p>Активная версия: {state.activeRevision}. Предыдущие версии сохранены для начатых партий и истории.</p>
        {state.revisions.map((r) => (
          <p key={r.id}>
            <code>{r.id}</code>
            <span>{r.status}</span>
            <span>{r.count} вопросов</span>
            <time>{new Date(r.createdAt).toLocaleString('ru')}</time>
          </p>
        ))}
      </details>
    </div>
  )
}
