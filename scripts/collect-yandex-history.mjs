// Compatibility entry point used by the existing traffic-audit automation.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const collectorPath = fileURLToPath(new URL(
  '../tools/skills/shoditsa-traffic-audit/scripts/collect-yandex-history.mjs',
  import.meta.url,
));
const result = spawnSync(process.execPath, [collectorPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
if (result.error) {
  console.error(`Unable to start the traffic history collector: ${result.error.message}`);
}
process.exitCode = result.status ?? 1;
