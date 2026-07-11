import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

export const ensureDir = (dirPath) => fs.mkdirSync(dirPath, { recursive: true })

export const writeJsonAtomic = (filePath, value) => {
  ensureDir(path.dirname(filePath))
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    fs.renameSync(temporaryPath, filePath)
  } catch (error) {
    if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error
    fs.rmSync(filePath, { force: true })
    fs.renameSync(temporaryPath, filePath)
  }
}

export const sha256 = (value) => crypto
  .createHash('sha256')
  .update(JSON.stringify(value))
  .digest('hex')

const processExists = (processId) => {
  if (!Number.isInteger(processId) || processId <= 0) return false
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export const acquireLock = (lockPath) => {
  ensureDir(path.dirname(lockPath))
  if (fs.existsSync(lockPath)) {
    let lock = null
    try { lock = readJson(lockPath) } catch {}
    if (processExists(lock?.pid)) {
      throw new Error(`Another enrichment process is running (PID ${lock.pid})`)
    }
    fs.rmSync(lockPath, { force: true })
  }

  const handle = fs.openSync(lockPath, 'wx')
  fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }))
  fs.closeSync(handle)
  return () => fs.rmSync(lockPath, { force: true })
}

export const createEmptyState = (domain) => ({
  schemaVersion: 1,
  domain,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  entities: {},
  runs: [],
})

export const loadState = (statePath, domain) => {
  if (!fs.existsSync(statePath)) return createEmptyState(domain)
  const state = readJson(statePath)
  if (state?.schemaVersion !== 1 || state?.domain !== domain || typeof state?.entities !== 'object') {
    throw new Error(`Unsupported state file: ${statePath}`)
  }
  return state
}

export const saveState = (statePath, state) => {
  state.updatedAt = new Date().toISOString()
  state.runs = Array.isArray(state.runs) ? state.runs.slice(-50) : []
  writeJsonAtomic(statePath, state)
}

export const recoverInterruptedEntities = (state) => {
  let recovered = 0
  for (const entity of Object.values(state.entities)) {
    if (entity.status !== 'running') continue
    entity.status = 'pending'
    entity.lastError = 'Recovered after an interrupted run'
    recovered += 1
  }
  return recovered
}

export const buildQueue = ({ items, state, adapter, refreshDays, retryReview = false, now = Date.now() }) => {
  const refreshMs = refreshDays > 0 ? refreshDays * 24 * 60 * 60 * 1000 : null

  return items.map((item, index) => {
    const key = adapter.entityKey(item, index)
    const fingerprint = sha256(adapter.fingerprintInput(item))
    const previous = state.entities[key]
    let reason = 'new'

    if (previous) {
      if (previous.inputFingerprint !== fingerprint) reason = 'input_changed'
      else if (previous.status === 'failed') {
        const retryAt = Date.parse(previous.nextRetryAt || '')
        reason = !Number.isFinite(retryAt) || retryAt <= now ? 'retry_failed' : 'backoff'
      } else if (previous.status === 'review') reason = retryReview ? 'retry_review' : 'awaiting_review'
      else if (previous.status === 'completed' && refreshMs && now - Date.parse(previous.completedAt || 0) >= refreshMs) {
        reason = 'refresh_due'
      } else if (previous.status === 'completed') reason = 'completed'
      else reason = 'pending'
    }

    return { item, index, key, fingerprint, previous, reason }
  })
}

export const isRunnableQueueItem = (queueItem) => [
  'new',
  'input_changed',
  'retry_failed',
  'retry_review',
  'refresh_due',
  'pending',
].includes(queueItem.reason)

export const summarizeQueue = (queue) => {
  const byReason = {}
  for (const item of queue) byReason[item.reason] = (byReason[item.reason] ?? 0) + 1
  return {
    total: queue.length,
    runnable: queue.filter(isRunnableQueueItem).length,
    byReason,
  }
}

export const retryAt = (attempts) => {
  const delayHours = Math.min(24 * 7, 2 ** Math.max(0, attempts - 1))
  return new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString()
}
