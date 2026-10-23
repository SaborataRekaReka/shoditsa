import { ArrowRight } from 'lucide-react'
import { ReferenceIcon, type ReferenceIconName } from '../../components/ui/ReferenceIcon'
import { GAME_GUIDE_PRESENTATION, GAME_SEO } from '../../app/seo-content'
import './section-formats.css'

export type SectionFormat='f1'|'f2'|'f3'
export const SECTION_FORMATS=[
  {id:'f1',name:'Открытая страница',note:'Крупная типографика, свободные колонки и заметка на полях.'},
  {id:'f2',name:'Кино в деталях',note:'Предметы, реплики и бумажная программа сеанса.'},
  {id:'f3',name:'Сразу по делу',note:'Строки признаков, крупные факты и спокойный рассказ о каталоге.'},
] as const
const content=GAME_SEO.movie
const guide=GAME_GUIDE_PRESENTATION.movie
const icons:ReferenceIconName[]=['user','movie','calendar','idea']

export function EvidenceFormat({format}:{format:SectionFormat}) {
  return <section className={`format-evidence format-evidence--${format}`} aria-labelledby="format-evidence-heading">
    <h2 id="format-evidence-heading">{guide.evidenceTitle}</h2>
    <div className="format-evidence-items">{content.features.map((feature,index)=><article key={feature}><span className="format-evidence-art"><ReferenceIcon name={icons[index]} size={64}/></span><h3>{feature}</h3></article>)}</div>
  </section>
}
export function QuestionsFormat({format}:{format:SectionFormat}) {
  return <div className={`format-information format-information--${format}`}>
    <section className="format-faq" aria-labelledby="format-faq-heading"><h2 id="format-faq-heading">{guide.faqTitle}</h2><div className="format-faq-items">{content.faq.map((faq,index)=><article key={faq.question}>
      {format==='f3'&&<strong className="format-answer-fact">{index===0?'10':'Гостем'}</strong>}
      <div className="format-answer-copy"><h3>{faq.question}</h3><p>{faq.answer}</p></div>
    </article>)}</div></section>
    <section className="format-method" aria-labelledby="format-method-heading"><header><ReferenceIcon name="movie" size={42}/><h2 id="format-method-heading">Как собран набор</h2></header><div className="format-method-copy"><p>{content.collectionMethod.text}</p><div className="format-sources">{content.collectionMethod.sources.map(source=><a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}<ArrowRight size={17}/></a>)}</div></div></section>
  </div>
}
