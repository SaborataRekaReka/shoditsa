import { RELEASE_SHA_META_NAME } from './release-update'

/** The HTML marker identifies the code actually loaded, including a tab on an older release. */
export const clientAppVersion = () => {
  const deployed = typeof document === 'undefined' ? '' : document.querySelector<HTMLMetaElement>(`meta[name="${RELEASE_SHA_META_NAME}"]`)?.content.trim() ?? ''
  if (/^[0-9a-f]{40}$/i.test(deployed)) return deployed
  const configured = String(import.meta.env.VITE_APP_VERSION || '').trim()
  return configured && configured !== 'dev' ? configured.slice(0, 80) : import.meta.env.DEV ? 'dev' : 'unknown'
}
