import { useEffect, useRef, useState } from 'react'
import type { Member, Preferences } from './contracts'
import { VoteAutosave, type VoteSaveState } from './vote-autosave'

function draft(member: Member): Preferences {
  try {
    const value = JSON.parse(sessionStorage.getItem(`svoyak:draft:${member.id}`) ?? 'null')
    if (value && Array.isArray(value.topics) && value.topics.every((id: unknown) => typeof id === 'string')) return { topics: value.topics }
  } catch { /* Storage is optional. */ }
  return member.preferences
}
export function useVoteAutosave(member: Member, save: (value: Preferences) => Promise<void>) {
  const initial = useRef({ member, value: draft(member) })
  const saveRef = useRef(save); saveRef.current = save
  const queue = useRef<VoteAutosave | null>(null)
  const [state, setState] = useState<VoteSaveState>(() => ({ value: initial.current.value, pending: JSON.stringify(initial.current.value) !== JSON.stringify(member.preferences), failed: false }))
  useEffect(() => {
    const { member: first, value } = initial.current
    const current = new VoteAutosave(first.preferences, value, next => saveRef.current(next), next => {
      setState(next)
      try {
        if (next.pending) sessionStorage.setItem(`svoyak:draft:${first.id}`, JSON.stringify(next.value))
        else sessionStorage.removeItem(`svoyak:draft:${first.id}`)
      } catch { /* Storage is optional. */ }
    })
    queue.current = current; current.start()
    return () => { current.dispose(); queue.current = null }
  }, [])
  const toggle = (id: string) => {
    const value = queue.current?.state.value ?? state.value
    queue.current?.set({ topics: value.topics.includes(id) ? value.topics.filter(t => t !== id) : [...value.topics, id] })
  }
  return { ...state, toggle }
}
