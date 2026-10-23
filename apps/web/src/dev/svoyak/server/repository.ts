import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { RoomError, type RoomRepository, type StoredRoom } from './service'

/** Separate local room store. The editorial and source databases are never written. */
export class SqliteRoomRepository implements RoomRepository {
  private db: DatabaseSync
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS svoyak_rooms(code TEXT PRIMARY KEY, revision INTEGER NOT NULL, snapshot TEXT NOT NULL, updated_at INTEGER NOT NULL)')
  }
  get(code: string): StoredRoom | null {
    const row = this.db.prepare('SELECT snapshot FROM svoyak_rooms WHERE code=?').get(code)
    return row ? JSON.parse(String(row.snapshot)) : null
  }
  save(room: StoredRoom, expectedRevision: number | null) {
    if (expectedRevision === null) this.db.prepare('INSERT INTO svoyak_rooms VALUES(?,?,?,?)').run(room.code, room.revision, JSON.stringify(room), Date.now())
    else {
      const result = this.db.prepare('UPDATE svoyak_rooms SET revision=?,snapshot=?,updated_at=? WHERE code=? AND revision=?').run(room.revision, JSON.stringify(room), Date.now(), room.code, expectedRevision)
      if (!result.changes) throw new RoomError('ROOM_CHANGED', 'Комната обновилась. Повторите действие.', 409)
    }
  }
  close() { this.db.close() }
}
