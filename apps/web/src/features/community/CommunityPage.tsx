import { PageHeading } from '../../components/ui/PageHeading'
import { useContext, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { AppHeader, type AppHeaderProps } from '../../components/app-shell/AppShell'
import { localPresentationLink } from '../../app/local-presentation'
import { EmbeddedApplicationContext } from '../application/EmbeddedApplicationContext'
import './CommunityPage.css'

export function CommunityPage({ title, intro, children, backHref = '/', backLabel = 'На главную', ...headerProps }: AppHeaderProps & {
  title: string
  intro: string
  children: ReactNode
  backHref?: string
  backLabel?: string
}) {
  const embedded = useContext(EmbeddedApplicationContext)
  return <>
    <AppHeader {...headerProps} />
    <main className="community-page">
      {(!embedded || backHref !== '/') && <a className="community-page__back" href={localPresentationLink(backHref)}><ArrowLeft size={18} aria-hidden="true" />{backLabel}</a>}
      <PageHeading title={title} description={intro} />
      {children}
    </main>
  </>
}
