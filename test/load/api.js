import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  scenarios: {
    sustained: { executor: 'constant-arrival-rate', rate: 20, timeUnit: '1s', duration: '10m', preAllocatedVUs: 100, maxVUs: 150 },
    burst: { executor: 'constant-arrival-rate', rate: 100, timeUnit: '1s', duration: '30s', startTime: '10m10s', preAllocatedVUs: 100, maxVUs: 200 },
  },
  thresholds: { http_req_failed: ['rate<0.01'], 'http_req_duration{endpoint:meta}': ['p(95)<100'], 'http_req_duration{endpoint:search}': ['p(95)<200'] },
}

const base = __ENV.BASE_URL || 'http://127.0.0.1:3001'
export default function () {
  const meta = http.get(`${base}/api/v1/meta`, { tags: { endpoint: 'meta' } })
  check(meta, { 'meta 200': (response) => response.status === 200 })
  const search = http.get(`${base}/api/v1/catalog/search?mode=movie&q=matrix&limit=10`, { tags: { endpoint: 'search' } })
  check(search, { 'search 200': (response) => response.status === 200 })
  sleep(0.1)
}
