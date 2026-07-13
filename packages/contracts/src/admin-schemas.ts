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
  source: Type.Optional(Type.Union([Type.Literal('manual'), Type.Literal('ai_pipeline'), Type.Literal('bulk'), Type.Literal('rollback'), Type.Literal('report_fix')])),
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
    Type.Literal('manual'), Type.Literal('ai_pipeline'), Type.Literal('bulk'), Type.Literal('rollback'), Type.Literal('report_fix'),
  ])),
  reason: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
}, { additionalProperties: false })

export const AdminWorkspaceBulkBodySchema = Type.Object({
  itemIds: Type.Array(Type.String({ minLength: 1, maxLength: 255 }), { minItems: 1, maxItems: 5_000 }),
  operation: Type.Union([Type.Literal('allow'), Type.Literal('disallow'), Type.Literal('add_tag'), Type.Literal('remove_tag')]),
  value: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
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

const MusicPipelineRequestProperties = {
  scenario: Type.Union([Type.Literal('discover'), Type.Literal('candidates'), Type.Literal('review'), Type.Literal('selected')]),
  maxItems: Type.Integer({ minimum: 1, maximum: 20, default: 5 }),
  aiMode: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('never')])),
  model: Type.Optional(Type.Union([Type.Literal('gpt-5-mini')])),
  webSearch: Type.Optional(Type.Boolean()),
  itemIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 255 }), { maxItems: 20 })),
}

export const MusicPipelineEstimateBodySchema = Type.Object(MusicPipelineRequestProperties, { additionalProperties: false })

export const MusicPipelineRunBodySchema = Type.Object({
  ...MusicPipelineRequestProperties,
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
export type AdminMediaUploadBody = Static<typeof AdminMediaUploadBodySchema>
export type AdminReportQuery = Static<typeof AdminReportQuerySchema>
export type AdminReportPatchBody = Static<typeof AdminReportPatchBodySchema>
export type AdminReportBulkResolveBody = Static<typeof AdminReportBulkResolveBodySchema>
export type AdminQualityIssuePatchBody = Static<typeof AdminQualityIssuePatchBodySchema>
export type AdminDailyChallengeReplaceBody = Static<typeof AdminDailyChallengeReplaceBodySchema>
export type MusicPipelineEstimateBody = Static<typeof MusicPipelineEstimateBodySchema>
export type MusicPipelineRunBody = Static<typeof MusicPipelineRunBodySchema>
export type PipelineItemDecisionBody = Static<typeof PipelineItemDecisionBodySchema>
export type PipelineApprovalBody = Static<typeof PipelineApprovalBodySchema>
export type AdminUsersQuery = Static<typeof AdminUsersQuerySchema>
export type AdminBlockUserBody = Static<typeof AdminBlockUserBodySchema>
export type AdminUserNoteBody = Static<typeof AdminUserNoteBodySchema>
export type AdminEventsQuery = Static<typeof AdminEventsQuerySchema>
export type ClientEventsBatchBody = Static<typeof ClientEventsBatchBodySchema>
