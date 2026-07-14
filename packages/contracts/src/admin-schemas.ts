import { Type, type Static } from '@sinclair/typebox'
import { ContentModeSchema, DateTimeSchema, UuidSchema } from './schemas.js'

export const AdminIdParamsSchema = Type.Object({ id: UuidSchema }, { additionalProperties: false })
export const AdminItemParamsSchema = Type.Object({ itemId: Type.String({ minLength: 1, maxLength: 255 }) }, { additionalProperties: false })

export const AdminContentItemsQuerySchema = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 160 })),
  mode: Type.Optional(ContentModeSchema),
  publication: Type.Optional(Type.Union([Type.Literal('published'), Type.Literal('hidden'), Type.Literal('all')])),
  hasReports: Type.Optional(Type.Boolean()),
  hasIssues: Type.Optional(Type.Boolean()),
  hasHint: Type.Optional(Type.Boolean()),
  source: Type.Optional(Type.Union([Type.Literal('manual'), Type.Literal('ai_pipeline'), Type.Literal('bulk'), Type.Literal('import'), Type.Literal('rollback'), Type.Literal('report_fix')])),
  pipelineKey: Type.Optional(Type.Union([Type.Literal('music'), Type.Literal('movie'), Type.Literal('anime'), Type.Literal('normalization')])),
  sort: Type.Optional(Type.Union([Type.Literal('title'), Type.Literal('id'), Type.Literal('createdAt'), Type.Literal('updatedAt'), Type.Literal('reports'), Type.Literal('completeness')])),
  order: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
  cursor: Type.Optional(Type.String({ maxLength: 512 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 40 })),
}, { additionalProperties: false })

export const AdminWorkspaceItemBodySchema = Type.Object({
  mode: ContentModeSchema,
  payload: Type.Record(Type.String(), Type.Unknown()),
  expectedVersion: Type.Integer({ minimum: 0 }),
  source: Type.Optional(Type.Union([
    Type.Literal('manual'), Type.Literal('ai_pipeline'), Type.Literal('bulk'), Type.Literal('import'), Type.Literal('rollback'), Type.Literal('report_fix'),
  ])),
  reason: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
}, { additionalProperties: false })

export const AdminWorkspaceBulkBodySchema = Type.Object({
  itemIds: Type.Array(Type.String({ minLength: 1, maxLength: 255 }), { minItems: 1, maxItems: 5_000 }),
  operation: Type.Union([Type.Literal('allow'), Type.Literal('disallow'), Type.Literal('add_tag'), Type.Literal('remove_tag')]),
  value: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
}, { additionalProperties: false })

const ContentExchangeFieldSchema = Type.String({ minLength: 1, maxLength: 80, pattern: '^[A-Za-z][A-Za-z0-9_]*$' })

export const ContentExchangeSelectionBodySchema = Type.Object({
  itemIds: Type.Array(Type.String({ minLength: 1, maxLength: 255 }), { minItems: 1, maxItems: 5_000 }),
}, { additionalProperties: false })

export const ContentExchangeExportBodySchema = Type.Object({
  itemIds: Type.Array(Type.String({ minLength: 1, maxLength: 255 }), { minItems: 1, maxItems: 5_000 }),
  fields: Type.Array(ContentExchangeFieldSchema, { minItems: 1, maxItems: 250, uniqueItems: true }),
}, { additionalProperties: false })

const ContentExchangeBaseSchema = Type.Object({
  revisionId: Type.Optional(Type.Union([UuidSchema, Type.Null()])),
  itemVersionId: Type.Optional(Type.Union([UuidSchema, Type.Null()])),
  workspaceChangeVersion: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  payloadHash: Type.String({ minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' }),
  fieldHashes: Type.Record(ContentExchangeFieldSchema, Type.String({ minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' })),
}, { additionalProperties: false })

export const ContentExchangeItemSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 255 }),
  mode: ContentModeSchema,
  base: Type.Optional(Type.Union([ContentExchangeBaseSchema, Type.Null()])),
  data: Type.Record(ContentExchangeFieldSchema, Type.Unknown()),
  unsetFields: Type.Optional(Type.Array(ContentExchangeFieldSchema, { maxItems: 250, uniqueItems: true })),
}, { additionalProperties: false })

export const ContentExchangeDocumentSchema = Type.Object({
  format: Type.Literal('shoditsa-content-exchange'),
  schemaVersion: Type.Literal(1),
  exportId: UuidSchema,
  exportedAt: DateTimeSchema,
  source: Type.Object({
    revisionId: Type.Optional(Type.Union([UuidSchema, Type.Null()])),
    revisionVersion: Type.Optional(Type.Union([Type.String({ maxLength: 255 }), Type.Null()])),
    workspaceId: Type.Optional(Type.Union([UuidSchema, Type.Null()])),
    workspaceVersion: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  }, { additionalProperties: false }),
  fields: Type.Array(ContentExchangeFieldSchema, { minItems: 1, maxItems: 250, uniqueItems: true }),
  items: Type.Array(ContentExchangeItemSchema, { minItems: 1, maxItems: 5_000 }),
}, { additionalProperties: false })

export const ContentExchangeImportPreviewBodySchema = Type.Object({
  document: ContentExchangeDocumentSchema,
}, { additionalProperties: false })

export const ContentExchangeImportApplyBodySchema = Type.Object({
  document: ContentExchangeDocumentSchema,
  previewHash: Type.String({ minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' }),
  items: Type.Array(Type.Object({ id: Type.String({ minLength: 1, maxLength: 255 }), mode: ContentModeSchema }, { additionalProperties: false }), { minItems: 1, maxItems: 5_000 }),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
  confirmation: Type.Literal(true),
}, { additionalProperties: false })

export const AdminMediaUploadBodySchema = Type.Object({
  fileName: Type.String({ minLength: 1, maxLength: 255 }),
  contentType: Type.Union([Type.Literal('image/jpeg'), Type.Literal('image/png'), Type.Literal('image/webp')]),
  base64: Type.String({ minLength: 4, maxLength: 7_500_000 }),
  purpose: Type.Union([Type.Literal('posterUrl'), Type.Literal('headerUrl'), Type.Literal('backdropUrl'), Type.Literal('screenshot')]),
}, { additionalProperties: false })

export const AdminReportQuerySchema = Type.Object({
  status: Type.Optional(Type.Union(['open', 'in_progress', 'resolved', 'dismissed', 'duplicate'].map((value) => Type.Literal(value)))),
  reason: Type.Optional(Type.String({ maxLength: 80 })),
  mode: Type.Optional(ContentModeSchema),
  itemId: Type.Optional(Type.String({ maxLength: 255 })),
  userId: Type.Optional(UuidSchema),
  q: Type.Optional(Type.String({ maxLength: 160 })),
  cursor: Type.Optional(DateTimeSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 40 })),
}, { additionalProperties: false })

export const AdminReportPatchBodySchema = Type.Object({
  status: Type.Union(['open', 'in_progress', 'resolved', 'dismissed', 'duplicate'].map((value) => Type.Literal(value))),
  assignedTo: Type.Optional(Type.Union([UuidSchema, Type.Null()])),
  resolutionType: Type.Optional(Type.Union([
    Type.Literal('fixed_by_revision'), Type.Literal('already_fixed'), Type.Literal('expected_behavior'),
    Type.Literal('insufficient_data'), Type.Literal('duplicate'), Type.Literal('other'), Type.Null(),
  ])),
  resolutionComment: Type.Optional(Type.Union([Type.String({ maxLength: 1_000 }), Type.Null()])),
  linkedWorkspaceChangeId: Type.Optional(Type.Union([UuidSchema, Type.Null()])),
  linkedRevisionId: Type.Optional(Type.Union([UuidSchema, Type.Null()])),
  duplicateOfReportId: Type.Optional(Type.Union([UuidSchema, Type.Null()])),
}, { additionalProperties: false })

export const AdminReportBulkResolveBodySchema = Type.Object({
  reportIds: Type.Array(UuidSchema, { minItems: 1, maxItems: 500 }),
  status: Type.Union([Type.Literal('resolved'), Type.Literal('dismissed')]),
  resolutionType: Type.Union([
    Type.Literal('fixed_by_revision'), Type.Literal('already_fixed'), Type.Literal('expected_behavior'),
    Type.Literal('insufficient_data'), Type.Literal('other'),
  ]),
  resolutionComment: Type.String({ minLength: 3, maxLength: 1_000 }),
  linkedRevisionId: Type.Optional(Type.Union([UuidSchema, Type.Null()])),
}, { additionalProperties: false })

export const AdminQualityIssuePatchBodySchema = Type.Object({
  status: Type.Union([Type.Literal('open'), Type.Literal('accepted')]),
  comment: Type.Optional(Type.Union([Type.String({ minLength: 3, maxLength: 1_000 }), Type.Null()])),
  acceptedUntil: Type.Optional(Type.Union([DateTimeSchema, Type.Null()])),
}, { additionalProperties: false })

export const AdminDailyChallengeReplaceBodySchema = Type.Object({
  itemId: Type.String({ minLength: 1, maxLength: 255 }),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
  confirmation: Type.Literal(true),
}, { additionalProperties: false })

const MusicPipelineArtistSchema = Type.Object({
  artist: Type.String({ minLength: 1, maxLength: 200 }),
  country: Type.Optional(Type.String({ maxLength: 120 })),
  hint: Type.Optional(Type.String({ maxLength: 500 })),
}, { additionalProperties: false })

const MusicPipelineRequestProperties = {
  scenario: Type.Union([Type.Literal('discover'), Type.Literal('candidates'), Type.Literal('review'), Type.Literal('selected'), Type.Literal('manual')]),
  maxItems: Type.Integer({ minimum: 1, maximum: 20, default: 5 }),
  aiMode: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('never')])),
  model: Type.Optional(Type.Union([Type.Literal('gpt-5-mini')])),
  webSearch: Type.Optional(Type.Boolean()),
  itemIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 255 }), { maxItems: 20 })),
  artists: Type.Optional(Type.Array(MusicPipelineArtistSchema, { minItems: 1, maxItems: 500 })),
}

export const MusicPipelineEstimateBodySchema = Type.Object(MusicPipelineRequestProperties, { additionalProperties: false })

export const MusicPipelineRunBodySchema = Type.Object({
  ...MusicPipelineRequestProperties,
  confirmation: Type.Literal(true),
}, { additionalProperties: false })

export const MusicPipelineManualPreviewBodySchema = Type.Object({
  artists: Type.Array(MusicPipelineArtistSchema, { minItems: 1, maxItems: 500 }),
}, { additionalProperties: false })

const MoviePipelineIdItemSchema = Type.Object({
  kinopoiskId: Type.Integer({ minimum: 1 }),
  hint: Type.Optional(Type.String({ maxLength: 500 })),
}, { additionalProperties: false })

const MoviePipelineQueryItemSchema = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 300 }),
  year: Type.Optional(Type.Integer({ minimum: 1888, maximum: 2100 })),
}, { additionalProperties: false })

const MoviePipelineItemSchema = Type.Union([MoviePipelineIdItemSchema, MoviePipelineQueryItemSchema])

const MoviePipelineRequestProperties = {
  scenario: Type.Union([Type.Literal('discover'), Type.Literal('candidates'), Type.Literal('review'), Type.Literal('selected'), Type.Literal('manual')]),
  maxItems: Type.Integer({ minimum: 1, maximum: 20, default: 5 }),
  aiMode: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('never')])),
  model: Type.Optional(Type.Union([Type.Literal('gpt-5-mini')])),
  webSearch: Type.Optional(Type.Boolean()),
  itemIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 255 }), { maxItems: 20 })),
  movies: Type.Optional(Type.Array(MoviePipelineItemSchema, { minItems: 1, maxItems: 500 })),
}

export const MoviePipelineEstimateBodySchema = Type.Object(MoviePipelineRequestProperties, { additionalProperties: false })

export const MoviePipelineRunBodySchema = Type.Object({
  ...MoviePipelineRequestProperties,
  confirmation: Type.Literal(true),
}, { additionalProperties: false })

export const MoviePipelineManualPreviewBodySchema = Type.Object({
  movies: Type.Array(MoviePipelineItemSchema, { minItems: 1, maxItems: 500 }),
}, { additionalProperties: false })

const AnimePipelineItemSchema = Type.Object({
  shikimoriId: Type.Integer({ minimum: 1 }),
  hint: Type.Optional(Type.String({ maxLength: 500 })),
}, { additionalProperties: false })

const AnimePipelineRequestProperties = {
  scenario: Type.Union([Type.Literal('discover'), Type.Literal('candidates'), Type.Literal('review'), Type.Literal('selected'), Type.Literal('manual')]),
  maxItems: Type.Integer({ minimum: 1, maximum: 20, default: 5 }),
  aiMode: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('never')])),
  model: Type.Optional(Type.Union([Type.Literal('gpt-5-mini')])),
  webSearch: Type.Optional(Type.Boolean()),
  itemIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 255 }), { maxItems: 20 })),
  anime: Type.Optional(Type.Array(AnimePipelineItemSchema, { minItems: 1, maxItems: 500 })),
}

export const AnimePipelineEstimateBodySchema = Type.Object(AnimePipelineRequestProperties, { additionalProperties: false })

export const AnimePipelineRunBodySchema = Type.Object({
  ...AnimePipelineRequestProperties,
  confirmation: Type.Literal(true),
}, { additionalProperties: false })

export const AnimePipelineManualPreviewBodySchema = Type.Object({
  anime: Type.Array(AnimePipelineItemSchema, { minItems: 1, maxItems: 500 }),
}, { additionalProperties: false })

const NormalizationPipelineRequestProperties = {
  mode: ContentModeSchema,
  field: ContentExchangeFieldSchema,
  prompt: Type.String({ minLength: 10, maxLength: 4_000 }),
  scope: Type.Union([Type.Literal('all'), Type.Literal('selected')]),
  itemIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 255 }), { maxItems: 500, uniqueItems: true })),
  query: Type.Optional(Type.String({ maxLength: 160 })),
  maxItems: Type.Integer({ minimum: 1, maximum: 500, default: 100 }),
  model: Type.Optional(Type.Literal('gpt-5-mini')),
  webSearch: Type.Optional(Type.Boolean()),
}

export const NormalizationPipelineEstimateBodySchema = Type.Object(NormalizationPipelineRequestProperties, { additionalProperties: false })
export const NormalizationPipelineRunBodySchema = Type.Object({
  ...NormalizationPipelineRequestProperties,
  confirmation: Type.Literal(true),
}, { additionalProperties: false })

export const IntegrationKeySchema = Type.Union([
  Type.Literal('OPENAI_API_KEY'), Type.Literal('LASTFM_API_KEY'), Type.Literal('SPOTIFY_CLIENT_ID'),
  Type.Literal('SPOTIFY_CLIENT_SECRET'), Type.Literal('THEAUDIODB_API_KEY'), Type.Literal('MUSICBRAINZ_USER_AGENT'),
  Type.Literal('MUSIC_OUTBOUND_PROXY_URL'),
  Type.Literal('KINOPOISK_UNOFFICIAL_API_KEY_1'), Type.Literal('KINOPOISK_UNOFFICIAL_API_KEY_2'),
  Type.Literal('KINOPOISK_UNOFFICIAL_API_KEY_3'), Type.Literal('KINOPOISK_UNOFFICIAL_API_KEY_4'),
  Type.Literal('KINOPOISK_UNOFFICIAL_API_KEY_5'),
  Type.Literal('SHIKIMORI_USER_AGENT'), Type.Literal('SHIKIMORI_CLIENT_ID'),
  Type.Literal('SHIKIMORI_CLIENT_SECRET'), Type.Literal('SHIKIMORI_ACCESS_TOKEN'),
])

export const IntegrationKeyParamsSchema = Type.Object({ key: IntegrationKeySchema }, { additionalProperties: false })

export const IntegrationSecretUpdateBodySchema = Type.Object({
  value: Type.String({ minLength: 1, maxLength: 4_096 }),
  confirmation: Type.Literal(true),
}, { additionalProperties: false })

export const PipelineItemDecisionBodySchema = Type.Object({
  approved: Type.Boolean(),
  fieldDecisions: Type.Record(Type.String(), Type.Object({
    action: Type.Union([Type.Literal('accept'), Type.Literal('keep'), Type.Literal('edit')]),
    value: Type.Optional(Type.Unknown()),
  }, { additionalProperties: false })),
  note: Type.Optional(Type.String({ maxLength: 1_000 })),
}, { additionalProperties: false })

export const PipelineApprovalBodySchema = Type.Object({
  itemIds: Type.Optional(Type.Array(UuidSchema, { minItems: 1, maxItems: 500 })),
  expectedWorkspaceVersion: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false })

export const AdminUsersQuerySchema = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 160 })),
  status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('blocked')])),
  accountType: Type.Optional(Type.Union([Type.Literal('anonymous'), Type.Literal('permanent')])),
  cursor: Type.Optional(DateTimeSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 40 })),
}, { additionalProperties: false })

export const AdminBlockUserBodySchema = Type.Object({
  reason: Type.String({ minLength: 3, maxLength: 500 }),
  comment: Type.Optional(Type.String({ maxLength: 1_000 })),
  blockedUntil: Type.Optional(Type.Union([DateTimeSchema, Type.Null()])),
  revokeSessions: Type.Optional(Type.Boolean({ default: true })),
}, { additionalProperties: false })

export const AdminUserNoteBodySchema = Type.Object({ text: Type.String({ minLength: 1, maxLength: 4_000 }) }, { additionalProperties: false })

export const AdminEventsQuerySchema = Type.Object({
  userId: Type.Optional(UuidSchema),
  gameSessionId: Type.Optional(UuidSchema),
  sessionId: Type.Optional(UuidSchema),
  itemId: Type.Optional(Type.String({ maxLength: 255 })),
  type: Type.Optional(Type.String({ maxLength: 80 })),
  mode: Type.Optional(ContentModeSchema),
  requestId: Type.Optional(Type.String({ maxLength: 120 })),
  errorsOnly: Type.Optional(Type.Boolean()),
  from: Type.Optional(DateTimeSchema),
  to: Type.Optional(DateTimeSchema),
  cursor: Type.Optional(DateTimeSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
}, { additionalProperties: false })

export const ClientEventSchema = Type.Object({
  eventId: UuidSchema,
  eventName: Type.Union([
    'page_view', 'mode_opened', 'client_error', 'api_error', 'network_offline', 'network_online', 'report_form_opened', 'report_submit_failed',
  ].map((value) => Type.Literal(value))),
  occurredAt: DateTimeSchema,
  gameSessionId: Type.Optional(Type.Union([UuidSchema, Type.Null()])),
  route: Type.Optional(Type.String({ maxLength: 160 })),
  appVersion: Type.Optional(Type.String({ maxLength: 80 })),
  requestId: Type.Optional(Type.String({ maxLength: 120 })),
  errorCode: Type.Optional(Type.String({ maxLength: 120 })),
  stackFingerprint: Type.Optional(Type.String({ maxLength: 160 })),
  properties: Type.Optional(Type.Record(Type.String({ maxLength: 80 }), Type.Union([Type.String({ maxLength: 500 }), Type.Number(), Type.Boolean(), Type.Null()]))),
}, { additionalProperties: false })

export const ClientEventsBatchBodySchema = Type.Object({ events: Type.Array(ClientEventSchema, { minItems: 1, maxItems: 50 }) }, { additionalProperties: false })

export type AdminContentItemsQuery = Static<typeof AdminContentItemsQuerySchema>
export type AdminWorkspaceItemBody = Static<typeof AdminWorkspaceItemBodySchema>
export type AdminWorkspaceBulkBody = Static<typeof AdminWorkspaceBulkBodySchema>
export type ContentExchangeSelectionBody = Static<typeof ContentExchangeSelectionBodySchema>
export type ContentExchangeExportBody = Static<typeof ContentExchangeExportBodySchema>
export type ContentExchangeDocument = Static<typeof ContentExchangeDocumentSchema>
export type ContentExchangeImportPreviewBody = Static<typeof ContentExchangeImportPreviewBodySchema>
export type ContentExchangeImportApplyBody = Static<typeof ContentExchangeImportApplyBodySchema>
export type AdminMediaUploadBody = Static<typeof AdminMediaUploadBodySchema>
export type AdminReportQuery = Static<typeof AdminReportQuerySchema>
export type AdminReportPatchBody = Static<typeof AdminReportPatchBodySchema>
export type AdminReportBulkResolveBody = Static<typeof AdminReportBulkResolveBodySchema>
export type AdminQualityIssuePatchBody = Static<typeof AdminQualityIssuePatchBodySchema>
export type AdminDailyChallengeReplaceBody = Static<typeof AdminDailyChallengeReplaceBodySchema>
export type MusicPipelineEstimateBody = Static<typeof MusicPipelineEstimateBodySchema>
export type MusicPipelineRunBody = Static<typeof MusicPipelineRunBodySchema>
export type MusicPipelineManualPreviewBody = Static<typeof MusicPipelineManualPreviewBodySchema>
export type MoviePipelineEstimateBody = Static<typeof MoviePipelineEstimateBodySchema>
export type MoviePipelineRunBody = Static<typeof MoviePipelineRunBodySchema>
export type MoviePipelineManualPreviewBody = Static<typeof MoviePipelineManualPreviewBodySchema>
export type AnimePipelineEstimateBody = Static<typeof AnimePipelineEstimateBodySchema>
export type AnimePipelineRunBody = Static<typeof AnimePipelineRunBodySchema>
export type AnimePipelineManualPreviewBody = Static<typeof AnimePipelineManualPreviewBodySchema>
export type NormalizationPipelineEstimateBody = Static<typeof NormalizationPipelineEstimateBodySchema>
export type NormalizationPipelineRunBody = Static<typeof NormalizationPipelineRunBodySchema>
export type IntegrationKey = Static<typeof IntegrationKeySchema>
export type IntegrationSecretUpdateBody = Static<typeof IntegrationSecretUpdateBodySchema>
export type PipelineItemDecisionBody = Static<typeof PipelineItemDecisionBodySchema>
export type PipelineApprovalBody = Static<typeof PipelineApprovalBodySchema>
export type AdminUsersQuery = Static<typeof AdminUsersQuerySchema>
export type AdminBlockUserBody = Static<typeof AdminBlockUserBodySchema>
export type AdminUserNoteBody = Static<typeof AdminUserNoteBodySchema>
export type AdminEventsQuery = Static<typeof AdminEventsQuerySchema>
export type ClientEventsBatchBody = Static<typeof ClientEventsBatchBodySchema>
