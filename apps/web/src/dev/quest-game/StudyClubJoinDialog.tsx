import { createPortal } from 'react-dom'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Minus } from 'lucide-react'
import { QuestButton, QuestTakeover } from '../../components/ui/QuestPrimitives'
import { StudyClubSky } from './StudyClubSky'
import { STUDY_CLUB_OFFER_HREF } from './account-routing'
import { StudyClubPlans } from './StudyClubPlans'
import { buildClubPageViewModel } from '../../features/commerce/club-page-model'
import { api, queryKeys } from '../../api/client'
import { SERVER_RUNTIME } from '../../hooks/use-server-runtime'
import '../../styles/shoditsa-study-tokens.css'
import './study-club-join-dialog.css'

const benefits = [
  { title: 'Ежедневные загадки', free: true },
  { title: 'Весь архив без билетиков', free: false },
  { title: 'Свободная игра без билетиков', free: false },
  { title: 'Все клубные спецпоказы', free: false },
  { title: 'Создание комнат для друзей', free: false },
] as const

export function StudyClubJoinDialog({ onClose }: { onClose: () => void }) {
  const catalog = useQuery({ queryKey: queryKeys.commerceCatalog, queryFn: api.commerceCatalog, enabled: SERVER_RUNTIME })
  const { pricing } = buildClubPageViewModel({ authenticated: false, products: catalog.data?.products.filter(product => product.kind === 'club') })
  const [selectedPlan, setSelectedPlan] = useState(pricing.monthly.id)
  const offerHref = `${STUDY_CLUB_OFFER_HREF}?${new URLSearchParams({ product: selectedPlan })}#club-offers`
  return createPortal(<div data-public-theme="quest-study" data-quest-skin="shoditsa" onKeyDown={event => {
    // Escape and Tab reach the shared focus trap; other keys belong to the dialog.
    if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation()
  }}><QuestTakeover title="Вступи в клуб" onClose={onClose}>
    <div className="study-club-join">
      <StudyClubSky headingId="club-join-heading" heading={<>Больше игры.<br /><em>Больше открытий.</em></>} />
      <div className="study-club-join__body">
        <table className="study-club-join__comparison" aria-label="Возможности бесплатно и с Клубом">
          <thead><tr><th scope="col"><span className="study-club-join__sr">Возможности</span></th><th scope="col">Бесплатно</th><th scope="col"><span className="study-club-join__club-label">Клуб</span></th></tr></thead>
          <tbody>{benefits.map(benefit => <tr key={benefit.title}>
            <th scope="row">{benefit.title}</th>
            <td>{benefit.free ? <Check size={21} strokeWidth={3} aria-hidden="true" /> : <Minus size={18} aria-hidden="true" />}<span className="study-club-join__sr">{benefit.free ? 'Включено' : 'Не включено'}</span></td>
            <td><Check size={21} strokeWidth={3} aria-hidden="true" /><span className="study-club-join__sr">Включено</span></td>
          </tr>)}</tbody>
        </table>
        <section className="study-club-join__plans" aria-label="Выбор клубного билета">
          <StudyClubPlans pricing={pricing} selectedPlan={selectedPlan} onSelect={setSelectedPlan} />
        </section>
        <div className="study-club-join-actions">
          <a className="quest-button quest-button--club" href={offerHref}>Выбрать клубный билет</a>
          <a className="quest-button quest-button--outline" href={`${STUDY_CLUB_OFFER_HREF}?${new URLSearchParams({ product: selectedPlan })}#club-content`}>Больше о Клубе</a>
          <QuestButton kind="text" onClick={onClose}>Не сейчас</QuestButton>
        </div>
      </div>
    </div>
  </QuestTakeover></div>, document.body)
}
