import { Link } from '@tanstack/react-router'
import { BrandWordmark } from '../../components/app-shell/BrandWordmark'
import '../../components/ui/UiControls.css'
import './PublicNotFoundScreen.css'

export function PublicNotFoundScreen() {
  return <main className="public-not-found">
    <Link to="/" className="public-not-found__brand" aria-label="Сходится! — на главную"><BrandWordmark variant="compact" /></Link>
    <p className="public-not-found__code">Ошибка 404</p>
    <h1>Страница не найдена</h1>
    <p className="public-not-found__description">Возможно, ссылка устарела или в адресе есть опечатка. Выберите игру или загляните в архив.</p>
    <div className="public-not-found__actions">
      <Link to="/" className="ui-button ui-button--primary">Выбрать игру</Link>
      <Link to="/archive" className="ui-button ui-button--secondary">Открыть архив</Link>
    </div>
  </main>
}
