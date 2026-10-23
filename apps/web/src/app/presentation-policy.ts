export type PresentationMode = 'legacy' | 'reference' | 'afisha'

/** The application default is explicit; legacy preview preferences remain development-only. */
export function resolvePresentation({ dev, application, configured, requested, saved }: {
  dev: boolean; application?: boolean; configured?: string | null; requested?: string | null; saved?: string | null
}): PresentationMode {
  if (application) return 'reference'
  if (!dev) return 'legacy'
  for (const candidate of [configured, requested, saved]) {
    if (candidate === 'reference' || candidate === 'afisha' || candidate === 'legacy') return candidate
  }
  return 'legacy'
}

export function isPublicPresentationPath(pathname: string) {
  return !/^\/admin(?:\/|$)/.test(pathname) && !/^\/review\/music(?:\/|$)/.test(pathname)
}
