import { sql } from 'drizzle-orm'
import {
  boolean, check, date, index, integer, jsonb, pgEnum, pgTable, primaryKey,
  real, smallint, text, timestamp, unique, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'

const now = () => timestamp({ withTimezone: true }).notNull().defaultNow()

export const contentMode = pgEnum('content_mode', ['movie', 'series', 'anime', 'game', 'music', 'diagnosis'])
export const periodKey = pgEnum('period_key', ['all', 'from_1960', 'from_1980', 'from_1990', 'from_2000', 'from_2010', 'from_2020'])
export const difficultyKey = pgEnum('difficulty_key', ['easy', 'medium', 'hard', 'expert'])

// Better Auth schema. IDs are UUIDs so domain foreign keys remain native UUID columns.
export const user = pgTable('user', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text(),
  isAnonymous: boolean('is_anonymous').notNull().default(false),
  createdAt: now(),
  updatedAt: now(),
})

export const session = pgTable('session', {
  id: uuid().primaryKey().defaultRandom(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text().notNull().unique(),
  createdAt: now(),
  updatedAt: now(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, (table) => [index('session_user_idx').on(table.userId)])

export const account = pgTable('account', {
  id: uuid().primaryKey().defaultRandom(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text(),
  password: text(),
  createdAt: now(),
  updatedAt: now(),
}, (table) => [index('account_user_idx').on(table.userId), unique('account_provider_unique').on(table.providerId, table.accountId)])

export const verification = pgTable('verification', {
  id: uuid().primaryKey().defaultRandom(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: now(),
  updatedAt: now(),
}, (table) => [index('verification_identifier_idx').on(table.identifier)])

export const playerProfiles = pgTable('player_profiles', {
  userId: uuid('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  role: text().notNull().default('player'),
  displayName: text('display_name'),
  locale: text().notNull().default('ru'),
  timezone: text().notNull().default('Europe/Moscow'),
  legacyImportedAt: timestamp('legacy_imported_at', { withTimezone: true }),
  createdAt: now(),
  updatedAt: now(),
}, (table) => [check('player_profiles_role_check', sql`${table.role} in ('player','admin')`)])

export const appSettings = pgTable('app_settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  version: integer().notNull().default(1),
  updatedBy: uuid('updated_by').references(() => user.id, { onDelete: 'set null' }),
  updatedAt: now(),
})

export const contentRevisions = pgTable('content_revisions', {
  id: uuid().primaryKey().defaultRandom(),
  version: text().notNull().unique(),
  checksumSha256: text('checksum_sha256').notNull().unique(),
  sourceManifest: jsonb('source_manifest').notNull(),
  status: text().notNull(),
  createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: now(),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
}, (table) => [check('content_revision_status_check', sql`${table.status} in ('importing','ready','active','failed','retired')`)])

export const contentItems = pgTable('content_items', {
  id: text().primaryKey(),
  mode: contentMode().notNull(),
  createdAt: now(),
  updatedAt: now(),
}, (table) => [index('content_items_mode_idx').on(table.mode)])

export const contentItemVersions = pgTable('content_item_versions', {
  id: uuid().primaryKey().defaultRandom(),
  itemId: text('item_id').notNull().references(() => contentItems.id),
  revisionId: uuid('revision_id').notNull().references(() => contentRevisions.id, { onDelete: 'cascade' }),
  mode: contentMode().notNull(),
  titleRu: text('title_ru').notNull(),
  titleOriginal: text('title_original').notNull().default(''),
  normalizedTitle: text('normalized_title').notNull(),
  year: smallint(),
  endYear: smallint('end_year'),
  popularityScore: real('popularity_score').notNull(),
  topRank: integer('top_rank'),
  sortOrder: integer('sort_order').notNull(),
  allowedInGame: boolean('allowed_in_game').notNull().default(true),
  contentStatus: text('content_status'),
  payload: jsonb().notNull(),
  createdAt: now(),
}, (table) => [
  unique('content_item_revision_unique').on(table.itemId, table.revisionId),
  index('content_revision_mode_year_idx').on(table.revisionId, table.mode, table.allowedInGame, table.year),
  index('content_revision_mode_order_idx').on(table.revisionId, table.mode, table.sortOrder),
])

export const contentAliases = pgTable('content_aliases', {
  itemVersionId: uuid('item_version_id').notNull().references(() => contentItemVersions.id, { onDelete: 'cascade' }),
  alias: text().notNull(),
  normalizedAlias: text('normalized_alias').notNull(),
  kind: text().notNull(),
}, (table) => [
  primaryKey({ columns: [table.itemVersionId, table.normalizedAlias] }),
  index('content_alias_item_idx').on(table.itemVersionId),
  index('content_alias_trgm_idx').using('gin', table.normalizedAlias.op('gin_trgm_ops')),
  check('content_alias_kind_check', sql`${table.kind} in ('ru','original','alternative','external')`),
])

export const contentRevisionModes = pgTable('content_revision_modes', {
  revisionId: uuid('revision_id').notNull().references(() => contentRevisions.id, { onDelete: 'cascade' }),
  mode: contentMode().notNull(),
  itemsCount: integer('items_count').notNull(),
  sourceChecksum: text('source_checksum').notNull(),
}, (table) => [primaryKey({ columns: [table.revisionId, table.mode] })])

export const diagnosisVignettes = pgTable('diagnosis_vignettes', {
  id: text().primaryKey(),
  itemVersionId: uuid('item_version_id').notNull().references(() => contentItemVersions.id, { onDelete: 'cascade' }),
  text: text().notNull(),
  sortOrder: integer('sort_order').notNull(),
}, (table) => [index('diagnosis_vignette_item_idx').on(table.itemVersionId)])

export const contentReviewDecisions = pgTable('content_review_decisions', {
  id: uuid().primaryKey().defaultRandom(),
  itemId: text('item_id').notNull().references(() => contentItems.id),
  field: text().notNull(),
  decision: jsonb().notNull(),
  reviewerUserId: uuid('reviewer_user_id').notNull().references(() => user.id),
  createdAt: now(),
  updatedAt: now(),
}, (table) => [unique('content_review_reviewer_unique').on(table.itemId, table.field, table.reviewerUserId)])

export const dailyChallenges = pgTable('daily_challenges', {
  id: uuid().primaryKey().defaultRandom(),
  challengeKey: text('challenge_key').notNull().unique(),
  puzzleDate: date('puzzle_date').notNull(),
  mode: contentMode().notNull(),
  period: periodKey().notNull(),
  difficulty: difficultyKey(),
  variantKey: text('variant_key').notNull().default('-'),
  revisionId: uuid('revision_id').notNull().references(() => contentRevisions.id),
  answerItemVersionId: uuid('answer_item_version_id').notNull().references(() => contentItemVersions.id),
  globalSalt: integer('global_salt').notNull(),
  algorithmVersion: integer('algorithm_version').notNull(),
  createdAt: now(),
}, (table) => [unique('daily_challenge_variant_unique').on(table.puzzleDate, table.mode, table.period, table.variantKey, table.globalSalt)])

export const gameSessions = pgTable('game_sessions', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => user.id),
  challengeId: uuid('challenge_id').references(() => dailyChallenges.id),
  kind: text().notNull(),
  mode: contentMode().notNull(),
  period: periodKey().notNull(),
  difficulty: difficultyKey(),
  puzzleDate: date('puzzle_date').notNull(),
  revisionId: uuid('revision_id').notNull().references(() => contentRevisions.id),
  answerItemVersionId: uuid('answer_item_version_id').notNull().references(() => contentItemVersions.id),
  status: text().notNull().default('playing'),
  attemptsCount: smallint('attempts_count').notNull().default(0),
  rulesVersion: integer('rules_version').notNull(),
  startIdempotencyKey: uuid('start_idempotency_key'),
  startedAt: now(),
  updatedAt: now(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  rewardLedgerId: uuid('reward_ledger_id'),
}, (table) => [
  uniqueIndex('game_session_challenge_user_unique').on(table.userId, table.challengeId).where(sql`${table.challengeId} is not null`),
  uniqueIndex('game_session_start_idempotency_unique').on(table.userId, table.startIdempotencyKey).where(sql`${table.startIdempotencyKey} is not null`),
  index('game_session_user_status_idx').on(table.userId, table.status),
  check('game_session_kind_check', sql`${table.kind} in ('daily','archive','free_play')`),
  check('game_session_status_check', sql`${table.status} in ('playing','won','lost')`),
  check('game_session_attempts_check', sql`${table.attemptsCount} between 0 and 10`),
])

export const contentReports = pgTable('content_reports', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').notNull().references(() => gameSessions.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull().references(() => contentItems.id),
  mode: contentMode().notNull(),
  reason: text().notNull(),
  comment: text(),
  status: text().notNull().default('open'),
  createdAt: now(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by').references(() => user.id, { onDelete: 'set null' }),
}, (table) => [
  index('content_report_status_created_idx').on(table.status, table.createdAt),
  index('content_report_item_idx').on(table.itemId),
  check('content_report_reason_check', sql`${table.reason} in ('wrong_fact','disputed_comparison','title_not_found','bad_hint','other')`),
  check('content_report_status_check', sql`${table.status} in ('open','resolved','dismissed')`),
])

export const gameAttempts = pgTable('game_attempts', {
  id: uuid().primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => gameSessions.id, { onDelete: 'cascade' }),
  position: smallint().notNull(),
  guessedItemVersionId: uuid('guessed_item_version_id').notNull().references(() => contentItemVersions.id),
  isCorrect: boolean('is_correct').notNull(),
  hintsSnapshot: jsonb('hints_snapshot').notNull(),
  responseSnapshot: jsonb('response_snapshot').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  createdAt: now(),
}, (table) => [
  unique('game_attempt_position_unique').on(table.sessionId, table.position),
  unique('game_attempt_guess_unique').on(table.sessionId, table.guessedItemVersionId),
  unique('game_attempt_idempotency_unique').on(table.sessionId, table.idempotencyKey),
  check('game_attempt_position_check', sql`${table.position} between 1 and 10`),
])

export const gameHintChoices = pgTable('game_hint_choices', {
  id: uuid().primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => gameSessions.id, { onDelete: 'cascade' }),
  checkpoint: smallint().notNull(),
  hintKey: text('hint_key').notNull(),
  responseSnapshot: jsonb('response_snapshot').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  createdAt: now(),
}, (table) => [
  unique('game_hint_checkpoint_unique').on(table.sessionId, table.checkpoint),
  unique('game_hint_idempotency_unique').on(table.sessionId, table.idempotencyKey),
  check('game_hint_checkpoint_check', sql`${table.checkpoint} in (5,8)`),
])

export const userModeStats = pgTable('user_mode_stats', {
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  mode: contentMode().notNull(),
  difficultyKey: text('difficulty_key').notNull().default('-'),
  played: integer().notNull().default(0), won: integer().notNull().default(0),
  currentStreak: integer('current_streak').notNull().default(0), bestStreak: integer('best_streak').notNull().default(0),
  distribution: integer().array().notNull().default(sql`array_fill(0, ARRAY[10])`),
  updatedAt: now(),
}, (table) => [primaryKey({ columns: [table.userId, table.mode, table.difficultyKey] })])

export const dailyAttendance = pgTable('daily_attendance', {
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  activityDate: date('activity_date').notNull(),
  completedModes: contentMode('completed_modes').array().notNull().default(sql`ARRAY[]::content_mode[]`),
  wonModes: contentMode('won_modes').array().notNull().default(sql`ARRAY[]::content_mode[]`),
  firstCompletedAt: timestamp('first_completed_at', { withTimezone: true }).notNull(),
  fullHouse: boolean('full_house').notNull().default(false),
}, (table) => [primaryKey({ columns: [table.userId, table.activityDate] })])

export const attendanceStats = pgTable('attendance_stats', {
  userId: uuid('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  currentDailyStreak: integer('current_daily_streak').notNull().default(0),
  bestDailyStreak: integer('best_daily_streak').notNull().default(0),
  lastCompletedDate: date('last_completed_date'),
  gracePasses: integer('grace_passes').notNull().default(0),
  totalActiveDays: integer('total_active_days').notNull().default(0),
  fullHouseDays: integer('full_house_days').notNull().default(0),
  updatedAt: now(),
})

export const walletAccounts = pgTable('wallet_accounts', {
  userId: uuid('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  balance: integer().notNull().default(0), lifetimeEarned: integer('lifetime_earned').notNull().default(0),
  version: integer().notNull().default(1), updatedAt: now(),
}, (table) => [check('wallet_balance_check', sql`${table.balance} >= 0`), check('wallet_lifetime_check', sql`${table.lifetimeEarned} >= 0`)])

export const walletLedger = pgTable('wallet_ledger', {
  id: uuid().primaryKey().defaultRandom(), userId: uuid('user_id').notNull().references(() => user.id),
  operationKey: text('operation_key').notNull().unique(), type: text().notNull(), reason: text().notNull(),
  amount: integer().notNull(), balanceAfter: integer('balance_after').notNull(), metadata: jsonb().notNull().default({}), createdAt: now(),
}, (table) => [index('wallet_ledger_user_cursor_idx').on(table.userId, table.createdAt), check('wallet_ledger_type_check', sql`${table.type} in ('earn','spend','adjustment','migration')`)])

export const periodEntitlements = pgTable('period_entitlements', {
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }), mode: contentMode().notNull(), period: periodKey().notNull(),
  source: text().notNull(), ledgerId: uuid('ledger_id').references(() => walletLedger.id), unlockedAt: now(),
}, (table) => [primaryKey({ columns: [table.userId, table.mode, table.period] })])

export const freePlayUsage = pgTable('free_play_usage', {
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }), activityDate: date('activity_date').notNull(), launches: integer().notNull().default(0),
}, (table) => [primaryKey({ columns: [table.userId, table.activityDate] })])

export const promoCodes = pgTable('promo_codes', {
  id: uuid().primaryKey().defaultRandom(), codeHash: text('code_hash').notNull().unique(), title: text().notNull(), rewardType: text('reward_type').notNull(),
  rewardValue: jsonb('reward_value').notNull(), perUserLimit: integer('per_user_limit').notNull().default(1), globalLimit: integer('global_limit'),
  startsAt: timestamp('starts_at', { withTimezone: true }), endsAt: timestamp('ends_at', { withTimezone: true }), enabled: boolean().notNull().default(true),
  createdBy: uuid('created_by').references(() => user.id), createdAt: now(),
})

export const promoRedemptions = pgTable('promo_redemptions', {
  id: uuid().primaryKey().defaultRandom(), promoId: uuid('promo_id').notNull().references(() => promoCodes.id), userId: uuid('user_id').notNull().references(() => user.id),
  ledgerId: uuid('ledger_id').references(() => walletLedger.id), redemptionNumber: integer('redemption_number').notNull(), idempotencyKey: uuid('idempotency_key').notNull(), createdAt: now(),
}, (table) => [unique('promo_redemption_number_unique').on(table.promoId, table.userId, table.redemptionNumber), unique('promo_redemption_idempotency_unique').on(table.userId, table.idempotencyKey)])

export const legacyImports = pgTable('legacy_imports', {
  id: uuid().primaryKey().defaultRandom(), userId: uuid('user_id').notNull().references(() => user.id), deviceId: uuid('device_id').notNull(), schemaVersion: integer('schema_version').notNull(),
  payloadChecksum: text('payload_checksum').notNull(), importedGames: integer('imported_games').notNull(), importedWallet: integer('imported_wallet').notNull(), warnings: jsonb().notNull(), createdAt: now(),
}, (table) => [
  unique('legacy_import_user_schema_unique').on(table.userId, table.schemaVersion),
  unique('legacy_import_device_schema_unique').on(table.deviceId, table.schemaVersion),
])

export const auditLog = pgTable('audit_log', {
  id: uuid().primaryKey().defaultRandom(), actorUserId: uuid('actor_user_id').references(() => user.id), action: text().notNull(), entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(), before: jsonb(), after: jsonb(), requestId: text('request_id').notNull(), createdAt: now(),
}, (table) => [index('audit_log_entity_idx').on(table.entityType, table.entityId), index('audit_log_created_idx').on(table.createdAt)])
