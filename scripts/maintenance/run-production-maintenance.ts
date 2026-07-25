import { loadConfig } from '@shoditsa/config'
import { createDatabase } from '@shoditsa/database'
import { reconcileCommerceOrders } from '../../apps/api/src/modules/commerce/service.js'
import { runContentRetention, runGameLifecycleCleanup } from '../../apps/api/src/modules/maintenance/service.js'

const args = process.argv.slice(2)
const arg = (name: string) => {
  const direct = args.find((value) => value.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const task = arg('--task') ?? 'all'
const apply = args.includes('--apply')
if (!['all', 'lifecycle', 'retention', 'commerce'].includes(task)) {
  throw new Error('Use --task=all|lifecycle|retention|commerce')
}
if ((task === 'commerce' || task === 'all') && !apply) {
  console.warn('Commerce reconciliation is omitted in dry-run because it must query the provider and persist the verified state.')
}

const config = loadConfig()
const { db, client } = createDatabase(config)
try {
  const result: Record<string, unknown> = {
    task,
    dryRun: !apply,
    generatedAt: new Date().toISOString(),
  }
  if (task === 'all' || task === 'lifecycle') result.lifecycle = await runGameLifecycleCleanup(db, new Date(), !apply)
  if (task === 'all' || task === 'retention') result.retention = await runContentRetention(db, new Date(), !apply)
  if (apply && (task === 'all' || task === 'commerce')) result.commerce = await reconcileCommerceOrders(db, config)
  console.log(JSON.stringify(result, null, 2))
} finally {
  await client.end()
}
