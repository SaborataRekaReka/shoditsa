import { sql } from 'drizzle-orm'
import type { Database } from '@shoditsa/database'
import type { RoomRepository, StoredRoom } from '@shoditsa/game-core/svoyak'
import { RoomError } from '@shoditsa/game-core/svoyak'

export class PostgresRoomRepository implements RoomRepository {
  constructor(private db: Database) {}
  async get(code: string): Promise<StoredRoom | null> {
    const rows = await this.db.execute(sql`select snapshot from svoyak_rooms where code=${code} and expires_at>now()`)
    return rows[0]?.snapshot as StoredRoom | undefined ?? null
  }
  async save(room: StoredRoom, expected: number | null) {
    await this.db.transaction(async tx => {
      let previous: StoredRoom | null = null
      if (expected !== null) {
        const rows = await tx.execute(sql`select snapshot,revision from svoyak_rooms where code=${room.code} and expires_at>now() for update`)
        if (!rows[0] || Number(rows[0].revision) !== expected) throw new RoomError('ROOM_CHANGED', 'Комната обновилась. Повтори действие.', 409)
        previous = rows[0].snapshot as StoredRoom
      }
      // Admission and the first public projection happen in the same DB transaction.
      const starting = previous?.stage === 'lobby' && room.stage === 'playing'
      const opening = room.current && room.current.id !== previous?.current?.id
      if (starting || opening) {
        const questions = starting ? room.themes.flatMap(theme => theme.questions) : room.themes.flatMap(theme => theme.questions).filter(q => q.id === room.current!.id)
        const revisions = await tx.execute(sql`select status from svoyak_content_revisions where id=${room.plan!.libraryRevision} for share`)
        if (!revisions[0] || !['active','retired'].includes(String(revisions[0].status))) throw new RoomError('PLAN_STALE', 'Эта версия вопросов больше недоступна. Собери игру заново.', 409)
        for (const question of questions) {
          const rows = await tx.execute(sql`select content_hash,approved from svoyak_questions where revision_id=${room.plan!.libraryRevision} and id=${question.id} for share`)
          if (!rows[0]?.approved || rows[0].content_hash !== question.hash) throw new RoomError('QUESTION_UNAVAILABLE', 'Вопрос снят с игры. Собери новый пак.', 409)
        }
      }
      const snapshot = JSON.stringify(room)
      if (expected === null) {
        const creator = room.members.find(member => member.id === room.hostId)?.userId
        if (!creator) throw new RoomError('AUTH_REQUIRED', 'Войди в аккаунт, чтобы создать комнату.', 401)
        await tx.execute(sql`insert into svoyak_rooms(code,revision,creator_user_id,snapshot) values(${room.code},${room.revision},${creator},${snapshot}::jsonb)`)
      } else {
        await tx.execute(sql`update svoyak_rooms set revision=${room.revision},snapshot=${snapshot}::jsonb,updated_at=now() where code=${room.code}`)
      }
      for (const member of room.members) {
        if (!member.userId || previous?.members.some(old => old.id === member.id)) continue
        await tx.execute(sql`insert into svoyak_members(room_code,member_id,user_id) values(${room.code},${member.id},${member.userId}) on conflict(room_code,member_id) do nothing`)
      }
      for (const member of previous?.members ?? []) if (!room.members.some(current => current.id === member.id)) {
        await tx.execute(sql`update svoyak_members set left_at=now() where room_code=${room.code} and member_id=${member.id}`)
      }
      for (const event of room.answers.filter(event => !previous?.answers.some(old => old.id === event.id))) await tx.execute(sql`insert into svoyak_answer_events(room_code,event_id,payload) values(${room.code},${event.id},${JSON.stringify(event)}::jsonb) on conflict do nothing`)
      for (const result of room.pastResults.filter(result => !previous?.pastResults.some(old => old.id === result.id))) {
        const inserted = await tx.execute(sql`insert into svoyak_results(id,room_code,library_revision,payload) values(${result.id},${room.code},${result.libraryRevision},${JSON.stringify(result)}::jsonb) on conflict do nothing returning id`)
        if (inserted.length && !room.testRun) await tx.execute(sql`insert into svoyak_analytics_outbox(id,room_code,payload) values(${result.id},${room.code},${JSON.stringify({ event: 'svoyak_game_completed', completed: result.completed, players: result.scores.length, answers: result.answers.length })}::jsonb) on conflict do nothing`)
      }
    })
  }
  async presence(code: string, memberId?: string) {
    if (memberId) await this.db.execute(sql`update svoyak_members set last_seen_at=now() where room_code=${code} and member_id=${memberId} and last_seen_at<now()-interval '10 seconds'`)
    const rows = await this.db.execute(sql`select member_id,last_seen_at>now()-interval '45 seconds' as connected from svoyak_members where room_code=${code} and left_at is null`)
    return new Map(rows.map(row => [String(row.member_id), Boolean(row.connected)]))
  }
}
