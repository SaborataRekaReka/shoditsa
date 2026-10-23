import { useId } from 'react'
import { Check, Clock3, UsersRound } from 'lucide-react'
import { FRIENDS_ROOM_DEFAULT_PACK_VARIANTS, FRIENDS_ROOM_PACK_VARIANTS, friendsRoomMinimumRounds } from '@shoditsa/contracts'
import { QuestOptionGroup, QuestSwitch } from '../../components/ui/QuestPrimitives'
import { ControlButton, SelectControl } from '../../components/ui/UiControls'
import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { publicAssetUrl } from '../../app/public-asset'
import { normalizeRoomSetup, ROOM_CATEGORIES, ROOM_SETUP_MODES, type RoomSetupValue, type SetupMode } from './room-setup-model'
import './room-setup.css'

export function RoomModePicker({ value, onChange, disabled, territoryEnabled = false, svoyakEnabled = false }: { value: SetupMode; onChange: (value: SetupMode) => void; disabled?: boolean; territoryEnabled?: boolean; svoyakEnabled?: boolean }) {
  const id = useId()
  const modes = ROOM_SETUP_MODES.filter(mode => mode.id !== 'territory' || territoryEnabled).filter(mode => mode.id !== 'svoyak' || svoyakEnabled)
  return <fieldset className="room-setup-modes" disabled={disabled}><legend id={id}><b aria-hidden="true">1</b>Во что играем?</legend><div role="radiogroup" aria-labelledby={id}>{modes.map((mode, index) => <ControlButton type="button" role="radio" aria-checked={value === mode.id} tabIndex={value === mode.id ? 0 : -1} className="room-setup-mode" key={mode.id} onClick={() => onChange(mode.id)} onKeyDown={event => {
    const step = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0
    if (!step && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? modes.length - 1 : (index + step + modes.length) % modes.length
    onChange(modes[next].id); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }}><ThemedArtwork src={publicAssetUrl(`images/home-doodle/${mode.art}.webp`)} width="48" height="48" alt="" /><span><strong>{mode.title}</strong><small>{mode.detail}</small></span>{value === mode.id && <Check className="room-setup-mode-check" size={16} aria-hidden="true" />}</ControlButton>)}</div><p className="room-setup-mode-caption">{value === 'quiz' ? 'Знакомые категории, неожиданные вопросы. Кто наберёт больше очков?' : value === 'danetki' ? 'Одна загадочная история. Много версий. Разгадайте её вместе.' : value === 'territory' ? 'Отвечай верно, забирай клетки и побеждай в дуэли.' : 'Поле с вопросами, ставки и ведущий из вашей компании.'}</p></fieldset>
}

export function RoomSetup({ value, onChange, disabled = false, territoryEnabled = false, hideModePicker = false, roundsEditable = true, compact = false }: { value: RoomSetupValue; onChange: (value: RoomSetupValue) => void; disabled?: boolean; territoryEnabled?: boolean; hideModePicker?: boolean; roundsEditable?: boolean; compact?: boolean }) {
  const change = (patch: Partial<RoomSetupValue>) => onChange(normalizeRoomSetup({ ...value, ...patch }))
  const togglePack = (mode: typeof ROOM_CATEGORIES[number]['id']) => {
    const selected = value.packs.some(pack => pack.mode === mode)
    if (selected && value.packs.length === 1) return
    change({ packs: selected ? value.packs.filter(pack => pack.mode !== mode) : [...value.packs, { mode, variant: FRIENDS_ROOM_DEFAULT_PACK_VARIANTS[mode] }] })
  }
  const rules = <>
    <div className="room-setup-variants">{value.packs.map(pack => <label className="room-setup-field" key={pack.mode}><span>{ROOM_CATEGORIES.find(category => category.id === pack.mode)?.label}</span><SelectControl variant="soft" aria-label={`Подборка: ${ROOM_CATEGORIES.find(category => category.id === pack.mode)?.label}`} value={pack.variant} disabled={disabled} onChange={event => change({ packs: value.packs.map(item => item.mode === pack.mode ? { ...item, variant: event.target.value } : item) })}>{FRIENDS_ROOM_PACK_VARIANTS[pack.mode].map(variant => <option key={variant.id} value={variant.id}>{variant.label}</option>)}</SelectControl></label>)}</div>
    <section className="room-setup-rules-section" aria-labelledby="room-rules-title"><h2 id="room-rules-title" className="room-setup-section-title">Задай темп</h2><div className="room-setup-rules"><label className="room-setup-field"><span>Количество раундов</span><SelectControl variant="soft" aria-label="Количество раундов" disabled={disabled || !roundsEditable} value={value.roundsTotal} onChange={event => change({ roundsTotal: Number(event.target.value) })}>{Array.from({ length: 10 }, (_, index) => (index + 1) * 3).filter(rounds => rounds >= friendsRoomMinimumRounds(value.packs.length)).map(rounds => <option value={rounds} key={rounds}>{rounds} {rounds % 10 === 1 && rounds % 100 !== 11 ? 'раунд' : rounds % 10 >= 2 && rounds % 10 <= 4 && (rounds % 100 < 12 || rounds % 100 > 14) ? 'раунда' : 'раундов'}</option>)}</SelectControl></label>
      <QuestOptionGroup label="Время на ответ" value={value.answerTimeSeconds} options={([15, 20, 30, 45] as const).map(seconds => ({ value: seconds, label: `${seconds} с` }))} disabled={disabled} onChange={answerTimeSeconds => change({ answerTimeSeconds })} /></div></section>
    <QuestSwitch label="Перемешать категории" checked={value.shufflePacks} disabled={disabled} onChange={shufflePacks => change({ shufflePacks })} />
  </>
  return <div className={`room-setup${compact ? ' room-setup--compact' : ''}`}>
    {!hideModePicker && <RoomModePicker value={value.gameType} disabled={disabled} territoryEnabled={territoryEnabled} onChange={gameType => { if (gameType !== 'svoyak') change({ gameType }) }} />}
    {value.gameType === 'quiz' ? <>
      <fieldset className="room-setup-categories" disabled={disabled}><legend><b aria-hidden="true">2</b>Что вам по душе?<span>Выбрано: {value.packs.length}</span></legend><p className="room-setup-hint">Смешивай категории — каждому найдётся свой вопрос.</p><div>{ROOM_CATEGORIES.map(category => {
        const selected = value.packs.some(pack => pack.mode === category.id)
        return <ControlButton type="button" key={category.id} aria-pressed={selected} className="room-setup-category" onClick={() => togglePack(category.id)}><ThemedArtwork src={publicAssetUrl(`images/home-doodle/${category.id}.webp`)} alt="" width="38" height="38" /><span>{category.label}</span>{selected && <Check size={14} aria-hidden="true" />}</ControlButton>
      })}</div></fieldset>
      {rules}
    </> : <section className="room-setup-brief" aria-label="Правила режима"><div className="room-setup-brief-art"><ThemedArtwork src={publicAssetUrl(`images/home-doodle/${value.gameType === 'territory' ? 'territory' : 'yes-no'}.webp`)} width="54" height="54" alt="" /></div><h2>{value.gameType === 'territory' ? 'Захвати карту первым' : 'Одно расследование на всех'}</h2><p>{value.gameType === 'territory' ? 'Отвечайте на вопросы одновременно. Победитель дуэли выбирает следующую территорию для захвата.' : 'Обсуждайте версии и задавайте вопросы по очереди. Ведущий отвечает «да» или «нет», а вы вместе находите разгадку.'}</p><div className="room-setup-facts"><span><UsersRound size={17} />{value.gameType === 'territory' ? 'Ровно 2 игрока' : 'До 4 игроков'}</span><span><Clock3 size={17} />{value.gameType === 'territory' ? 'До 20 дуэлей' : 'В своём темпе'}</span></div></section>}
    {!hideModePicker && disabled && <p className="room-setup-note">Настройки меняет создатель комнаты.</p>}
  </div>
}


