import { createElement, type ComponentType } from 'react'

/** Prepare route code while the current screen remains visible. */
export function preloadableScreen<Props extends object>(loader: () => Promise<{ default: ComponentType<Props> }>) {
  let component: ComponentType<Props> | undefined
  let pending: Promise<void> | undefined
  let failure: unknown
  let failed = false
  const preload = () => {
    if (component) return undefined
    pending ??= loader().then(module => { component = module.default }, error => {
      failed = true
      failure = error
      throw error
    })
    return pending
  }
  function Screen(props: Props) {
    if (failed) throw failure
    if (!component) throw preload()
    return createElement(component, props)
  }
  Screen.preload = preload
  return Screen
}
