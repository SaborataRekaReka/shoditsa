import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, relative, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import postcss from 'postcss'

const dot = /[\u00b7\u2022\u2027\u2219\u22c5]/u
const decodeEntities = text => text.replace(/&(?:middot|bull|#(\d+)|#x([\da-f]+));/gi, (entity, decimal, hex) => {
  const code = decimal ? Number(decimal) : hex ? parseInt(hex, 16) : entity.toLowerCase() === '&middot;' ? 183 : 8226
  return code <= 0x10ffff ? String.fromCodePoint(code) : entity
})
const containsSeparator = value => dot.test(decodeEntities(value).replace(/\u2022{4,}/gu, ''))

/** Inspect authored strings, not comments, regex sanitizers or external catalog data. */
export function findDotSeparators(source, filename) {
  const found = []
  const add = (value, line) => { if (containsSeparator(value)) found.push({ line, text: value.trim().slice(0, 100) }) }
  if (filename.endsWith('.css')) {
    postcss.parse(source, { from: filename }).walkDecls('content', decl => {
      add(decl.value.replace(/\\([\da-f]{1,6})\s?/gi, (_, code) => String.fromCodePoint(parseInt(code, 16))), decl.source.start.line)
    })
  } else if (/\.[cm]?[jt]sx?$/.test(filename)) {
    const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true)
    const visit = node => {
      if (ts.isStringLiteral(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) {
        add(node.text, file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  } else {
    source.split('\n').forEach((line, i) => add(line, i + 1))
  }
  return found
}

const roots = ['apps/web/src', 'apps/web/index.html', 'apps/api/src', 'packages/game-core/src', 'scripts/seo', 'scripts/qa', 'scripts/preview-review-fixtures.mjs']
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '.html', '.json'])
function* sources(path) {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) {
      if (!['node_modules', 'dist', '.git', 'mascot-motion'].includes(name)) yield* sources(resolve(path, name))
    }
  } else if (extensions.has(extname(path)) && !/\.(?:test|spec)\./.test(path)) yield path
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const failures = roots.flatMap(root => [...sources(resolve(root))].flatMap(path => findDotSeparators(readFileSync(path, 'utf8'), path).map(issue => `${relative(process.cwd(), path)}:${issue.line} ${issue.text}`)))
  if (failures.length) {
    console.error('Dot separators are not part of the site design. Use layout gaps or natural punctuation.\n' + failures.join('\n'))
    process.exitCode = 1
  } else console.log('UI copy: no dot separators.')
}
