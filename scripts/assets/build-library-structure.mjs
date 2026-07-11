import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SOURCE_DIR = path.join(ROOT, 'public', 'data')
const TARGET_ROOT = path.join(SOURCE_DIR, 'libraries')

const LIBRARIES = [
  {
    key: 'movies',
    sourceFile: 'movies.generated.json',
    idKey: 'id',
  },
  {
    key: 'series',
    sourceFile: 'series.generated.json',
    idKey: 'id',
  },
  {
    key: 'animes',
    sourceFile: 'animes.generated.json',
    idKey: 'id',
  },
  {
    key: 'games',
    sourceFile: 'games.generated.json',
    idKey: 'id',
  },
  {
    key: 'diagnoses',
    sourceFile: 'diagnoses.generated.json',
    idKey: 'id',
    extraFiles: [
      {
        sourceFile: 'diagnosis-case-vignettes.by-id.json',
        targetFile: 'case-vignettes.by-id.json',
        sortBy: 'diagnosisId',
      },
    ],
  },
]

const normalize = (value) => String(value ?? '')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()

const tokenize = (value) => normalize(value)
  .split(/\s+/)
  .map((token) => token.trim())
  .filter((token) => token.length >= 2)

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const sortByKey = (items, key) => [...items].sort((a, b) => String(a?.[key] ?? '').localeCompare(String(b?.[key] ?? ''), 'ru-RU'))

const sortLibraryItems = (items) => [...items].sort((a, b) => {
  const titleA = String(a?.titleRu ?? a?.titleOriginal ?? a?.id ?? '')
  const titleB = String(b?.titleRu ?? b?.titleOriginal ?? b?.id ?? '')
  const byTitle = titleA.localeCompare(titleB, 'ru-RU')
  if (byTitle !== 0) return byTitle
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''), 'ru-RU')
})

const buildSearchIndex = (libraryName, items, idKey) => {
  const tokenMap = new Map()

  const docs = items.map((item) => {
    const id = String(item?.[idKey] ?? '')
    const names = [
      item?.titleRu,
      item?.titleOriginal,
      ...(Array.isArray(item?.alternativeTitles) ? item.alternativeTitles : []),
      ...(Array.isArray(item?.icd10) ? item.icd10 : []),
      ...(Array.isArray(item?.bodySystems) ? item.bodySystems : []),
    ].filter(Boolean)

    const seenTokens = new Set()
    for (const name of names) {
      for (const token of tokenize(name)) {
        if (!token || seenTokens.has(token)) continue
        seenTokens.add(token)
        const current = tokenMap.get(token)
        if (current) {
          current.push(id)
        } else {
          tokenMap.set(token, [id])
        }
      }
    }

    return {
      id,
      titleRu: item?.titleRu ?? null,
      titleOriginal: item?.titleOriginal ?? null,
      alternativeTitles: Array.isArray(item?.alternativeTitles) ? item.alternativeTitles : [],
      year: Number.isFinite(item?.year) ? item.year : null,
      topRank: Number.isFinite(item?.topRank) ? item.topRank : null,
      steamAppId: item?.steamAppId ?? null,
      icd10: Array.isArray(item?.icd10) ? item.icd10 : [],
    }
  })

  const tokenEntries = [...tokenMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'ru-RU'))
    .map(([token, ids]) => [token, [...new Set(ids)].sort((x, y) => x.localeCompare(y, 'ru-RU'))])

  return {
    version: 1,
    library: libraryName,
    generatedAt: new Date().toISOString(),
    totalItems: docs.length,
    tokensCount: tokenEntries.length,
    docs,
    tokenToIds: Object.fromEntries(tokenEntries),
  }
}

const main = () => {
  const summary = {
    generatedAt: new Date().toISOString(),
    root: 'public/data/libraries',
    libraries: [],
  }

  for (const library of LIBRARIES) {
    const sourcePath = path.join(SOURCE_DIR, library.sourceFile)
    const targetDir = path.join(TARGET_ROOT, library.key)
    const targetItemsPath = path.join(targetDir, 'items.json')
    const targetSearchIndexPath = path.join(targetDir, 'search-index.json')

    const rawItems = readJson(sourcePath)
    if (!Array.isArray(rawItems)) {
      throw new Error(`Expected array in ${library.sourceFile}`)
    }

    const items = sortLibraryItems(rawItems)
    writeJson(targetItemsPath, items)

    const searchIndex = buildSearchIndex(library.key, items, library.idKey)
    writeJson(targetSearchIndexPath, searchIndex)

    if (Array.isArray(library.extraFiles)) {
      for (const extra of library.extraFiles) {
        const extraSourcePath = path.join(SOURCE_DIR, extra.sourceFile)
        const extraTargetPath = path.join(targetDir, extra.targetFile)
        const extraRaw = readJson(extraSourcePath)
        if (!Array.isArray(extraRaw)) {
          throw new Error(`Expected array in ${extra.sourceFile}`)
        }
        const sortedExtra = extra.sortBy ? sortByKey(extraRaw, extra.sortBy) : extraRaw
        writeJson(extraTargetPath, sortedExtra)
      }
    }

    summary.libraries.push({
      key: library.key,
      source: `public/data/${library.sourceFile}`,
      itemsFile: `public/data/libraries/${library.key}/items.json`,
      searchIndexFile: `public/data/libraries/${library.key}/search-index.json`,
      count: items.length,
    })

    console.log(`${library.key}: ${items.length}`)
  }

  writeJson(path.join(TARGET_ROOT, 'index.json'), summary)
  console.log(`Catalog index: public/data/libraries/index.json`)
}

main()
