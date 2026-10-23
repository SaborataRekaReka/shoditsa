import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import postcss from 'postcss'

const roles = new Map(), lightRoles = new Map()
postcss.parse(await readFile(new URL('../../apps/web/src/styles/reference-tokens.css', import.meta.url), 'utf8')).walkDecls(decl => {
  if (decl.prop.startsWith('--')) lightRoles.set(decl.prop, decl.value)
})
const lightPromo = new Map(), darkPromo = new Map()
postcss.parse(await readFile(new URL('../../apps/web/src/styles/promo-motion.css', import.meta.url), 'utf8')).walkRules(rule => {
  const target = rule.selector.includes("data-quest-tone='dark'") ? darkPromo : lightPromo
  rule.walkDecls(decl => { if (decl.prop.startsWith('--promo-')) target.set(decl.prop, decl.value) })
})
const promoPalettes = [lightPromo, new Map([...lightPromo, ...darkPromo])]
postcss.parse(await readFile(new URL('../../apps/web/src/styles/radix-dark.css', import.meta.url), 'utf8')).walkDecls(decl => {
  if (decl.prop.startsWith('--')) roles.set(decl.prop, decl.value)
})
function resolve(role, chain = [], palette = roles) {
  assert.ok(!chain.includes(role), `Cyclic appearance role: ${[...chain, role].join(' → ')}`)
  const value = palette.get(role)
  assert.ok(value, `Missing appearance role ${role}`)
  const alias = /^var\((--[\w-]+)\)$/.exec(value)
  return alias ? resolve(alias[1], [...chain, role], palette) : value
}
function luminance(hex) {
  assert.match(hex, /^#[a-f\d]{6}$/i)
  const values = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  return values.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a)
  return (values[0] + .05) / (values[1] + .05)
}
const textPairs = [
  ...['--color-bg', '--color-surface', '--color-surface-2', '--color-surface-3', '--color-overlay-surface', '--color-input'].flatMap(bg => [['--color-text', bg], ['--color-text-muted', bg]]),
  ['--color-on-action', '--color-action'], ['--color-on-action', '--color-action-hover'],
  ['--match-exact-ink', '--match-exact-bg'], ['--match-partial-ink', '--match-partial-bg'],
  ['--match-miss-ink', '--match-miss-bg'], ['--match-unknown-ink', '--match-unknown-bg'],
  ['--quest-blue', '--quest-bg'], ['--quest-muted', '--quest-surface'],
]
for (const [fg, bg] of textPairs) test(`${fg} on ${bg} remains readable at normal text sizes`, () => {
  const ratio = contrast(resolve(fg), resolve(bg))
  assert.ok(ratio >= 4.5, `${fg} / ${bg}: ${ratio.toFixed(3)}:1`)
})
test('field boundary and focus remain distinguishable', () => {
  assert.ok(contrast(resolve('--color-input-border'), resolve('--color-input')) >= 3)
  assert.ok(contrast(resolve('--color-focus'), resolve('--color-bg')) >= 3)
})
test('moving promo layers keep readable text even at their brightest source colour', () => {
  for (const palette of promoPalettes) for (const background of ['--promo-canvas', '--promo-fold', '--promo-light', '--promo-orchid', '--promo-mint']) {
    for (const foreground of ['--promo-heading', '--promo-copy', '--promo-link']) {
      const ratio = contrast(palette.get(foreground), palette.get(background))
      assert.ok(ratio >= 4.5, `${foreground} / ${background}: ${ratio.toFixed(3)}:1`)
    }
  }
})

test('light Mauve surfaces, Violet selections and Mint matches preserve normal text contrast', () => {
  const pairs = [
    ...['--color-bg', '--color-surface', '--color-surface-2', '--color-surface-3', '--color-lilac', '--color-mint'].flatMap(bg => [['--color-text', bg], ['--color-text-muted', bg]]),
    ['--color-on-action', '--color-action'], ['--color-on-action', '--color-action-hover'],
    ['--match-exact-ink', '--match-exact-bg'], ['--match-partial-ink', '--match-partial-bg'], ['--match-miss-ink', '--match-miss-bg'],
  ]
  for (const [fg, bg] of pairs) {
    const ratio = contrast(resolve(fg, [], lightRoles), resolve(bg, [], lightRoles))
    assert.ok(ratio >= 4.5, `${fg} / ${bg}: ${ratio.toFixed(3)}:1`)
  }
})
