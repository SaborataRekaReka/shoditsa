import { createPortal } from 'react-dom'
import { DialogSurface, DialogTitle } from '../ui/DialogSurface'
import './PwaInstallDialog.css'

export function PwaInstallDialog({ onClose }: { onClose: () => void }) {
  if (typeof document === 'undefined') return null
  return createPortal(<DialogSurface backdropClassName="pwa-install-backdrop" className="pwa-install-dialog" ariaLabel="Установить Сходится!" onClose={onClose}>
    <img src="/pwa/icon-192.png" alt="" width="64" height="64" />
    <DialogTitle>Сходится! на главном экране</DialogTitle>
    <p>Открывай игры одним касанием в отдельном окне.</p>
    <ol><li>Открой меню «Поделиться» в браузере.</li><li>Выбери «На экран Домой» и нажми «Добавить».</li></ol>
    <p>Если такого пункта нет, открой shoditsa.ru в Safari.</p>
    <button type="button" className="quest-button quest-button--primary" onClick={onClose}>Понятно</button>
  </DialogSurface>, document.body)
}
