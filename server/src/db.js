/**
 * Basis data Ngobrol (SQLite via node:sqlite).
 *
 * Skema:
 *   users    — pengguna (nama unik, sandi ter-hash)
 *   rooms    — ruang obrolan
 *   messages — pesan dalam ruang (menyimpan nama pengirim saat dikirim)
 *
 * Kehadiran (siapa sedang online) & indikator "sedang menulis" TIDAK disimpan
 * di basis data — keduanya hanya keadaan sesaat di memori server, karena
 * hilang begitu koneksi ditutup.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      slug        TEXT    NOT NULL UNIQUE,
      name        TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id     INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      username    TEXT    NOT NULL,
      body        TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Kehadiran & "sedang menulis" untuk MODE CADANGAN (polling) di host yang
    -- tidak mendukung WebSocket (mis. Vercel). Di mode WebSocket, keduanya
    -- hanya hidup di memori server (hub.js) dan tabel ini tidak dipakai.
    CREATE TABLE IF NOT EXISTS presence (
      user_id      INTEGER NOT NULL,
      room_slug    TEXT    NOT NULL,
      username     TEXT    NOT NULL,
      last_seen    INTEGER NOT NULL,
      typing_until INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, room_slug)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, id);
    CREATE INDEX IF NOT EXISTS idx_presence_room ON presence(room_slug, last_seen);
  `)
}
