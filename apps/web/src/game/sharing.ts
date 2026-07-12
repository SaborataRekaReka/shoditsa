export type ShareResult = 'native-completed' | 'native-cancelled' | 'copied' | 'failed'

export const shareTextWithFallback = async (title: string, text: string, url: string): Promise<ShareResult> => {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url })
      return 'native-completed'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'native-cancelled'
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`)
    return 'copied'
  } catch {
    return 'failed'
  }
}

export const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
