import type { DanetkiGameState, DanetkiMember, DanetkiMessage } from '@shoditsa/contracts'

const createdAt = '2026-07-21T09:41:00.000Z'

export function withFilledDanetkiVisualFixture(state: DanetkiGameState): DanetkiGameState {
  const current = state.members.find((member) => member.userId === state.currentUserId)
  const members: DanetkiMember[] = [
    current ? { ...current, displayName: 'Алекс Бренейзе', colorKey: 'green', leftAt: null } : {
      userId: state.currentUserId,
      role: 'owner',
      displayName: 'Алекс Бренейзе',
      colorKey: 'green',
      joinedAt: createdAt,
      leftAt: null,
      lastSeenAt: createdAt,
    },
    { userId: 'visual-tatiana', role: 'player', displayName: 'Татьяна', colorKey: 'amber', joinedAt: createdAt, leftAt: null, lastSeenAt: createdAt },
    { userId: 'visual-konstantin', role: 'player', displayName: 'Константин Северьянов', colorKey: 'blue', joinedAt: createdAt, leftAt: null, lastSeenAt: createdAt },
  ]
  const messages: DanetkiMessage[] = [
    { id: 'visual-1', seq: 1, senderKind: 'user', senderUserId: state.currentUserId, senderName: members[0].displayName, senderColorKey: members[0].colorKey, messageType: 'question', text: 'Он сделал это намеренно?', classification: null, importance: null, parentMessageId: null, createdAt },
    { id: 'visual-2', seq: 2, senderKind: 'ai', senderUserId: null, senderName: 'Ведущий', senderColorKey: null, messageType: 'answer', text: 'Да.', classification: 'yes', importance: 'neutral', parentMessageId: 'visual-1', createdAt: '2026-07-21T09:41:08.000Z' },
    { id: 'visual-3', seq: 3, senderKind: 'user', senderUserId: 'visual-tatiana', senderName: members[1].displayName, senderColorKey: members[1].colorKey, messageType: 'question', text: 'Он находился дома?', classification: null, importance: null, parentMessageId: null, createdAt: '2026-07-21T09:41:24.000Z' },
    { id: 'visual-4', seq: 4, senderKind: 'ai', senderUserId: null, senderName: 'Ведущий', senderColorKey: null, messageType: 'answer', text: 'Нет.', classification: 'no', importance: 'neutral', parentMessageId: 'visual-3', createdAt: '2026-07-21T09:41:31.000Z' },
    { id: 'visual-5', seq: 5, senderKind: 'user', senderUserId: 'visual-konstantin', senderName: members[2].displayName, senderColorKey: members[2].colorKey, messageType: 'question', text: 'Награда была связана с тем, что охранник предотвратил опасность для других людей?', classification: null, importance: null, parentMessageId: null, createdAt: '2026-07-21T09:42:03.000Z' },
    { id: 'visual-6', seq: 6, senderKind: 'ai', senderUserId: null, senderName: 'Ведущий', senderColorKey: null, messageType: 'answer', text: 'Да. Это важная деталь.', classification: 'yes', importance: 'critical', parentMessageId: 'visual-5', createdAt: '2026-07-21T09:42:10.000Z' },
  ]

  return { ...state, roomMode: 'group', questionCount: 3, members, messages, lastSeq: 6 }
}
