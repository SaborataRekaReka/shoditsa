import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPlotHint, isPlayablePlotHint } from './plot-hint.mjs'

test('buildPlotHint removes the answer without leaving service markers', () => {
  const hint = buildPlotHint({
    title: 'Road Rash',
    text: 'Road Rash is an arcade motorcycle racing game where riders fight opponents, evade police and race through illegal street events.',
    maxLength: 100,
  })

  assert.doesNotMatch(hint, /Road Rash|REDACTED|_KEEP_/i)
  assert.doesNotMatch(hint, /(?:\.\.\.|\u2026)\s*$/)
  assert.equal(isPlayablePlotHint({ title: 'Road Rash', text: hint }), true)
})

test('plot hint validation rejects placeholders and truncated output', () => {
  assert.equal(isPlayablePlotHint({
    title: 'Secret Game',
    text: '[REDACTED] отправляется исследовать опасный мир и сражаться с врагами.',
  }), false)
  assert.equal(isPlayablePlotHint({
    title: 'Secret Game',
    text: 'Герой отправляется исследовать опасный мир и сражаться с врагами...',
  }), false)
})
