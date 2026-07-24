import { sql } from 'drizzle-orm'
import { CONTENT_MODE_IDS, type FriendsRoomPackSelection, type FriendsRoomScorePart } from '@shoditsa/contracts'
import {
  bigint, boolean, check, date, index, integer, jsonb, pgEnum, pgTable, primaryKey,
  numeric, real, smallint, text, timestamp, unique, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'

const now = () => timestamp({ withTimezone: true }).notNull().defaultNow()

export const contentMode = pgEnum('content_mode', [...CONTENT_MODE_IDS])
export const periodKey = pgEnum('period_key', ['all', 'from_1960', 'from_1980', 'from_1990', 'from_2000', 'from_2010', 'from_2020'])
export const difficultyKey = pgEnum('difficulty_key', ['easy', 'medium', 'hard', 'expert'])
export const danetkiRoomMode = pgEnum('danetki_room_mode', ['solo', 'group'])
export const danetkiAiStatus = pgEnum('danetki_ai_status', ['idle', 'queued', 'processing', 'error'])
export const danetkiMemberRole = pgEnum('danetki_member_role', ['owner', 'player'])
export const danetkiSenderKind = pgEnum('danetki_sender_kind', ['user', 'ai', 'system'])
export const danetkiMessageType = pgEnum('danetki_message_type', ['question', 'answer', 'hint', 'guess', 'event', 'solution'])
export const danetkiGuessStatus = pgEnum('danetki_guess_status', ['pending', 'correct', 'incorrect'])
export const danetkiAiPurpose = pgEnum('danetki_ai_purpose', ['answer', 'evaluate_guess', 'hint', 'summarize'])
export const danetkiAiCallStatus = pgEnum('danetki_ai_call_status', ['pending', 'success', 'error'])
export const friendsRoomPhase = pgEnum('friends_room_phase', ['lobby', 'countdown', 'active', 'results', 'finished'])
export const friendsRoomMemberRole = pgEnum('friends_room_member_role', ['owner', 'player'])

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
  accountStatus: text('account_status').notNull().default('active'),
  blockedAt: timestamp('blocked_at', { withTimezone: true }),
  blockedUntil: timestamp('blocked_until', { withTimezone: true }),
  blockedReason: text('blocked_reason'),
  blockedBy: uuid('blocked_by').references(() => user.id, { onDelete: 'set null' }),
  legacyImportedAt: timestamp('legacy_imported_at', { withTimezone: true }),
  createdAt: now(),
  updatedAt: now(),
}, (table) => [
  check('player_profiles_role_check', sql`${table.role} in ('player','admin')`),
  check('player_profiles_account_status_check', sql`${table.accountStatus} in ('active','blocked')`),
  index('player_profiles_status_until_idx').on(table.accountStatus, table.blockedUntil),
])

export const badges = pgTable('badges', {
  key: text().primaryKey(),
  name: text().notNull(),
  shortLabel: text('short_label').notNull(),
  description: text().notNull(),
  styleKey: text('style_key').notNull(),
  createdAt: now(),
})

export const userBadges = pgTable('user_badges', {
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  badgeKey: text('badge_key').notNull().references(() => badges.key, { onDelete: 'cascade' }),
  source: text().notNull(),
  sourceRef: text('source_ref'),
  awardedAt: now(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.badgeKey] }),
  index('user_badges_badge_awarded_idx').on(table.badgeKey, table.awardedAt),
])

export const appSettings = pgTable('app_settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  version: integer().notNull().default(1),
  updatedBy: uuid('updated_by').references(() => user.id, { onDelete: 'set null' }),
  updatedAt: now(),
})

export const economyRuleSets = pgTable('economy_rule_sets', {
  version: integer().primaryKey(),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  rules: jsonb().notNull(),
  active: boolean().notNull().default(false),
  createdAt: now(),
}, (table) => [
  uniqueIndex('economy_rule_sets_single_active_idx').on(table.active).where(sql`${table.active} = true`),
])

export const integrationSecrets = pgTable('integration_secrets', {
  key: text().primaryKey(),
  encryptedValue: text('encrypted_value').notNull(),
  iv: text().notNull(),
  authTag: text('auth_tag').notNull(),
  lastFour: text('last_four').notNull(),
  updatedBy: uuid('updated_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: now(),
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

export const contentTags = pgTable('content_tags', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  color: text().notNull().default('#6b7280'),
  createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: now(),
  updatedAt: now(),
}, (table) => [uniqueIndex('content_tags_name_ci_unique').on(sql`lower(trim(${table.name}))`)])

export const contentItemTags = pgTable('content_item_tags', {
  itemId: text('item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => contentTags.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: now(),
}, (table) => [
  primaryKey({ columns: [table.itemId, table.tagId] }),
  index('content_item_tags_tag_idx').on(table.tagId, table.itemId),
])

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

export const contentWorkspaces = pgTable('content_workspaces', {
  id: uuid().primaryKey().defaultRandom(),
  title: text().notNull().default('Рабочая версия'),
  status: text().notNull().default('open'),
  baseRevisionId: uuid('base_revision_id').notNull().references(() => contentRevisions.id),
  builtRevisionId: uuid('built_revision_id').references(() => contentRevisions.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').notNull().references(() => user.id),
  createdAt: now(),
  updatedAt: now(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  version: integer().notNull().default(1),
  lastValidationSummary: jsonb('last_validation_summary'),
  failureCode: text('failure_code'),
  safeFailureMessage: text('safe_failure_message'),
}, (table) => [
  check('content_workspace_status_check', sql`${table.status} in ('open','building','ready','published','failed','abandoned')`),
  uniqueIndex('content_workspace_single_active_idx').on(sql`(true)`).where(sql`${table.status} in ('open','building','ready')`),
  index('content_workspace_base_idx').on(table.baseRevisionId),
])

export const pipelineRuns = pgTable('pipeline_runs', {
  id: uuid().primaryKey().defaultRandom(),
  pipelineKey: text('pipeline_key').notNull(),
  pipelineVersion: text('pipeline_version').notNull(),
  status: text().notNull().default('queued'),
  inputDefinitionJson: jsonb('input_definition_json').notNull().default({}),
  settingsJson: jsonb('settings_json').notNull().default({}),
  itemsTotal: integer('items_total').notNull().default(0),
  itemsProcessed: integer('items_processed').notNull().default(0),
  itemsSucceeded: integer('items_succeeded').notNull().default(0),
  itemsFailed: integer('items_failed').notNull().default(0),
  estimatedCost: numeric('estimated_cost', { precision: 12, scale: 6 }),
  actualCost: numeric('actual_cost', { precision: 12, scale: 6 }),
  usageJson: jsonb('usage_json').notNull().default({}),
  createdBy: uuid('created_by').notNull().references(() => user.id),
  createdAt: now(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  errorCode: text('error_code'),
  safeErrorMessage: text('safe_error_message'),
  cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
  workerId: text('worker_id'),
  filesystemScope: text('filesystem_scope'),
  logExcerpt: text('log_excerpt'),
  resultExpiresAt: timestamp('result_expires_at', { withTimezone: true }),
}, (table) => [
  check('pipeline_run_status_check', sql`${table.status} in ('queued','running','review_required','partially_failed','approved','staged','published','partially_published','failed','cancelled')`),
  index('pipeline_run_status_created_idx').on(table.status, table.createdAt),
  index('pipeline_run_pipeline_created_idx').on(table.pipelineKey, table.createdAt),
])

export const pipelineRunItems = pgTable('pipeline_run_items', {
  id: uuid().primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => pipelineRuns.id, { onDelete: 'cascade' }),
  entityKey: text('entity_key').notNull(),
  cardId: text('card_id').references(() => contentItems.id, { onDelete: 'set null' }),
  inputItemVersionId: uuid('input_item_version_id').references(() => contentItemVersions.id, { onDelete: 'set null' }),
  status: text().notNull().default('pending'),
  beforeJson: jsonb('before_json'),
  proposedJson: jsonb('proposed_json'),
  fieldDecisionsJson: jsonb('field_decisions_json').notNull().default({}),
  warningsJson: jsonb('warnings_json').notNull().default([]),
  sourcesJson: jsonb('sources_json'),
  confidenceJson: jsonb('confidence_json'),
  rawResultRef: text('raw_result_ref'),
  approvedBy: uuid('approved_by').references(() => user.id, { onDelete: 'set null' }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  workspaceChangeId: uuid('workspace_change_id'),
  appliedRevisionId: uuid('applied_revision_id').references(() => contentRevisions.id, { onDelete: 'set null' }),
  idempotencyKey: text('idempotency_key').notNull(),
  errorCode: text('error_code'),
  safeErrorMessage: text('safe_error_message'),
  createdAt: now(),
  updatedAt: now(),
}, (table) => [
  unique('pipeline_run_entity_unique').on(table.runId, table.entityKey),
  unique('pipeline_run_item_idempotency_unique').on(table.idempotencyKey),
  check('pipeline_run_item_status_check', sql`${table.status} in ('pending','running','review_required','approved','staged','published','failed','rejected','conflict')`),
  index('pipeline_run_item_run_status_idx').on(table.runId, table.status),
])

export const contentWorkspaceChanges = pgTable('content_workspace_changes', {
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => contentWorkspaces.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull().references(() => contentItems.id),
  mode: contentMode().notNull(),
  changeType: text('change_type').notNull(),
  baseItemVersionId: uuid('base_item_version_id').references(() => contentItemVersions.id, { onDelete: 'set null' }),
  beforePayload: jsonb('before_payload'),
  afterPayload: jsonb('after_payload').notNull(),
  changedFields: text('changed_fields').array().notNull().default(sql`ARRAY[]::text[]`),
  source: text().notNull(),
  actorUserId: uuid('actor_user_id').notNull().references(() => user.id),
  pipelineRunId: uuid('pipeline_run_id').references(() => pipelineRuns.id, { onDelete: 'set null' }),
  pipelineRunItemId: uuid('pipeline_run_item_id').references(() => pipelineRunItems.id, { onDelete: 'set null' }),
  reason: text(),
  version: integer().notNull().default(1),
  validationIssues: jsonb('validation_issues').notNull().default([]),
  createdAt: now(),
  updatedAt: now(),
}, (table) => [
  unique('content_workspace_item_unique').on(table.workspaceId, table.itemId),
  uniqueIndex('content_workspace_pipeline_item_unique').on(table.pipelineRunItemId).where(sql`${table.pipelineRunItemId} is not null`),
  check('content_workspace_change_type_check', sql`${table.changeType} in ('create','update','disable')`),
  check('content_workspace_source_check', sql`${table.source} in ('manual','ai_pipeline','bulk','import','rollback','report_fix')`),
  index('content_workspace_change_workspace_idx').on(table.workspaceId, table.updatedAt),
])

export const backgroundJobs = pgTable('background_jobs', {
  id: uuid().primaryKey().defaultRandom(),
  type: text().notNull(),
  status: text().notNull().default('queued'),
  payload: jsonb().notNull().default({}),
  progress: jsonb().notNull().default({}),
  result: jsonb(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: now(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  attempts: integer().notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  errorCode: text('error_code'),
  safeErrorMessage: text('safe_error_message'),
  workerId: text('worker_id'),
  pipelineRunId: uuid('pipeline_run_id').references(() => pipelineRuns.id, { onDelete: 'set null' }),
}, (table) => [
  check('background_job_type_check', sql`${table.type} in ('content_revision_build','content_release_import','content_quality_check','music_pipeline','movie_pipeline','anime_pipeline','normalization_pipeline','event_export','user_export','media_check','client_event_retention','danetki_ai_reply','danetki_guess_evaluate','danetki_room_expire')`),
  check('background_job_status_check', sql`${table.status} in ('queued','running','completed','failed','cancelled')`),
  index('background_job_claim_idx').on(table.status, table.nextRetryAt, table.createdAt),
  index('background_job_pipeline_idx').on(table.pipelineRunId),
])

export const contentQualityIssues = pgTable('content_quality_issues', {
  id: uuid().primaryKey().defaultRandom(),
  ruleKey: text('rule_key').notNull(),
  severity: text().notNull(),
  mode: contentMode().notNull(),
  itemId: text('item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  itemVersionId: uuid('item_version_id').references(() => contentItemVersions.id, { onDelete: 'cascade' }),
  workspaceChangeId: uuid('workspace_change_id').references(() => contentWorkspaceChanges.id, { onDelete: 'cascade' }),
  field: text(),
  message: text().notNull(),
  fingerprint: text().notNull(),
  status: text().notNull().default('open'),
  acceptedUntil: timestamp('accepted_until', { withTimezone: true }),
  acceptedComment: text('accepted_comment'),
  createdAt: now(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (table) => [
  unique('content_quality_fingerprint_unique').on(table.fingerprint),
  check('content_quality_severity_check', sql`${table.severity} in ('critical','warning','info')`),
  check('content_quality_status_check', sql`${table.status} in ('open','accepted','resolved')`),
  index('content_quality_status_severity_idx').on(table.status, table.severity, table.mode),
  index('content_quality_item_idx').on(table.itemId),
])

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
  authSessionId: uuid('auth_session_id').references(() => session.id, { onDelete: 'set null' }),
  challengeId: uuid('challenge_id').references(() => dailyChallenges.id),
  packId: text('pack_id'),
  packPosition: integer('pack_position'),
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
  uniqueIndex('game_session_pack_user_position_unique').on(table.userId, table.packId, table.packPosition).where(sql`${table.packId} is not null and ${table.packPosition} is not null`),
  index('game_session_user_status_idx').on(table.userId, table.status),
  index('game_session_auth_session_idx').on(table.authSessionId),
  check('game_session_kind_check', sql`${table.kind} in ('daily','archive','free_play','pack')`),
  check('game_session_pack_fields_check', sql`(${table.kind} = 'pack' and ${table.packId} is not null and ${table.packPosition} is not null) or (${table.kind} <> 'pack' and ${table.packId} is null and ${table.packPosition} is null)`),
  check('game_session_status_check', sql`${table.status} in ('playing','won','lost')`),
  check('game_session_attempts_check', sql`${table.attemptsCount} between 0 and 10`),
])

export const danetkiSessionState = pgTable('danetki_session_state', {
  sessionId: uuid('session_id').primaryKey().references(() => gameSessions.id, { onDelete: 'cascade' }),
  roomMode: danetkiRoomMode('room_mode').notNull(),
  questionCount: integer('question_count').notNull().default(0),
  hintLevel: integer('hint_level').notNull().default(0),
  revealedFactIds: text('revealed_fact_ids').array().notNull().default(sql`ARRAY[]::text[]`),
  stateSummary: text('state_summary').notNull().default(''),
  nextMessageSeq: bigint('next_message_seq', { mode: 'number' }).notNull().default(1),
  aiStatus: danetkiAiStatus('ai_status').notNull().default('idle'),
  promptVersion: text('prompt_version').notNull().default('danetki-host-v1'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('danetki_session_question_count_check', sql`${table.questionCount} >= 0`),
  check('danetki_session_hint_level_check', sql`${table.hintLevel} between 0 and 3`),
])

export const danetkiSessionMembers = pgTable('danetki_session_members', {
  sessionId: uuid('session_id').notNull().references(() => gameSessions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: danetkiMemberRole().notNull().default('player'),
  displayNameSnapshot: text('display_name_snapshot').notNull(),
  colorKey: text('color_key').notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp('left_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.sessionId, table.userId] }),
  index('danetki_members_active_idx').on(table.sessionId, table.leftAt, table.joinedAt),
  check('danetki_member_name_check', sql`char_length(${table.displayNameSnapshot}) between 1 and 40`),
])

export const danetkiInvites = pgTable('danetki_invites', {
  id: uuid().primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => gameSessions.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  createdBy: uuid('created_by').notNull().references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  maxUses: integer('max_uses').notNull().default(5),
  usesCount: integer('uses_count').notNull().default(0),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('danetki_invite_token_hash_unique').on(table.tokenHash),
  index('danetki_invite_session_idx').on(table.sessionId, table.expiresAt),
  check('danetki_invite_uses_check', sql`${table.usesCount} >= 0 and ${table.maxUses} between 1 and 6`),
])

export const danetkiMessages = pgTable('danetki_messages', {
  id: uuid().primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => gameSessions.id, { onDelete: 'cascade' }),
  seq: bigint({ mode: 'number' }).notNull(),
  senderKind: danetkiSenderKind('sender_kind').notNull(),
  senderUserId: uuid('sender_user_id').references(() => user.id, { onDelete: 'set null' }),
  messageType: danetkiMessageType('message_type').notNull(),
  text: text().notNull(),
  classification: text(),
  importance: text(),
  parentMessageId: uuid('parent_message_id'),
  idempotencyKey: text('idempotency_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('danetki_message_session_seq_unique').on(table.sessionId, table.seq),
  uniqueIndex('danetki_message_user_idempotency_unique').on(table.sessionId, table.senderUserId, table.idempotencyKey)
    .where(sql`${table.senderUserId} is not null and ${table.idempotencyKey} is not null`),
  uniqueIndex('danetki_message_ai_parent_unique').on(table.parentMessageId)
    .where(sql`${table.senderKind} = 'ai' and ${table.parentMessageId} is not null`),
  index('danetki_message_session_created_idx').on(table.sessionId, table.createdAt),
  check('danetki_message_classification_check', sql`${table.classification} is null or ${table.classification} in ('yes','no','irrelevant','unclear','invalid')`),
  check('danetki_message_importance_check', sql`${table.importance} is null or ${table.importance} in ('critical','useful','neutral')`),
])

export const danetkiFinalGuesses = pgTable('danetki_final_guesses', {
  id: uuid().primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => gameSessions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  text: text().notNull(),
  status: danetkiGuessStatus().notNull().default('pending'),
  evaluation: jsonb(),
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('danetki_guess_idempotency_unique').on(table.sessionId, table.userId, table.idempotencyKey),
  index('danetki_guess_session_created_idx').on(table.sessionId, table.createdAt),
])

export const danetkiAiCalls = pgTable('danetki_ai_calls', {
  id: uuid().primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => gameSessions.id, { onDelete: 'cascade' }),
  triggerMessageId: uuid('trigger_message_id').references(() => danetkiMessages.id, { onDelete: 'set null' }),
  purpose: danetkiAiPurpose().notNull(),
  model: text().notNull(),
  promptVersion: text('prompt_version').notNull(),
  providerResponseId: text('provider_response_id'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  latencyMs: integer('latency_ms'),
  status: danetkiAiCallStatus().notNull().default('pending'),
  errorCode: text('error_code'),
  responseJson: jsonb('response_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('danetki_ai_call_session_created_idx').on(table.sessionId, table.createdAt),
  uniqueIndex('danetki_ai_call_trigger_purpose_unique').on(table.triggerMessageId, table.purpose)
    .where(sql`${table.triggerMessageId} is not null`),
])

export const danetkiSurrenderVotes = pgTable('danetki_surrender_votes', {
  sessionId: uuid('session_id').notNull().references(() => gameSessions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.sessionId, table.userId] })])

export const friendsRooms = pgTable('friends_rooms', {
  id: uuid().primaryKey().defaultRandom(),
  code: text().notNull().unique(),
  ownerUserId: uuid('owner_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  revisionId: uuid('revision_id').notNull().references(() => contentRevisions.id),
  mode: contentMode().notNull(),
  packs: jsonb().$type<FriendsRoomPackSelection[]>().notNull().default(sql`'[{"mode":"series","variant":"all"}]'::jsonb`),
  roundsTotal: smallint('rounds_total').notNull().default(6),
  shufflePacks: boolean('shuffle_packs').notNull().default(false),
  answerTimeSeconds: smallint('answer_time_seconds').notNull().default(30),
  phase: friendsRoomPhase().notNull().default('lobby'),
  currentRound: smallint('current_round').notNull().default(0),
  phaseStartedAt: timestamp('phase_started_at', { withTimezone: true }),
  phaseEndsAt: timestamp('phase_ends_at', { withTimezone: true }),
  nextMessageSeq: bigint('next_message_seq', { mode: 'number' }).notNull().default(1),
  version: bigint({ mode: 'number' }).notNull().default(1),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('friends_room_owner_idx').on(table.ownerUserId, table.createdAt),
  check('friends_room_code_check', sql`char_length(${table.code}) = 5`),
  check('friends_room_rounds_check', sql`${table.roundsTotal} between 3 and 30`),
  check('friends_room_answer_time_check', sql`${table.answerTimeSeconds} in (15, 20, 30, 45)`),
  check('friends_room_current_round_check', sql`${table.currentRound} between 0 and ${table.roundsTotal}`),
])

export const friendsRoomMembers = pgTable('friends_room_members', {
  roomId: uuid('room_id').notNull().references(() => friendsRooms.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: friendsRoomMemberRole().notNull().default('player'),
  displayNameSnapshot: text('display_name_snapshot').notNull(),
  colorKey: text('color_key').notNull(),
  score: integer().notNull().default(0),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp('left_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.roomId, table.userId] }),
  index('friends_room_members_active_idx').on(table.roomId, table.leftAt, table.joinedAt),
  check('friends_room_member_name_check', sql`char_length(${table.displayNameSnapshot}) between 1 and 40`),
  check('friends_room_member_score_check', sql`${table.score} >= 0`),
])

export const friendsRoomRounds = pgTable('friends_room_rounds', {
  id: uuid().primaryKey().defaultRandom(),
  roomId: uuid('room_id').notNull().references(() => friendsRooms.id, { onDelete: 'cascade' }),
  position: smallint().notNull(),
  contentItemVersionId: uuid('content_item_version_id').notNull().references(() => contentItemVersions.id),
  packVariant: text('pack_variant').notNull().default('all'),
  prompt: text().notNull(),
  hints: jsonb().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  revealedAt: timestamp('revealed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('friends_room_round_position_unique').on(table.roomId, table.position),
  index('friends_room_round_item_idx').on(table.roomId, table.contentItemVersionId),
  check('friends_room_round_position_check', sql`${table.position} between 1 and 7`),
])

export const friendsRoomAnswers = pgTable('friends_room_answers', {
  id: uuid().primaryKey().defaultRandom(),
  roomId: uuid('room_id').notNull().references(() => friendsRooms.id, { onDelete: 'cascade' }),
  roundId: uuid('round_id').notNull().references(() => friendsRoomRounds.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  text: text().notNull(),
  isCorrect: boolean('is_correct').notNull(),
  points: integer().notNull().default(0),
  scoreBreakdown: jsonb('score_breakdown').$type<FriendsRoomScorePart[]>().notNull().default(sql`'[]'::jsonb`),
  idempotencyKey: text('idempotency_key').notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('friends_room_answer_round_user_unique').on(table.roundId, table.userId),
  unique('friends_room_answer_idempotency_unique').on(table.roomId, table.userId, table.idempotencyKey),
  index('friends_room_answer_room_round_idx').on(table.roomId, table.roundId, table.submittedAt),
  check('friends_room_answer_text_check', sql`char_length(${table.text}) between 1 and 160`),
  check('friends_room_answer_points_check', sql`${table.points} between 0 and 1000`),
])

export const friendsRoomMessages = pgTable('friends_room_messages', {
  id: uuid().primaryKey().defaultRandom(),
  roomId: uuid('room_id').notNull().references(() => friendsRooms.id, { onDelete: 'cascade' }),
  seq: bigint({ mode: 'number' }).notNull(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  text: text().notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('friends_room_message_seq_unique').on(table.roomId, table.seq),
  unique('friends_room_message_idempotency_unique').on(table.roomId, table.userId, table.idempotencyKey),
  index('friends_room_message_room_created_idx').on(table.roomId, table.createdAt),
  check('friends_room_message_text_check', sql`char_length(${table.text}) between 1 and 300`),
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
  updatedAt: now(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by').references(() => user.id, { onDelete: 'set null' }),
  assignedTo: uuid('assigned_to').references(() => user.id, { onDelete: 'set null' }),
  resolutionType: text('resolution_type'),
  resolutionComment: text('resolution_comment'),
  linkedWorkspaceChangeId: uuid('linked_workspace_change_id').references(() => contentWorkspaceChanges.id, { onDelete: 'set null' }),
  linkedRevisionId: uuid('linked_revision_id').references(() => contentRevisions.id, { onDelete: 'set null' }),
  duplicateOfReportId: uuid('duplicate_of_report_id'),
  clientEventId: uuid('client_event_id'),
  appVersion: text('app_version'),
  pageUrl: text('page_url'),
  clientErrorId: text('client_error_id'),
  requestId: text('request_id'),
}, (table) => [
  index('content_report_status_created_idx').on(table.status, table.createdAt),
  index('content_report_item_idx').on(table.itemId),
  uniqueIndex('content_report_user_client_event_unique').on(table.userId, table.clientEventId).where(sql`${table.clientEventId} is not null`),
  check('content_report_reason_check', sql`${table.reason} in ('wrong_fact','disputed_comparison','title_not_found','bad_hint','bad_image','duplicate_card','typo_or_translation','technical_error','other')`),
  check('content_report_status_check', sql`${table.status} in ('open','in_progress','resolved','dismissed','duplicate')`),
  check('content_report_resolution_type_check', sql`${table.resolutionType} is null or ${table.resolutionType} in ('fixed_by_revision','already_fixed','expected_behavior','insufficient_data','duplicate','other')`),
  check('content_report_not_self_duplicate_check', sql`${table.duplicateOfReportId} is null or ${table.duplicateOfReportId} <> ${table.id}`),
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
  amount: integer().notNull(), balanceAfter: integer('balance_after').notNull(), rulesVersion: integer('rules_version').notNull().default(1), metadata: jsonb().notNull().default({}), createdAt: now(),
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

export const danetkiDailyUsage = pgTable('danetki_daily_usage', {
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  activityDate: date('activity_date').notNull(),
  dailyRooms: integer('daily_rooms').notNull().default(0),
  extraRooms: integer('extra_rooms').notNull().default(0),
  clubRooms: integer('club_rooms').notNull().default(0),
  paidRooms: integer('paid_rooms').notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.userId, table.activityDate] }),
  check('danetki_daily_usage_counts_check', sql`${table.dailyRooms} >= 0 and ${table.extraRooms} >= 0 and ${table.clubRooms} >= 0 and ${table.paidRooms} >= 0`),
])

export const commerceProducts = pgTable('commerce_products', {
  id: text().primaryKey(),
  kind: text().notNull(),
  title: text().notNull(),
  description: text().notNull(),
  priceMinor: integer('price_minor').notNull(),
  currency: text().notNull(),
  durationDays: integer('duration_days'),
  entitlementKey: text('entitlement_key'),
  scope: text(),
  enabled: boolean().notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  metadata: jsonb().notNull().default({}),
  createdAt: now(),
  updatedAt: now(),
}, (table) => [
  check('commerce_products_price_check', sql`${table.priceMinor} >= 0`),
  check('commerce_products_currency_check', sql`${table.currency} ~ '^[A-Z]{3}$'`),
  check('commerce_products_kind_check', sql`${table.kind} in ('club','pack','tip')`),
  check('commerce_products_semantics_check', sql`(
    (${table.kind} = 'club' and ${table.durationDays} > 0 and ${table.entitlementKey} = 'club')
    or (${table.kind} = 'pack' and ${table.entitlementKey} = 'pack' and ${table.scope} is not null and length(${table.scope}) > 0)
    or (${table.kind} = 'tip' and ${table.entitlementKey} = 'supporter')
  )`),
  index('commerce_products_enabled_sort_idx').on(table.enabled, table.sortOrder),
])

export const contentPacks = pgTable('content_packs', {
  id: text().primaryKey(),
  slug: text().notNull().unique(),
  mode: contentMode().notNull(),
  title: text().notNull(),
  subtitle: text(),
  description: text().notNull(),
  coverUrl: text('cover_url'),
  status: text().notNull().default('draft'),
  accessModel: text('access_model').notNull().default('free'),
  productId: text('product_id').references(() => commerceProducts.id, { onDelete: 'set null' }),
  includedInClub: boolean('included_in_club').notNull().default(true),
  previewItems: integer('preview_items').notNull().default(0),
  manifestVersion: integer('manifest_version').notNull().default(1),
  metadata: jsonb().notNull().default({}),
  createdAt: now(),
  updatedAt: now(),
}, (table) => [
  check('content_packs_status_check', sql`${table.status} in ('draft','published','archived')`),
  check('content_packs_access_model_check', sql`${table.accessModel} in ('free','club','purchase')`),
  check('content_packs_preview_items_check', sql`${table.previewItems} >= 0`),
  check('content_packs_manifest_version_check', sql`${table.manifestVersion} > 0`),
  index('content_packs_catalog_idx').on(table.status, table.mode, table.createdAt),
])

export const contentPackEntries = pgTable('content_pack_entries', {
  packId: text('pack_id').notNull().references(() => contentPacks.id, { onDelete: 'cascade' }),
  position: integer().notNull(),
  answerItemId: text('answer_item_id').notNull().references(() => contentItems.id),
  promptPayload: jsonb('prompt_payload').notNull().default({}),
  enabled: boolean().notNull().default(true),
}, (table) => [
  primaryKey({ columns: [table.packId, table.position] }),
  unique('content_pack_entries_answer_unique').on(table.packId, table.answerItemId),
  check('content_pack_entries_position_check', sql`${table.position} > 0`),
  index('content_pack_entries_pack_enabled_idx').on(table.packId, table.enabled, table.position),
])

export const userPackProgress = pgTable('user_pack_progress', {
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  packId: text('pack_id').notNull().references(() => contentPacks.id, { onDelete: 'cascade' }),
  completedPositions: integer('completed_positions').array().notNull().default(sql`ARRAY[]::integer[]`),
  lastPosition: integer('last_position'),
  startedAt: now(),
  updatedAt: now(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.userId, table.packId] }),
  check('user_pack_progress_last_position_check', sql`${table.lastPosition} is null or ${table.lastPosition} > 0`),
  index('user_pack_progress_user_updated_idx').on(table.userId, table.updatedAt),
])

export const privateGameOrders = pgTable('private_game_orders', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
  contactName: text('contact_name').notNull(),
  email: text().notNull(),
  company: text(),
  participants: integer().notNull(),
  eventDate: date('event_date'),
  description: text().notNull(),
  status: text().notNull().default('new'),
  internalNote: text('internal_note'),
  packId: text('pack_id').references(() => contentPacks.id, { onDelete: 'set null' }),
  createdAt: now(),
  updatedAt: now(),
}, (table) => [
  check('private_game_orders_participants_check', sql`${table.participants} between 2 and 10000`),
  check('private_game_orders_status_check', sql`${table.status} in ('new','contacted','in_progress','completed','rejected')`),
  index('private_game_orders_status_created_idx').on(table.status, table.createdAt),
])

export const paymentOrders = pgTable('payment_orders', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => commerceProducts.id),
  provider: text().notNull(),
  status: text().notNull().default('created'),
  amountMinor: integer('amount_minor').notNull(),
  currency: text().notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  providerPaymentId: text('provider_payment_id'),
  providerStatus: text('provider_status'),
  metadata: jsonb().notNull().default({}),
  createdAt: now(),
  updatedAt: now(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, (table) => [
  check('payment_orders_status_check', sql`${table.status} in ('created','pending','paid','failed','canceled','expired','refunded','chargeback')`),
  check('payment_orders_amount_check', sql`${table.amountMinor} >= 0`),
  check('payment_orders_currency_check', sql`${table.currency} ~ '^[A-Z]{3}$'`),
  unique('payment_orders_user_idempotency_unique').on(table.userId, table.idempotencyKey),
  uniqueIndex('payment_orders_provider_payment_unique').on(table.provider, table.providerPaymentId).where(sql`${table.providerPaymentId} is not null`),
  index('payment_orders_user_created_idx').on(table.userId, table.createdAt),
  index('payment_orders_status_updated_idx').on(table.status, table.updatedAt),
])

export const paymentEvents = pgTable('payment_events', {
  id: uuid().primaryKey().defaultRandom(),
  provider: text().notNull(),
  providerEventId: text('provider_event_id').notNull(),
  eventType: text('event_type').notNull(),
  payloadHash: text('payload_hash').notNull(),
  payload: jsonb().notNull().default({}),
  status: text().notNull().default('received'),
  errorCode: text('error_code'),
  receivedAt: now(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
}, (table) => [
  check('payment_events_status_check', sql`${table.status} in ('received','processed','ignored','failed')`),
  unique('payment_events_provider_event_unique').on(table.provider, table.providerEventId),
  index('payment_events_received_idx').on(table.receivedAt),
])

export const userEntitlements = pgTable('user_entitlements', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  entitlementKey: text('entitlement_key').notNull(),
  scope: text(),
  status: text().notNull().default('active'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  metadata: jsonb().notNull().default({}),
  createdAt: now(),
  updatedAt: now(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  check('user_entitlements_status_check', sql`${table.status} in ('active','revoked','expired')`),
  check('user_entitlements_source_check', sql`${table.sourceType} in ('order','admin','promo','migration','yandex')`),
  check('user_entitlements_dates_check', sql`${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`),
  uniqueIndex('user_entitlements_source_unique').on(table.sourceType, table.sourceId, table.entitlementKey, sql`coalesce(${table.scope}, '')`),
  index('user_entitlements_user_access_idx').on(table.userId, table.entitlementKey, table.status, table.endsAt),
])

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

export const clientEvents = pgTable('client_events', {
  id: uuid().primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().unique(),
  eventName: text('event_name').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  authSessionId: uuid('auth_session_id').references(() => session.id, { onDelete: 'set null' }),
  gameSessionId: uuid('game_session_id').references(() => gameSessions.id, { onDelete: 'set null' }),
  route: text(),
  appVersion: text('app_version'),
  browser: text(),
  os: text(),
  device: text(),
  requestId: text('request_id'),
  errorCode: text('error_code'),
  stackFingerprint: text('stack_fingerprint'),
  properties: jsonb().notNull().default({}),
  createdAt: now(),
}, (table) => [
  check('client_event_name_check', sql`${table.eventName} in ('page_view','mode_opened','client_error','api_error','network_offline','network_online','report_form_opened','report_submit_failed','club_screen_view','club_interest_clicked','archive_paywall_view','archive_paywall_clicked','checkout_started','checkout_returned','purchase_succeeded','purchase_failed','club_free_play_started','pack_opened','pack_paywall_view','ticket_earned','ticket_spent','insufficient_tickets_view','ticket_offer_view','ticket_offer_clicked','ticket_bundle_purchased','period_unlocked','free_play_started','danetki_room_started','danetki_room_completed','danetki_limit_reached','club_paywall_view')`),
  index('client_event_occurred_idx').on(table.occurredAt),
  index('client_event_user_occurred_idx').on(table.userId, table.occurredAt),
  index('client_event_game_session_idx').on(table.gameSessionId),
  index('client_event_request_idx').on(table.requestId),
  index('client_event_name_idx').on(table.eventName),
])

export const authEvents = pgTable('auth_events', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  authSessionId: uuid('auth_session_id'),
  eventName: text('event_name').notNull(),
  result: text().notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  requestId: text('request_id'),
  browser: text(),
  os: text(),
  device: text(),
}, (table) => [
  check('auth_event_name_check', sql`${table.eventName} in ('sign_up','sign_in','sign_out','email_verified','password_reset_requested','password_changed','sessions_revoked')`),
  check('auth_event_result_check', sql`${table.result} in ('success','failure')`),
  index('auth_event_user_occurred_idx').on(table.userId, table.occurredAt),
])

export const adminUserNotes = pgTable('admin_user_notes', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  text: text().notNull(),
  createdBy: uuid('created_by').notNull().references(() => user.id),
  createdAt: now(),
  updatedAt: now(),
}, (table) => [index('admin_user_note_user_idx').on(table.userId, table.createdAt)])

export const auditLog = pgTable('audit_log', {
  id: uuid().primaryKey().defaultRandom(), actorUserId: uuid('actor_user_id').references(() => user.id), action: text().notNull(), entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(), before: jsonb(), after: jsonb(), reason: text(), result: text().notNull().default('success'), requestId: text('request_id').notNull(), createdAt: now(),
}, (table) => [
  index('audit_log_entity_idx').on(table.entityType, table.entityId),
  index('audit_log_created_idx').on(table.createdAt),
  index('audit_log_action_created_idx').on(table.action, table.createdAt),
  check('audit_log_result_check', sql`${table.result} in ('success','failure')`),
])
