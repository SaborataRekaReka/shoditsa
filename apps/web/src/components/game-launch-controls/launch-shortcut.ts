const interactiveTarget = 'button, a, input, select, textarea, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="option"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [role="tab"], [role="menuitem"]'
const openOverlay = 'dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-haspopup][aria-expanded="true"]'

const isVisible = (element: Element) => element.getClientRects().length > 0
  && getComputedStyle(element).visibility !== 'hidden'
  && !element.closest('[hidden], [inert], [aria-hidden="true"]')

/** Enter is a page shortcut only while the player is not using another control. */
export function bindGameLaunchShortcut(button: HTMLButtonElement) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.defaultPrevented) return
    const target = event.target instanceof Element ? event.target : null
    if (event.repeat || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      // Native button activation also repeats when Enter is held down.
      if (target && button.contains(target)) event.preventDefault()
      return
    }
    if (target?.closest(interactiveTarget)) return
    if (button.disabled || button.getAttribute('aria-disabled') === 'true' || button.getAttribute('aria-busy') === 'true' || !isVisible(button)) return
    if ([...document.querySelectorAll(openOverlay)].some(isVisible)) return
    event.preventDefault()
    button.click()
  }
  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}
