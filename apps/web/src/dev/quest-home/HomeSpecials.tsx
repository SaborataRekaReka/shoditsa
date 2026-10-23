import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { api, queryKeys } from '../../api/client'
import { localPresentationLink } from '../../app/local-presentation'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { InlineAlert } from '../../components/ui'
import { clubLibraryItems, type ClubLibraryItem } from '../quest-game/club-library-model'
import { clubLibraryCover } from '../quest-game/club-library-covers'
import { STUDY_CLUB_HREF, STUDY_CLUB_OFFER_HREF } from '../quest-game/account-routing'
import { GeneratedShoditsaGlyph as Glyph } from '../quest-game/GeneratedShoditsaArt'
import { hasSpecialAccess, specialDestination } from '../../app/special-navigation'
import './home-specials.css'
import { SERVER_RUNTIME } from '../../hooks/use-server-runtime'

const connected = SERVER_RUNTIME
const client = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1 } } })
const count = (value: number) => `${value} ${new Intl.PluralRules('ru').select(value) === 'one' ? 'загадка' : new Intl.PluralRules('ru').select(value) === 'few' ? 'загадки' : 'загадок'}`
const cover = (pack: ClubLibraryItem) => pack.coverUrl?.startsWith('https://') ? pack.coverUrl : clubLibraryCover(pack)
const description = (pack: ClubLibraryItem) => pack.id === 'dtf-game-comments-25-v1' ? 'Узнай игру по настоящим комментариям с DTF.' : pack.cadence === 'daily' ? 'Один артист в день. Угадывай по подсказкам.' : (pack.subtitle || pack.description).replace(/\s*[\u00b7\u2022]\s*/g, ', ')

function SpecialsContent() {
  const packs = useQuery({ queryKey: queryKeys.packs, queryFn: api.packs, enabled: connected })
  const items = clubLibraryItems(connected ? packs.data?.items ?? [] : null)
  return <section className="hs-specials" id="home-specials" aria-labelledby="home-specials-title">
    <header><div><h2 id="home-specials-title">Клубные спецпоказы</h2><p>Знакомые игры с особым настроением.</p></div><a className="quest-button quest-button--footer" href={STUDY_CLUB_OFFER_HREF}><Glyph name="medal" size={24} />О Клубе</a></header>
    {connected && packs.isPending ? <p role="status">Загружаем спецпоказы…</p> : connected && packs.isError ? <InlineAlert tone="warning">Не удалось загрузить спецпоказы.<QuestButton kind="text" onClick={() => void packs.refetch()}>Повторить</QuestButton></InlineAlert> : items.length ? <div className="hs-specials-grid">{items.slice(0, 2).map(pack => {
      const access = hasSpecialAccess(pack.access) ? 'open' : 'club'
      return <article className="hs-special-card" key={pack.id} data-pack-id={pack.id} data-pack-access={access}>
        <img className="hs-special-cover" src={cover(pack)} alt="" width="560" height="320" loading="lazy" />
        <div className="hs-special-copy"><span>{pack.cadence === 'daily' ? 'Каждый день' : count(pack.totalItems)}</span><h3>{pack.title}</h3><p>{description(pack)}</p>
          <a className="quest-button quest-button--outline" href={localPresentationLink(specialDestination(pack.id, pack.access))}>{access === 'open' ? <>Открыть спецпоказ<ArrowRight size={16} aria-hidden="true" /></> : <>Открыть с Клубом<Glyph name="medal" size={21} /></>}</a>
        </div>
      </article>
    })}</div> : <p>Новые спецпоказы появятся здесь.</p>}
    <a className="hs-specials-all" href={STUDY_CLUB_HREF}>Все спецпоказы<ArrowRight size={16} aria-hidden="true" /></a>
  </section>
}

export function HomeSpecials() {
  return <QueryClientProvider client={client}><SpecialsContent /></QueryClientProvider>
}
