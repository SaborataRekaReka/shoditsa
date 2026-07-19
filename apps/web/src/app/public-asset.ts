const stripAssetPrefix = (path: string) => path.replace(/^(?:\.\/|\/)+/, '')

/**
 * Resolves an asset from `public/` against Vite's deployment base.
 * Hosted builds use root-relative URLs; autonomous Yandex builds keep URLs
 * relative to the ZIP entry point.
 */
export function joinPublicAssetUrl(path: string, baseUrl: string) {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return `${normalizedBase}${stripAssetPrefix(path)}`
}

export function publicAssetUrl(path: string) {
  return joinPublicAssetUrl(path, import.meta.env.BASE_URL)
}
