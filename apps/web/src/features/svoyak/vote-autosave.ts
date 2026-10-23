import type { Preferences } from './contracts'

const same = (a: Preferences, b: Preferences) => JSON.stringify([...a.topics].sort()) === JSON.stringify([...b.topics].sort())
export type VoteSaveState = { value: Preferences; pending: boolean; failed: boolean }

/** One request at a time; subsequent clicks replace the queued value, never the in-flight one. */
export class VoteAutosave {
  private timer?: ReturnType<typeof setTimeout>
  private sending = false
  private stopped = false
  private uncertain = false
  private failures = 0
  constructor(private acknowledged: Preferences, private value: Preferences,
    private save: (value: Preferences) => Promise<void>, private changed: (state: VoteSaveState) => void) {}
  get state(): VoteSaveState { return { value: this.value, pending: this.sending || this.uncertain || !same(this.value, this.acknowledged), failed: this.failures > 0 } }
  start() { this.changed(this.state); this.schedule(200) }
  set(value: Preferences) { this.value = value; this.changed(this.state); this.schedule(200) }
  dispose() { this.stopped = true; clearTimeout(this.timer) }
  private schedule(delay: number) {
    clearTimeout(this.timer)
    if (!this.stopped && !this.sending && this.state.pending) this.timer = setTimeout(() => { void this.flush() }, delay)
  }
  private async flush() {
    if (this.stopped || this.sending || !this.state.pending) return
    const snapshot = this.value
    this.sending = true; this.changed(this.state)
    try {
      await this.save(snapshot)
      this.acknowledged = snapshot; this.uncertain = false; this.failures = 0
    } catch {
      // A lost response may still have saved on the server. Always send the latest value again.
      this.uncertain = true; this.failures++
    } finally {
      this.sending = false
      if (!this.stopped) { this.changed(this.state); this.schedule(this.failures ? Math.min(10_000, 1000 * 2 ** (this.failures - 1)) : 0) }
    }
  }
}
