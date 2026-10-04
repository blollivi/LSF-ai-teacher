import type { SQLiteDatabase } from 'expo-sqlite';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE themes (
    id INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '📚',
    status TEXT NOT NULL,
    target_active INTEGER NOT NULL DEFAULT 0,
    active_count INTEGER NOT NULL DEFAULT 0,
    pending_count INTEGER NOT NULL DEFAULT 0,
    playable INTEGER NOT NULL DEFAULT 0,
    paused INTEGER NOT NULL DEFAULT 0,
    celebrated_target INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE items (
    meaning_id INTEGER PRIMARY KEY NOT NULL,
    word TEXT NOT NULL,
    typology TEXT NOT NULL DEFAULT '',
    definition TEXT NOT NULL DEFAULT '',
    video_sha TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    remote_video TEXT NOT NULL,
    remote_poster TEXT,
    video_uri TEXT,
    poster_uri TEXT
  );
  CREATE TABLE theme_items (
    theme_id INTEGER NOT NULL,
    meaning_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (theme_id, meaning_id)
  );
  CREATE TABLE item_state (
    meaning_id INTEGER PRIMARY KEY NOT NULL,
    introduced_at INTEGER,
    r_box INTEGER NOT NULL DEFAULT 0,
    r_due INTEGER,
    p_box INTEGER NOT NULL DEFAULT 0,
    p_due INTEGER,
    p_unlocked INTEGER NOT NULL DEFAULT 0,
    ever_acquired INTEGER NOT NULL DEFAULT 0,
    last_seen INTEGER
  );
  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meaning_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    correct INTEGER NOT NULL,
    ms INTEGER NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  `,
];

export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[version]);
    });
    version += 1;
    await db.execAsync(`PRAGMA user_version = ${version}`);
  }
}
