export type ShareResult = 'native-completed' | 'native-cancelled' | 'copied' | 'failed'

const copyWithSelectionFallback = (text: string) => {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.append(textarea)
  textarea.focus()
  textarea.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

export const copyText = async (text: string) => {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable')
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return copyWithSelectionFallback(text)
  }
}

export const shareTextWithFallback = async (title: string, text: string, url: string): Promise<ShareResult> => {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url })
      return 'native-completed'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'native-cancelled'
    }
  }
  return await copyText(`${text}\n${url}`) ? 'copied' : 'failed'
}
