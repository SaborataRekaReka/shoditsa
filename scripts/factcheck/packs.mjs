const commonIdentityFields = ['id', 'mode', 'titleRu', 'titleOriginal', 'alternativeTitles']

const pack = ({
  identityFields = [],
  dependencies = {},
  criticalFields = [],
  sourcePolicy,
  semantics = [],
  webSearch = true,
  rules = () => [],
}) => ({
  identityFields: [...new Set([...commonIdentityFields, ...identityFields])],
  dependencies,
  criticalFields: new Set(criticalFields),
  sourcePolicy,
  semantics,
  webSearch,
  rules,
})

const text = (value) => String(value ?? '').trim()
const normalized = (value) => text(value).toLocaleLowerCase('ru-RU')
const strings = (value) => Array.isArray(value) ? value.map(text).filter(Boolean) : []
const canonicalSet = (value, aliases) => new Set(strings(value).map((entry) => aliases[normalized(entry)] ?? normalized(entry)))
const includesAny = (values, expected) => [...values].some((value) => expected.has(value))

const finding = (item, definition) => ({
  ruleId: definition.ruleId,
  mode: text(item.mode) || definition.mode || 'unknown',
  cardId: text(item.id) || null,
  title: text(item.titleRu || item.titleOriginal) || null,
  fields: definition.fields,
  status: definition.status ?? 'contradiction',
  severity: definition.severity,
  confidence: definition.confidence ?? 1,
  message: definition.message,
  current: definition.current ?? Object.fromEntries(definition.fields.map((field) => [field, item[field] ?? null])),
  evidence: definition.evidence ?? [],
  likelyCause: definition.likelyCause ?? null,
  suggestedRemediation: definition.suggestedRemediation ?? null,
  origin: 'deterministic',
})

const CLASS_ALIASES = {
  aves: 'birds', 'птицы': 'birds',
  mammalia: 'mammals', 'млекопитающие': 'mammals',
  insecta: 'insects', 'насекомые': 'insects',
  arachnida: 'arachnids', 'паукообразные': 'arachnids',
  actinopterygii: 'fish', chondrichthyes: 'fish', sarcopterygii: 'fish',
  'лучепёрые рыбы': 'fish', 'лучеперые рыбы': 'fish', 'хрящевые рыбы': 'fish',
}
const LOCOMOTION_ALIASES = {
  walk: 'walk', 'ходьба': 'walk', run: 'run', 'бег': 'run', jump: 'jump', 'прыжки': 'jump',
  climb: 'climb', climbing: 'climb', 'лазание': 'climb', swim: 'swim', 'плавание': 'swim',
  fly: 'fly', flight: 'fly', 'полёт': 'fly', 'полет': 'fly', crawl: 'crawl', 'ползание': 'crawl',
  'limited-movement': 'limited-movement', 'ограниченное движение': 'limited-movement',
}
const COVERING_ALIASES = {
  feathers: 'feathers', 'перья': 'feathers', fur: 'fur', 'шерсть': 'fur', scales: 'scales', 'чешуя': 'scales',
  'smooth-skin': 'smooth-skin', 'гладкая кожа': 'smooth-skin', shell: 'shell', 'раковина': 'shell',
  'moist-skin': 'moist-skin', 'влажная кожа': 'moist-skin', exoskeleton: 'exoskeleton', 'экзоскелет': 'exoskeleton',
  'soft-body': 'soft-body', 'мягкое тело': 'soft-body',
}
const REPRODUCTION_ALIASES = {
  'egg-laying': 'egg-laying', 'яйцекладущее': 'egg-laying', 'яйцекладущие': 'egg-laying',
  'live-birth': 'live-birth', 'живорождение': 'live-birth',
}
const THERMO_ALIASES = {
  endothermic: 'endothermic', 'теплокровное': 'endothermic', ectothermic: 'ectothermic', 'холоднокровное': 'ectothermic',
}
const SIZE_ALIASES = {
  tiny: 'tiny', 'очень маленький': 'tiny', small: 'small', 'маленький': 'small', medium: 'medium', 'средний': 'medium',
  large: 'large', 'крупный': 'large', giant: 'giant', 'гигантский': 'giant',
}

const canonicalScalar = (value, aliases) => aliases[normalized(value)] ?? normalized(value)

const animalRules = (item) => {
  const results = []
  const locomotion = canonicalSet(item.locomotion, LOCOMOTION_ALIASES)
  const bodyCoverings = canonicalSet(item.bodyCoverings, COVERING_ALIASES)
  const reproduction = canonicalScalar(item.reproduction, REPRODUCTION_ALIASES)
  const thermoregulation = canonicalScalar(item.thermoregulation, THERMO_ALIASES)
  const taxonomicClass = canonicalScalar(item.taxonomicClass, CLASS_ALIASES)
  const legDriven = new Set(['walk', 'run', 'jump', 'climb'])
  const legCount = item.legCount == null || item.legCount === '' ? null : Number(item.legCount)

  if (legCount === 0 && includesAny(locomotion, legDriven)) {
    results.push(finding(item, {
      ruleId: 'ANIMAL-LOCOMOTION-001', fields: ['legCount', 'locomotion'], severity: 'critical',
      message: 'A card with zero legs cannot use leg-driven locomotion under the game field semantics.',
      current: { legCount: item.legCount, locomotion: item.locomotion },
      likelyCause: 'A broad taxonomy derivation or an isolated field normalization changed related fields independently.',
      suggestedRemediation: 'Verify the adult animal form, then fix the derivation rule or both fields together.',
    }))
  }
  if (legCount === null && includesAny(locomotion, legDriven)) {
    results.push(finding(item, {
      ruleId: 'ANIMAL-LOCOMOTION-002', fields: ['legCount', 'locomotion'], severity: 'medium', status: 'uncertain',
      message: 'Leg-driven locomotion is present while leg count is unknown.',
      current: { legCount: item.legCount ?? null, locomotion: item.locomotion },
      suggestedRemediation: 'Verify and populate legCount or correct locomotion.',
    }))
  }
  if (taxonomicClass === 'birds') {
    if (legCount !== 2) results.push(finding(item, {
      ruleId: 'ANIMAL-BIRD-001', fields: ['taxonomicClass', 'legCount'], severity: 'high',
      message: 'The typical adult bird card is expected to have two legs.',
    }))
    if (!bodyCoverings.has('feathers')) results.push(finding(item, {
      ruleId: 'ANIMAL-BIRD-002', fields: ['taxonomicClass', 'bodyCoverings'], severity: 'high',
      message: 'A bird card is missing feathers from body coverings.',
    }))
    if (reproduction && reproduction !== 'egg-laying') results.push(finding(item, {
      ruleId: 'ANIMAL-BIRD-003', fields: ['taxonomicClass', 'reproduction'], severity: 'high',
      message: 'A bird card has a reproduction value other than egg-laying.',
    }))
    if (thermoregulation && thermoregulation !== 'endothermic') results.push(finding(item, {
      ruleId: 'ANIMAL-BIRD-004', fields: ['taxonomicClass', 'thermoregulation'], severity: 'high',
      message: 'A bird card has a thermoregulation value other than endothermic.',
    }))
  }
  if (taxonomicClass === 'mammals' && thermoregulation && thermoregulation !== 'endothermic') {
    results.push(finding(item, {
      ruleId: 'ANIMAL-MAMMAL-001', fields: ['taxonomicClass', 'thermoregulation'], severity: 'high',
      message: 'A mammal card has a thermoregulation value other than endothermic.',
    }))
  }
  if (taxonomicClass === 'insects' && legCount !== null && legCount !== 6) {
    results.push(finding(item, {
      ruleId: 'ANIMAL-INSECT-001', fields: ['taxonomicClass', 'legCount'], severity: 'medium', status: 'uncertain', confidence: 0.9,
      message: 'An insect card does not have the usual adult leg count of six; verify whether this is a real exception or a data error.',
    }))
  }
  if (taxonomicClass === 'arachnids' && legCount !== null && legCount !== 8) {
    results.push(finding(item, {
      ruleId: 'ANIMAL-ARACHNID-001', fields: ['taxonomicClass', 'legCount'], severity: 'medium', status: 'uncertain', confidence: 0.9,
      message: 'An arachnid card does not have the usual adult leg count of eight; verify the represented life stage and taxon.',
    }))
  }
  if (taxonomicClass === 'fish' && legCount !== null && legCount !== 0) {
    results.push(finding(item, {
      ruleId: 'ANIMAL-FISH-001', fields: ['taxonomicClass', 'legCount'], severity: 'high',
      message: 'A fish card has a non-zero leg count.',
    }))
  }
  if (Number.isFinite(Number(item.bodyMassKg)) && Number(item.bodyMassKg) > 0 && item.sizeCategory) {
    const mass = Number(item.bodyMassKg)
    const expected = mass < 0.1 ? 'tiny' : mass < 5 ? 'small' : mass < 50 ? 'medium' : mass < 500 ? 'large' : 'giant'
    const current = canonicalScalar(item.sizeCategory, SIZE_ALIASES)
    if (current !== expected) results.push(finding(item, {
      ruleId: 'ANIMAL-SIZE-001', fields: ['bodyMassKg', 'sizeCategory'], severity: 'medium',
      message: `Size category does not match the project mass thresholds; expected ${expected}.`,
      current: { bodyMassKg: item.bodyMassKg, sizeCategory: item.sizeCategory, expected },
      likelyCause: 'Derived field was not rebuilt after body mass changed, or a display mapping is incomplete.',
      suggestedRemediation: 'Recompute sizeCategory from bodyMassKg and verify the localized value mapping.',
    }))
  }
  if (item.scientificName && !/^[A-Z][a-z-]+\s+[a-z][a-z-]+(?:\s+[a-z][a-z-]+)?$/.test(text(item.scientificName))) {
    results.push(finding(item, {
      ruleId: 'ANIMAL-IDENTITY-001', fields: ['scientificName'], severity: 'medium', status: 'uncertain', confidence: 0.85,
      message: 'Scientific name does not match the expected binomial or trinomial form.',
      suggestedRemediation: 'Resolve the exact taxon in the authoritative taxonomy source.',
    }))
  }
  for (const [field, value, aliases] of [
    ['locomotion', item.locomotion, LOCOMOTION_ALIASES],
    ['bodyCoverings', item.bodyCoverings, COVERING_ALIASES],
  ]) {
    for (const entry of strings(value)) {
      if (!aliases[normalized(entry)]) results.push(finding(item, {
        ruleId: 'ANIMAL-VOCABULARY-001', fields: [field], severity: 'low', status: 'uncertain', confidence: 0.8,
        message: `Unrecognized controlled-vocabulary value in ${field}: ${entry}.`,
        current: { [field]: value },
        likelyCause: 'A raw pipeline value or a new editorial value bypassed the controlled vocabulary mapping.',
        suggestedRemediation: 'Confirm the meaning, then add a canonical mapping or correct the source value.',
      }))
    }
  }
  for (const [field, value] of [['locomotion', item.locomotion], ['bodyCoverings', item.bodyCoverings], ['sizeCategory', [item.sizeCategory]]]) {
    for (const entry of strings(value)) {
      if (/^[a-z][a-z-]*$/.test(entry) && /[А-Яа-яЁё]/.test(text(item.titleRu))) results.push(finding(item, {
        ruleId: 'ANIMAL-VOCABULARY-002', fields: [field], severity: 'low', status: 'contradiction',
        message: `Raw technical vocabulary value was materialized into a Russian card: ${entry}.`,
        current: { [field]: item[field] }, likelyCause: 'The runtime localization mapping is incomplete.',
        suggestedRemediation: 'Add the canonical runtime localization and rebuild the library.',
      }))
    }
  }
  return results
}

const sourcePolicies = {
  movie: 'Prefer exact Kinopoisk/IMDb identifiers, distributor or studio records, and authoritative film databases. Distinguish release dates by territory and cut.',
  series: 'Prefer exact Kinopoisk/IMDb identifiers, network or streaming service records, and authoritative series databases. Treat season and episode counts as time-sensitive.',
  anime: 'Prefer the exact Shikimori/MAL identifier and official studio or broadcaster records. Distinguish TV series, films, OVA, ONA, and specials.',
  game: 'Prefer official publisher/developer/store pages and exact platform identifiers. Distinguish original release, ports, remasters, and regional dates.',
  music: 'Prefer official artist/label pages and authoritative music databases using exact artist identifiers. Distinguish solo artists, groups, aliases, and activity periods.',
  diagnosis: 'Use official clinical classifications, public-health agencies, and current clinical guidelines. Never treat model confidence as medical evidence; all consequential corrections require human review.',
  city: 'Prefer official statistics, government sources, and authoritative geographic/timezone databases. Record the as-of date for population, ranks, and administrative status.',
  animal: 'Prefer exact scientific-name matches in authoritative taxonomy and trait databases. Verify the typical adult form; distinguish anatomy, habitual locomotion, habitat, and exceptional behavior.',
  book: 'Prefer publisher, library authority, copyright/catalog, and author records. Distinguish original publication from translations and later editions.',
  character: 'Prefer the primary work and identify the canon, adaptation, edition, or continuity. Do not merge facts across incompatible versions.',
  danetki: 'Check internal logical consistency between condition, solution, key facts, hints, and answer rules. External sources are needed only for real-world claims.',
  connections: 'Check that every tile belongs to exactly one intended group, group explanations are unambiguous, and no alternative grouping breaks the puzzle.',
  custom: 'Prefer exact entity identifiers and primary or authoritative sources appropriate to the domain. Record dates for volatile facts and expose source conflicts.',
}

export const COMMON_DEPENDENCIES = {
  year: ['endYear'], endYear: ['year'],
  titleRu: ['titleOriginal', 'alternativeTitles'], titleOriginal: ['titleRu', 'alternativeTitles'],
  allowedInGame: ['contentStatus', 'reviewStatus'], contentStatus: ['allowedInGame', 'reviewStatus'],
}

export const FACTCHECK_PACKS = {
  movie: pack({ identityFields: ['kinopoiskId', 'imdbId'], dependencies: { year: ['endYear'], runtimeMinutes: ['year'], ratings: ['kinopoiskId', 'imdbId'] }, criticalFields: ['titleRu', 'year', 'kinopoiskId', 'imdbId', 'directors'], sourcePolicy: sourcePolicies.movie }),
  series: pack({ identityFields: ['kinopoiskId', 'imdbId'], dependencies: { year: ['endYear', 'seriesStatus'], seasonsCount: ['episodes', 'seriesStatus'], episodes: ['seasonsCount', 'seriesStatus'] }, criticalFields: ['titleRu', 'year', 'endYear', 'seasonsCount', 'episodes'], sourcePolicy: sourcePolicies.series }),
  anime: pack({ identityFields: ['shikimoriId', 'shikimoriUrl'], dependencies: { episodes: ['animeEpisodesAired', 'animeStatus', 'animeKind'], year: ['animeStatus', 'animeKind'] }, criticalFields: ['titleRu', 'year', 'animeKind', 'episodes', 'shikimoriId'], sourcePolicy: sourcePolicies.anime }),
  game: pack({ identityFields: ['steamAppId', 'steamUrl'], dependencies: { year: ['platforms', 'developers', 'publishers'], platforms: ['year', 'developers', 'publishers'] }, criticalFields: ['titleRu', 'year', 'developers', 'platforms'], sourcePolicy: sourcePolicies.game }),
  music: pack({ identityFields: ['musicLinks', 'aliases'], dependencies: { activityStartYear: ['endYear', 'musicIsActive', 'musicType'], endYear: ['activityStartYear', 'musicIsActive'] }, criticalFields: ['titleRu', 'musicType', 'activityStartYear'], sourcePolicy: sourcePolicies.music }),
  diagnosis: pack({ identityFields: ['icd10'], dependencies: { icd10: ['icdGroup', 'titleRu'], symptoms: ['diagnostics', 'urgency', 'severity'], urgency: ['severity', 'course'] }, criticalFields: ['titleRu', 'icd10', 'symptoms', 'diagnostics', 'urgency'], sourcePolicy: sourcePolicies.diagnosis }),
  city: pack({ identityFields: ['country'], dependencies: { country: ['continent', 'capital'], population: ['country'], timezone: ['country', 'continent'], capital: ['country'] }, criticalFields: ['titleRu', 'country', 'continent', 'capital', 'timezone'], sourcePolicy: sourcePolicies.city }),
  animal: pack({
    identityFields: ['scientificName'],
    dependencies: {
      scientificName: ['taxonomicClass', 'animalOrder', 'animalFamily'],
      taxonomicClass: ['scientificName', 'animalOrder', 'animalFamily', 'bodyCoverings', 'legCount', 'thermoregulation', 'reproduction'],
      legCount: ['scientificName', 'taxonomicClass', 'animalOrder', 'animalFamily', 'locomotion', 'lifestyles'],
      locomotion: ['scientificName', 'taxonomicClass', 'animalOrder', 'animalFamily', 'legCount', 'lifestyles', 'habitats'],
      bodyMassKg: ['scientificName', 'sizeCategory'], sizeCategory: ['scientificName', 'bodyMassKg'],
      reproduction: ['scientificName', 'taxonomicClass', 'animalOrder'],
      habitats: ['scientificName', 'lifestyles', 'animalContinents'], animalContinents: ['scientificName', 'habitats'],
      soundUrl: ['scientificName', 'soundType'], silhouetteUrl: ['scientificName', 'mediaAttribution'],
    },
    criticalFields: ['titleRu', 'scientificName', 'taxonomicClass', 'locomotion', 'legCount'],
    sourcePolicy: sourcePolicies.animal,
    semantics: [
      'legCount is the anatomical leg count of the typical adult form; null means unknown and zero means confirmed absence.',
      'locomotion contains habitual movement modes, not a rare physical possibility.',
      'All life-stage, sex, regional, and domesticated-form exceptions must be stated explicitly.',
    ],
    rules: animalRules,
  }),
  book: pack({ identityFields: ['bookAuthors'], dependencies: { bookPublicationYear: ['year', 'bookAuthors'], hasAdaptation: ['bookAdaptationCount', 'bookAdaptationYears'], hasAwards: ['bookAwards'] }, criticalFields: ['titleRu', 'bookAuthors', 'bookPublicationYear'], sourcePolicy: sourcePolicies.book }),
  character: pack({
    identityFields: ['characterSourceWork', 'characterSourceAuthor'],
    dependencies: {
      characterFirstAppearanceYear: ['characterSourceWork', 'characterSourceAuthor', 'characterEra'],
      characterAbilities: ['characterSourceWork', 'characterNature'],
      characterGender: ['characterNature', 'characterAgeGroup'],
      titleOriginal: ['characterSourceWork', 'acceptedAnswers'],
      acceptedAnswers: ['titleRu', 'titleOriginal', 'aliases'],
    },
    criticalFields: ['titleRu', 'characterSourceWork', 'characterFirstAppearanceYear'],
    sourcePolicy: sourcePolicies.character,
    semantics: [
      'titleRu, titleOriginal, aliases, and acceptedAnswers identify the character, not the title of the source work. Do not replace a character name with a tale, novel, film, or collection title.',
      'characterSourceWork is the source work or collection. Preserve the card language and localization style when proposing its title.',
      'characterGender is the game gender category and must not contain a species, creature type, age label, or characterNature value.',
      'characterFirstAppearanceYear is the first documented appearance of this character or source tale, not the publication year of an unrelated collection.',
    ],
  }),
  danetki: pack({ identityFields: ['condition', 'solution'], dependencies: { condition: ['solution', 'keyFacts', 'answerRules'], hints: ['condition', 'solution', 'keyFacts'], answerRules: ['condition', 'solution'] }, criticalFields: ['condition', 'solution', 'answerRules'], sourcePolicy: sourcePolicies.danetki, webSearch: false }),
  connections: pack({ identityFields: ['tiles', 'groups'], dependencies: { tiles: ['groups', 'editorial'], groups: ['tiles', 'editorial'] }, criticalFields: ['tiles', 'groups'], sourcePolicy: sourcePolicies.connections, webSearch: false }),
  custom: pack({ sourcePolicy: sourcePolicies.custom }),
}

export const packForMode = (mode) => FACTCHECK_PACKS[mode] ?? FACTCHECK_PACKS.custom

export const expandDependencies = (mode, requestedFields) => {
  const selected = new Set(requestedFields)
  if (selected.has('*')) return ['*']
  const dependencies = { ...COMMON_DEPENDENCIES, ...packForMode(mode).dependencies }
  const queue = [...selected]
  while (queue.length) {
    const field = queue.shift()
    for (const dependency of dependencies[field] ?? []) {
      if (selected.has(dependency)) continue
      selected.add(dependency)
      queue.push(dependency)
    }
  }
  return [...selected]
}

export const severityForField = (mode, field) => packForMode(mode).criticalFields.has(field) ? 'high' : 'medium'
