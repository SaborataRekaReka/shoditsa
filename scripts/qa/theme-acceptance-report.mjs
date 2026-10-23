import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import sharp from 'sharp'

const directory = resolve(process.argv[2] ?? 'qa/release-theme-acceptance-2026-10-21')
const candidate = process.argv[3] ?? null
const records = JSON.parse(await readFile(join(directory, 'measurements.json'), 'utf8'))
for (const file of await readdir(join(directory, 'records'))) records.push(JSON.parse(await readFile(join(directory, 'records', file), 'utf8')))
const latest = new Map()
for (const record of records) {
  if (candidate && record.candidate !== candidate) continue
  if (!record.file.startsWith(`${record.tone}-${record.width}-`)) continue
  const previous = latest.get(record.file)
  if (!previous || !previous.capturedAt || record.capturedAt && record.capturedAt > previous.capturedAt) latest.set(record.file, record)
}
const valid = []
for (const record of latest.values()) {
  const metadata = await sharp(join(directory, record.file)).metadata()
  // Desktop CDP emulation verifies layout, but the native panel may crop that
  // virtual viewport at OS scaling. Use separate un-emulated desktop evidence.
  const nativeScaledViewport = record.captureMethod === 'native-viewport' && Math.abs(metadata.width - record.width) <= 15 && Math.abs(metadata.width / record.width - metadata.height / 844) < .02
  const screenshotUsable = record.width < 600 ? (metadata.width === record.width || nativeScaledViewport) && metadata.height >= 800 : record.captureMethod === 'native-viewport' && Math.abs(metadata.width - record.width) <= 30 && metadata.height >= 500
  valid.push({ ...record, screenshotUsable })
}
valid.sort((a, b) => a.file.localeCompare(b.file))
await writeFile(join(directory, 'coverage-final.json'), JSON.stringify(valid, null, 2))
await writeFile(join(directory, 'coverage-final.csv'), ['name,path,tone,width,text_checks,contrast_findings,horizontal_overflow,screenshot', ...valid.map(r => [r.name, r.path, r.tone, r.width, r.checked, r.findings.filter(f => !f.disabled).length, Math.max(0, r.scroll - r.client), r.file].join(','))].join('\n'))
const groups = new Map()
for (const record of valid) {
  const key = `${record.tone}-${record.width}`
  const group = groups.get(key) ?? []
  group.push(record); groups.set(key, group)
}
await mkdir(join(directory, 'contact-sheets'), { recursive: true })
for (const [key, records] of groups) {
  records.sort((a, b) => a.name.localeCompare(b.name))
  const usable = records.filter(record => record.screenshotUsable)
  for (let start = 0; start < usable.length; start += 16) {
    const group = usable.slice(start, start + 16)
    const width = key.endsWith('390') ? 195 : 360
    const height = key.endsWith('390') ? 422 : 250
    const tiles = []
    for (let index = 0; index < group.length; index++) {
      const left = (index % 4) * width, top = Math.floor(index / 4) * (height + 25)
      tiles.push({ input: await sharp(join(directory, group[index].file)).resize(width, height, { fit: 'contain', background: '#777' }).png().toBuffer(), left, top: top + 25 })
      tiles.push({ input: Buffer.from(`<svg width="${width}" height="25"><rect width="100%" height="100%" fill="#eee"/><text x="5" y="17" font-size="11" font-family="Arial">${group[index].name}</text></svg>`), left, top })
    }
    await sharp({ create: { width: width * 4, height: (height + 25) * Math.ceil(group.length / 4), channels: 3, background: '#777' } }).composite(tiles).png().toFile(join(directory, 'contact-sheets', `${key}-${start / 16 + 1}.png`))
  }
}
const summary = {
  candidate,
  routeWidthThemeCases: valid.length,
  usableScreenshotCases: valid.filter(record => record.screenshotUsable).length,
  nativeDesktopEvidence: (await readdir(directory)).filter(file => /^final-.*-desktop-.*\.png$/.test(file)),
  structuralIssues: valid.filter(record => record.name.startsWith('session-') && record.newShell && (!record.newShell.navigation || !record.newShell.playerHeader || !record.newShell.content)).map(record => ({ name: record.name, tone: record.tone, width: record.width, newShell: record.newShell })),
  sessionsWithoutPositiveShellCheck: valid.filter(record => record.name.startsWith('session-') && !record.newShell).map(record => record.file),
  unresolvedAppearanceRoles: valid.filter(record => record.appearanceRoles && Object.values(record.appearanceRoles).some(value => !value)).map(record => ({ file: record.file, roles: record.appearanceRoles })),
  byThemeAndWidth: Object.fromEntries([...groups].map(([key, group]) => [key, group.length])),
  textChecks: valid.reduce((count, record) => count + record.checked, 0),
  issues: valid.filter(r => r.findings.some(f => !f.disabled) || r.scroll > r.client || r.legacyVisible?.length || r.headerOverflow?.length || r.images?.some(image => image.broken)).map(r => ({ name: r.name, tone: r.tone, width: r.width, findings: r.findings.filter(f => !f.disabled), overflow: r.scroll - r.client, headerOverflow: r.headerOverflow, legacy: r.legacyVisible, images: r.images?.filter(image => image.broken) })),
}
await writeFile(join(directory, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary))
