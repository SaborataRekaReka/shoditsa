import { sql } from 'drizzle-orm'
import type { Database } from '@shoditsa/database'
import type { Bank, BankQuestion, QuestionBank } from '@shoditsa/game-core/svoyak-bank'
import { RoomError } from '@shoditsa/game-core/svoyak'

/** Each release pins the reviewed wording and answer; no editor process is required. */
export class PostgresQuestionBank implements QuestionBank {
  constructor(private db: Database) {}
  async load(): Promise<Bank> {
    return this.db.transaction(async tx => {
      const revisions = await tx.execute(sql`select id,catalog from svoyak_content_revisions where status='active' limit 1`)
      const revision = revisions[0]
      if (!revision) throw new RoomError('BANK_UNAVAILABLE', 'База вопросов обновляется. Попробуй через минуту.', 503)
      const rows = await tx.execute(sql`select payload from svoyak_questions where revision_id=${String(revision.id)} and approved=true order by id`)
      const catalog = revision.catalog as Bank['catalog']
      return { catalog: { ...catalog, packs: catalog.packs.filter(p => p.playable > 0), topics: catalog.topics.filter(t => t.playable > 0) }, questions: rows.map(row => row.payload as BankQuestion) }
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
  }
  async validate(questions: BankQuestion[]) {
    const bank = await this.load()
    const current = new Map(bank.questions.map(question => [question.id, question.hash]))
    if (questions.some(question => current.get(question.id) !== question.hash)) {
      throw new RoomError('PLAN_STALE', 'Один из вопросов изменился или снят с игры. Выбери темы заново.', 409)
    }
  }
}
