/** Local visual preview backed by read-only public rating aggregates.
 * Usage: npx tsx scripts/preview-leaderboard.ts --ssh=root@HOST
 * Does not deploy code, read credentials, or change the remote database.
 */
import { spawn } from 'node:child_process'
import Fastify from 'fastify'
import { LeaderboardQuerySchema, type LeaderboardQuery } from '@shoditsa/contracts'
import { RATING_ACTIVITY_SQL, type RatingActivity } from '../apps/api/src/modules/leaderboard/activity.js'
import { buildLeaderboard, ratingSnapshotExpired } from '../apps/api/src/modules/leaderboard/ranking.js'

const remote = process.argv.find(value => value.startsWith('--ssh='))?.slice(6)
if (!remote || !/^[a-zA-Z0-9_.@-]+$/.test(remote)) throw new Error('Pass --ssh=user@host for the read-only preview')
const port = Number(process.env.LEADERBOARD_PREVIEW_PORT ?? 3003)
const container = process.env.LEADERBOARD_PREVIEW_CONTAINER ?? 'shoditsa-api-shoditsa-postgres-1'
if (!/^[a-zA-Z0-9_-]+$/.test(container)) throw new Error('Invalid container name')

type Snapshot = { players: RatingActivity[]; at: Date }
let pending: Promise<Snapshot> | undefined
async function snapshot(): Promise<Snapshot> {
  if (pending && ratingSnapshotExpired((await pending).at)) pending = undefined
  if (!pending) {
    const request = new Promise<Snapshot>((resolve, reject) => {
      const child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', remote!,
        `docker exec -i ${container} sh -c 'exec psql -XAtq -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`,
      ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      let output = ''
      child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk })
      // Never echo database/SSH diagnostics or connection information into HTTP.
      child.stderr.resume()
      const timer = setTimeout(() => { child.kill(); reject(new Error('Live rating request timed out')) }, 20_000)
      child.once('error', reject)
      child.once('close', code => {
        clearTimeout(timer)
        if (code !== 0) return reject(new Error('Live rating database unavailable'))
        try { resolve({ players: JSON.parse(output), at: new Date() }) }
        catch { reject(new Error('Invalid live rating response')) }
      })
      child.stdin.end(`BEGIN READ ONLY;\n${RATING_ACTIVITY_SQL};\nROLLBACK;\n`)
    })
    pending = request
    request.catch(() => { if (pending === request) pending = undefined })
  }
  return pending
}

const app = Fastify({ logger: false })
app.get<{ Querystring: LeaderboardQuery }>('/api/v1/leaderboard', {
  schema: { querystring: LeaderboardQuerySchema },
}, async (request, reply) => {
  reply.header('Cache-Control', 'no-store')
  try {
    const data = await snapshot()
    return buildLeaderboard(data.players, request.query, null, new Date(), data.at)
  } catch {
    return reply.status(503).send({ code: 'RATING_UNAVAILABLE', message: 'Не удалось загрузить рейтинг. Попробуй ещё раз.' })
  }
})
await app.listen({ host: '127.0.0.1', port })
console.log(`Read-only leaderboard preview: http://127.0.0.1:${port}/api/v1/leaderboard`)
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close().then(() => process.exit(0)) })
