const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value]
const finiteOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value))
const round = (value, digits = 2) => Number(value.toFixed(digits))
const hasValue = (value) => Array.isArray(value)
  ? value.length > 0
  : value !== null && value !== undefined && value !== ''

export const ANIMAL_SCHEMA_VERSION = 1

export const CORE_CRITERIA_KEYS = [
  'taxonomicClass',
  'bodyCoverings',
  'habitats',
  'lifestyles',
  'continents',
  'diets',
  'locomotion',
  'sizeCategory',
]

export const createEmptyAnimal = ({ id, wikidataId }) => ({
  schemaVersion: ANIMAL_SCHEMA_VERSION,
  id,
  status: 'draft',
  identity: {
    commonNameRu: '',
    commonNameEn: '',
    scientificName: '',
    acceptedScientificName: '',
    aliasesRu: [],
    wikidataId,
    gbifKey: null,
    hagrid: null,
  },
  taxonomy: {
    kingdom: '',
    phylum: '',
    taxonomicClass: '',
    order: '',
    family: '',
    genus: '',
    species: '',
    rank: '',
    status: '',
    extinct: null,
  },
  criteria: {
    taxonomicClass: '',
    bodyCoverings: [],
    habitats: [],
    lifestyles: [],
    continents: [],
    climateZones: [],
    diets: [],
    activity: [],
    locomotion: [],
    sizeCategory: '',
    reproduction: '',
    sociality: [],
    legCount: null,
    thermoregulation: '',
    migration: '',
    relationToHumans: [],
  },
  measurements: {
    bodyMassKg: null,
    bodyMassSourceKind: '',
    bodyLengthCm: { min: null, max: null },
    shoulderHeightCm: { min: null, max: null },
    lifespanYears: {
      typicalMin: null,
      typicalMax: null,
      maximumObserved: null,
      maximumObservedContext: '',
    },
    lifespanCategory: '',
    maturityDays: { female: null, male: null },
    gestationOrIncubationDays: null,
    litterOrClutchSize: null,
  },
  ecology: {
    dietCompositionPercent: {},
    foragingStratum: '',
    prey: [],
    predators: [],
    interactionCandidates: {
      prey: [],
      predators: [],
    },
    relatives: [],
    conservation: {
      statusId: null,
      statusLabelRu: '',
      source: '',
    },
  },
  hints: {
    sounds: [],
    silhouettes: [],
    rangeMaps: [],
    distinctiveTraitsRu: [],
    defensesRu: [],
    sensesRu: [],
    comparisonsRu: [],
    finalLetterHintRu: '',
  },
  media: {
    primaryImage: null,
    gallery: [],
    videos: [],
  },
  popularity: {
    wikidataSitelinks: 0,
    ruWikipediaTitle: '',
    ruWikipediaPageviews365d: null,
    wordstatMonthlySearches: null,
  },
  gameplay: {
    impressions: 0,
    uniquePlayers: 0,
    solveRate: null,
    medianHintsToSolve: null,
    medianAnswerTimeSeconds: null,
    skipRate: null,
    abandonmentRate: null,
    lastMeasuredAt: null,
  },
  selection: {
    familiarityScore: 0,
    playabilityScore: 0,
    distinctivenessScore: 0,
    delightScore: 0,
    totalScore: 0,
    difficulty: 'hard',
    eligible: false,
    rejectionReasons: [],
  },
  quality: {
    coreCriteriaCoverage: 0,
    provenanceCoverage: 0,
    warnings: [],
    reviewedAt: null,
    reviewedBy: null,
  },
  provenance: [],
  generatedAt: '',
})

export const deriveSizeCategory = (massKg) => {
  const value = finiteOrNull(massKg)
  if (value === null) return ''
  if (value < 0.1) return 'tiny'
  if (value < 5) return 'small'
  if (value < 50) return 'medium'
  if (value < 500) return 'large'
  return 'giant'
}

export const deriveLifespanCategory = (years) => {
  const value = finiteOrNull(years)
  if (value === null) return ''
  if (value < 5) return 'under-5'
  if (value < 15) return '5-15'
  if (value < 30) return '15-30'
  if (value < 60) return '30-60'
  return 'over-60'
}

export const normalizeGameTaxonomy = (taxonomy = {}, sourceCategories = []) => {
  const normalized = { ...taxonomy }
  const sourceClass = String(taxonomy.taxonomicClass ?? '')
  const sources = new Set(sourceCategories)
  const categoryClass = [
    ['Категория:Млекопитающие', 'Mammalia'],
    ['Категория:Птицы', 'Aves'],
    ['Категория:Рыбы', 'Actinopterygii'],
    ['Категория:Пресмыкающиеся', 'Reptilia'],
    ['Категория:Земноводные', 'Amphibia'],
    ['Категория:Насекомые', 'Insecta'],
    ['Категория:Паукообразные', 'Arachnida'],
  ].find(([category]) => sources.has(category))?.[1]

  if (['Squamata', 'Testudines', 'Crocodylia'].includes(sourceClass)) {
    normalized.taxonomicClass = 'Reptilia'
    if (!normalized.order) normalized.order = sourceClass
  } else if (sourceClass === 'Elasmobranchii') {
    normalized.taxonomicClass = 'Chondrichthyes'
  } else if (!sourceClass && categoryClass) {
    normalized.taxonomicClass = categoryClass
  } else if (!sourceClass && taxonomy.phylum === 'Chordata' && taxonomy.order) {
    // In the current GBIF backbone many ray-finned fish matches omit the class.
    normalized.taxonomicClass = 'Actinopterygii'
  }
  return normalized
}

export const deriveTaxonomyCriteria = (taxonomy = {}) => {
  const taxonomicClass = String(taxonomy.taxonomicClass ?? '')
  const order = String(taxonomy.order ?? '')
  const family = String(taxonomy.family ?? '')
  const criteria = {
    bodyCoverings: [],
    habitats: [],
    lifestyles: [],
    locomotion: [],
    reproduction: '',
    legCount: null,
    thermoregulation: '',
  }

  if (taxonomicClass === 'Mammalia') {
    criteria.bodyCoverings = ['fur']
    criteria.thermoregulation = 'endothermic'
    criteria.reproduction = order === 'Monotremata' ? 'egg-laying' : 'live-birth'
    if (['Cetacea', 'Sirenia'].includes(order)) {
      Object.assign(criteria, { bodyCoverings: ['smooth-skin'], lifestyles: ['aquatic'], locomotion: ['swim'], legCount: 0 })
    } else if (order === 'Chiroptera') {
      Object.assign(criteria, { lifestyles: ['aerial', 'terrestrial'], locomotion: ['fly', 'walk'], legCount: 2 })
    } else if (['Phocidae', 'Otariidae', 'Odobenidae'].includes(family)) {
      Object.assign(criteria, { lifestyles: ['semi-aquatic'], locomotion: ['swim', 'walk'], legCount: 4 })
    } else {
      Object.assign(criteria, { lifestyles: ['terrestrial'], locomotion: ['walk', 'run'], legCount: 4 })
    }
  } else if (taxonomicClass === 'Aves') {
    criteria.bodyCoverings = ['feathers']
    criteria.thermoregulation = 'endothermic'
    criteria.reproduction = 'egg-laying'
    criteria.legCount = 2
    if (order === 'Sphenisciformes') {
      Object.assign(criteria, { lifestyles: ['semi-aquatic'], locomotion: ['swim', 'walk'] })
    } else if (['Struthioniformes', 'Casuariiformes', 'Apterygiformes', 'Rheiformes'].includes(order)) {
      Object.assign(criteria, { lifestyles: ['terrestrial'], locomotion: ['walk', 'run'] })
    } else {
      Object.assign(criteria, { lifestyles: ['aerial', 'terrestrial'], locomotion: ['fly', 'walk'] })
    }
  } else if (['Actinopterygii', 'Chondrichthyes', 'Sarcopterygii'].includes(taxonomicClass)) {
    Object.assign(criteria, {
      bodyCoverings: ['scales'],
      lifestyles: ['aquatic'],
      locomotion: ['swim'],
      reproduction: taxonomicClass === 'Actinopterygii' ? 'egg-laying' : '',
      legCount: 0,
      thermoregulation: 'ectothermic',
    })
  } else if (taxonomicClass === 'Reptilia') {
    criteria.bodyCoverings = order === 'Testudines' ? ['scales', 'shell'] : ['scales']
    criteria.thermoregulation = 'ectothermic'
    if (['Crocodylia', 'Testudines'].includes(order)) {
      Object.assign(criteria, {
        lifestyles: ['semi-aquatic', 'terrestrial'],
        locomotion: ['swim', 'walk'],
        reproduction: 'egg-laying',
        legCount: 4,
      })
    } else {
      Object.assign(criteria, { lifestyles: ['terrestrial'], locomotion: ['walk', 'crawl'] })
    }
  } else if (taxonomicClass === 'Amphibia') {
    Object.assign(criteria, {
      bodyCoverings: ['moist-skin'],
      lifestyles: ['semi-aquatic', 'terrestrial'],
      locomotion: ['swim', 'walk', 'jump'],
      reproduction: 'egg-laying',
      thermoregulation: 'ectothermic',
    })
  } else if (taxonomicClass === 'Insecta') {
    Object.assign(criteria, {
      bodyCoverings: ['exoskeleton'],
      habitats: ['terrestrial'],
      lifestyles: ['terrestrial'],
      locomotion: ['walk'],
      reproduction: 'egg-laying',
      legCount: 6,
      thermoregulation: 'ectothermic',
    })
  } else if (taxonomicClass === 'Arachnida') {
    Object.assign(criteria, {
      bodyCoverings: ['exoskeleton'],
      habitats: ['terrestrial'],
      lifestyles: ['terrestrial'],
      locomotion: ['walk'],
      reproduction: 'egg-laying',
      legCount: 8,
      thermoregulation: 'ectothermic',
    })
  } else if (taxonomicClass === 'Cephalopoda') {
    Object.assign(criteria, {
      bodyCoverings: ['soft-body'],
      habitats: ['marine'],
      lifestyles: ['aquatic'],
      locomotion: ['swim'],
      reproduction: 'egg-laying',
      thermoregulation: 'ectothermic',
    })
  } else if (['Malacostraca', 'Branchiopoda'].includes(taxonomicClass)) {
    Object.assign(criteria, {
      bodyCoverings: ['exoskeleton'],
      locomotion: ['swim', 'walk'],
      reproduction: 'egg-laying',
      thermoregulation: 'ectothermic',
    })
  } else if (taxonomicClass === 'Bivalvia') {
    Object.assign(criteria, {
      bodyCoverings: ['soft-body', 'shell'],
      habitats: ['aquatic'],
      lifestyles: ['aquatic'],
      locomotion: ['limited-movement'],
      reproduction: 'egg-laying',
      thermoregulation: 'ectothermic',
    })
  } else if (taxonomicClass === 'Gastropoda') {
    Object.assign(criteria, {
      bodyCoverings: ['soft-body', 'shell'],
      habitats: order === 'Stylommatophora'
        ? ['terrestrial']
        : ['Nudibranchia', 'Neomphalida'].includes(order)
          ? ['marine']
          : [],
      lifestyles: order === 'Stylommatophora'
        ? ['terrestrial']
        : ['Nudibranchia', 'Neomphalida'].includes(order)
          ? ['aquatic']
          : [],
      locomotion: ['crawl'],
      reproduction: 'egg-laying',
      thermoregulation: 'ectothermic',
    })
  }

  return criteria
}

export const normalizeEltonDiet = (composition = {}) => {
  const animal = ['endothermicVertebrates', 'ectothermicVertebrates', 'fish', 'unknownVertebrates']
    .reduce((sum, key) => sum + Number(composition[key] ?? 0), 0)
  const plants = ['fruit', 'nectar', 'seeds', 'otherPlants']
    .reduce((sum, key) => sum + Number(composition[key] ?? 0), 0)
  const invertebrates = Number(composition.invertebrates ?? 0)
  const scavenging = Number(composition.scavenging ?? 0)
  const categories = []

  if (animal >= 50) categories.push('carnivore')
  if (invertebrates >= 50) categories.push('insectivore')
  if (plants >= 50) categories.push('herbivore')
  if (Number(composition.fruit ?? 0) >= 50) categories.push('frugivore')
  if (Number(composition.nectar ?? 0) >= 50) categories.push('nectarivore')
  if (Number(composition.seeds ?? 0) >= 50) categories.push('granivore')
  if (scavenging >= 20) categories.push('scavenger')
  if (!categories.some((entry) => entry !== 'scavenger')) categories.push('omnivore')

  return [...new Set(categories)]
}

const logNorm = (value, highWatermark) => {
  const number = finiteOrNull(value)
  if (number === null || number <= 0) return null
  return clamp(Math.log1p(number) / Math.log1p(highWatermark), 0, 1)
}

const weightedKnownMean = (entries) => {
  const known = entries.filter(({ value }) => value !== null)
  const weight = known.reduce((sum, entry) => sum + entry.weight, 0)
  if (!weight) return 0
  return known.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / weight
}

export const scoreAnimal = (animal) => {
  const coveredCriteria = CORE_CRITERIA_KEYS.filter((key) => {
    if (key === 'taxonomicClass') return hasValue(animal.criteria.taxonomicClass)
    if (key === 'lifespanCategory') return hasValue(animal.measurements.lifespanCategory)
    return hasValue(animal.criteria[key])
  })
  const coverage = coveredCriteria.length / CORE_CRITERIA_KEYS.length

  const familiarity = weightedKnownMean([
    { value: logNorm(animal.popularity.ruWikipediaPageviews365d, 2_000_000), weight: 0.55 },
    { value: logNorm(animal.popularity.wikidataSitelinks, 300), weight: 0.25 },
    { value: logNorm(animal.popularity.wordstatMonthlySearches, 100_000), weight: 0.20 },
  ]) * 100

  const mediaSignals = [
    Boolean(animal.media.primaryImage),
    animal.hints.sounds.length > 0,
    animal.hints.silhouettes.length > 0,
    animal.hints.rangeMaps.length > 0,
    animal.ecology.prey.length > 0 || animal.ecology.predators.length > 0,
  ]
  const mediaCoverage = mediaSignals.filter(Boolean).length / mediaSignals.length
  const playability = (coverage * 0.72 + mediaCoverage * 0.28) * 100

  const distinctivenessSignals = [
    animal.hints.distinctiveTraitsRu.length > 0,
    animal.hints.defensesRu.length > 0,
    animal.hints.sensesRu.length > 0,
    animal.hints.sounds.length > 0,
    animal.hints.silhouettes.length > 0,
  ]
  const distinctiveness = distinctivenessSignals.filter(Boolean).length / distinctivenessSignals.length * 100

  const delightSignals = [
    animal.hints.sounds.length > 0,
    animal.hints.rangeMaps.length > 0,
    animal.ecology.prey.length >= 3,
    animal.ecology.predators.length > 0,
    animal.hints.distinctiveTraitsRu.length >= 2,
    animal.measurements.bodyMassKg !== null,
    animal.measurements.lifespanYears.maximumObserved !== null,
  ]
  const delight = delightSignals.filter(Boolean).length / delightSignals.length * 100

  const rejectionReasons = []
  if (!animal.identity.commonNameRu) rejectionReasons.push('missing-russian-name')
  else if (!/[А-Яа-яЁё]/.test(animal.identity.commonNameRu)) rejectionReasons.push('missing-russian-display-name')
  if (!animal.identity.acceptedScientificName) rejectionReasons.push('unresolved-taxonomy')
  if (!animal.media.primaryImage) rejectionReasons.push('missing-licensed-image')
  if (animal.taxonomy.extinct === true) rejectionReasons.push('extinct-outside-main-mode')
  if (coverage < 0.7) rejectionReasons.push('core-criteria-below-70-percent')
  const hasIdentitySpecificHint = animal.hints.distinctiveTraitsRu.length > 0
    || animal.hints.sounds.length > 0
    || animal.hints.silhouettes.length > 0
    || animal.hints.rangeMaps.length > 0
  if (!hasIdentitySpecificHint) rejectionReasons.push('missing-identity-specific-hint')

  const total = familiarity * 0.42 + playability * 0.34 + distinctiveness * 0.16 + delight * 0.08
  const difficulty = familiarity >= 70 ? 'easy' : familiarity >= 55 ? 'medium' : 'hard'

  animal.quality.coreCriteriaCoverage = round(coverage * 100)
  animal.selection = {
    familiarityScore: round(familiarity),
    playabilityScore: round(playability),
    distinctivenessScore: round(distinctiveness),
    delightScore: round(delight),
    totalScore: round(total),
    difficulty,
    eligible: rejectionReasons.length === 0,
    rejectionReasons,
  }
  return animal.selection
}

export const calculateProvenanceCoverage = (animal) => {
  const expectedPaths = [
    'identity.commonNameRu',
    'identity.scientificName',
    'identity.acceptedScientificName',
    'taxonomy.taxonomicClass',
    'taxonomy.family',
    'criteria.diets',
    'criteria.activity',
    'measurements.bodyMassKg',
    'measurements.lifespanYears.maximumObserved',
    'media.primaryImage',
  ]
  const paths = new Set(animal.provenance.flatMap((entry) => asArray(entry.fieldPaths)))
  const covered = expectedPaths.filter((path) => paths.has(path)).length
  animal.quality.provenanceCoverage = round(covered / expectedPaths.length * 100)
  return animal.quality.provenanceCoverage
}

export const validateAnimal = (animal) => {
  const errors = []
  if (!animal || typeof animal !== 'object') return ['animal must be an object']
  if (animal.schemaVersion !== ANIMAL_SCHEMA_VERSION) errors.push(`schemaVersion must be ${ANIMAL_SCHEMA_VERSION}`)
  if (!String(animal.id ?? '').startsWith('animal:')) errors.push('id must start with animal:')
  if (!/^Q\d+$/.test(String(animal.identity?.wikidataId ?? ''))) errors.push('identity.wikidataId must be a Wikidata QID')
  if (!animal.identity?.scientificName) errors.push('identity.scientificName is required')
  if (!animal.identity?.acceptedScientificName) errors.push('identity.acceptedScientificName is required')
  if (!animal.taxonomy?.kingdom) errors.push('taxonomy.kingdom is required')
  if (!animal.taxonomy?.taxonomicClass) errors.push('taxonomy.taxonomicClass is required')
  if (!Array.isArray(animal.provenance)) errors.push('provenance must be an array')
  for (const key of ['bodyCoverings', 'habitats', 'lifestyles', 'continents', 'diets', 'activity', 'locomotion']) {
    if (!Array.isArray(animal.criteria?.[key])) errors.push(`criteria.${key} must be an array`)
  }
  return errors
}

export const DEFAULT_SELECTION_POLICY = {
  target: 300,
  reserveTarget: 100,
  classQuotas: {
    Mammalia: { min: 90, max: 115 },
    Aves: { min: 50, max: 65 },
    Actinopterygii: { min: 25, max: 40 },
    Reptilia: { min: 20, max: 32 },
    Amphibia: { min: 10, max: 20 },
    Insecta: { min: 25, max: 40 },
    Arachnida: { min: 8, max: 15 },
    Cephalopoda: { min: 5, max: 12 },
    Other: { min: 15, max: 30 },
  },
  difficultyQuotas: {
    easy: { min: 150, max: 180 },
    medium: { min: 90, max: 120 },
    hard: { min: 20, max: 40 },
  },
  maxPerGenus: 3,
  maxPerFamily: 12,
  minimumTotalScore: 45,
}
