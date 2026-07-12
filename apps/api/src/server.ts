import { loadConfig } from '@shoditsa/config'
import { buildApp } from './app.js'

const config = loadConfig()
const app = await buildApp({ config })

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Graceful shutdown started')
  await app.close()
  process.exit(0)
}
process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGINT', () => void shutdown('SIGINT'))

try {
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  app.log.fatal({ err: error }, 'API startup failed')
  process.exit(1)
}
