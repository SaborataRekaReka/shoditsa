import { canonicalApplicationHref } from '../../features/application/routes'
import { STUDY_HOME_VARIANT_KEY } from '../quest-game/home-route'
import '../../styles/quest-study-tokens.css'
import '../../styles/reference-tokens.css'
import '../../styles/shoditsa-study-tokens.css'
import '../quest-game/quest-game.css'
import '../quest-game/shoditsa-game.css'
import './home-variants.css'

const requested = new URLSearchParams(location.search).get('variant')
const variant = requested === 'b' || requested === 'c' ? requested : 'a'
const canonical = canonicalApplicationHref(window.location)
if (canonical) history.replaceState(history.state, '', canonical)
try { sessionStorage.setItem(STUDY_HOME_VARIANT_KEY, variant) } catch { /* The preview also works without browser storage. */ }
await import('../../main')
