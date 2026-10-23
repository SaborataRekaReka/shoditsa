import { useId } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { AnchoredMenu } from './AnchoredMenu'
import { QuestButton, QuestInput } from './QuestPrimitives'
import './PlayerIdentityField.css'

export function PlayerIdentityField<T extends string>({ name, avatar, avatars, onNameChange, onAvatarChange, disabled = false }: {
  name: string; avatar: T; avatars: readonly { id: T; face: string; label: string }[]
  onNameChange: (name: string) => void; onAvatarChange: (avatar: T) => void; disabled?: boolean
}) {
  const id = useId()
  const selected = avatars.find(item => item.id === avatar) ?? avatars[0]
  return <div className="ui-player-identity">
    <AnchoredMenu label="Выбери аватар" disabled={disabled} className="ui-player-identity__picker" menuClassName="ui-player-identity__avatars" trigger={({ expanded, toggle, triggerRef }) => <QuestButton kind="icon" ref={triggerRef} disabled={disabled} aria-label={`Выбрать аватар: ${selected.label}`} aria-haspopup="listbox" aria-expanded={expanded} onClick={toggle}><span aria-hidden="true">{selected.face}</span><ChevronDown size={12} aria-hidden="true" /></QuestButton>}>
      {close => <>{avatars.map(item => <QuestButton kind="choice" key={item.id} role="option" aria-selected={avatar === item.id} aria-label={item.label} selected={avatar === item.id} onClick={() => { onAvatarChange(item.id); close() }}><span aria-hidden="true">{item.face}</span>{avatar === item.id && <Check size={12} aria-hidden="true" />}</QuestButton>)}</>}
    </AnchoredMenu>
    <label className="ui-player-identity__name" htmlFor={id}><span>Имя в игре</span><QuestInput id={id} autoComplete="nickname" required minLength={1} maxLength={24} value={name} disabled={disabled} onChange={event => onNameChange(event.target.value)} placeholder="Как тебя зовут?" /></label>
  </div>
}
