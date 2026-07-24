import assert from 'node:assert/strict'
import test from 'node:test'
import { applySeriesOverride } from './manual-overrides.mjs'

test('applies creator overrides by stable id without dropping existing metadata', () => {
  const item = {
    id: 'kp_1',
    mode: 'series',
    titleRu: 'Сериал',
    showrunners: [{ nameRu: 'Ошибочный автор' }],
    dataQuality: { source: ['catalog'] },
  }
  const result = applySeriesOverride(item, {
    byId: { kp_1: { showrunners: [{ nameRu: 'Верный автор' }], notes: ['manual'] } },
  })

  assert.deepEqual(result.showrunners, [{ nameRu: 'Верный автор' }])
  assert.equal(result.titleRu, 'Сериал')
  assert.deepEqual(result.dataQuality.source, ['catalog', 'series_manual_overrides'])
})
