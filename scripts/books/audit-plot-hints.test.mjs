import assert from 'node:assert/strict'
import test from 'node:test'
import { auditBookPlotHints } from './audit-plot-hints.mjs'

const source = [{
  'ID книги': 'book-001',
  'Название': { 'На русском': 'Тестовая книга', 'На языке оригинала': 'Test Book' },
  'Автор': 'Иван Авторов',
  'Главные персонажи': ['Пётр Герой'],
  'Аннотация': 'Исходная аннотация описывает юного архивиста, закрытую башню и карту с исчезающими дорогами, но не раскрывает результат поисков.',
}]

test('accepts a concrete spoiler-free hint that hides identity', () => {
  const hint = 'Юный архивист получает карту, на которой каждую ночь исчезает одна дорога, и запирается в старой башне. До рассвета ему нужно найти единственный маршрут, который ещё ведёт наружу.'
  const report = auditBookPlotHints({ source, hints: [{ id: 'book-001', plotHint: hint }] })
  assert.equal(report.counts.flagged, 0)
})

test('flags title, character, forbidden punctuation and copied annotation', () => {
  const hint = 'Тестовая книга рассказывает, как Пётр Герой ищет выход (но найдёт ли?). Исходная аннотация описывает юного архивиста, закрытую башню и карту с исчезающими дорогами.'
  const report = auditBookPlotHints({ source, hints: [{ id: 'book-001', plotHint: hint }] })
  const codes = report.issues[0].issues.map((issue) => issue.code)
  assert.ok(codes.includes('title-leak'))
  assert.ok(codes.includes('character-leak'))
  assert.ok(codes.includes('forbidden-punctuation'))
  assert.ok(codes.includes('annotation-copy'))
})
