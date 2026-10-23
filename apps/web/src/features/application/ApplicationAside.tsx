import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Feature controllers own contextual content while the shared frame owns its placement. */
export function ApplicationAside({ children }: { children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [slot, setSlot] = useState<Element | null>(null)
  useLayoutEffect(() => { setSlot(anchor.current?.closest('.application-frame')?.querySelector('.application-aside-slot') ?? null) }, [])
  return <><span hidden ref={anchor} />{slot && createPortal(children, slot)}</>
}
