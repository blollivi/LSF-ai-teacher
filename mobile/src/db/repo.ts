import type { SQLiteDatabase } from 'expo-sqlite';

import type { ApiItem, ApiTheme } from '../api/client';
import type { ItemState } from '../engine/srs';
import type { Item, Membership, Snapshot, Theme } from '../engine/types';

interface ThemeRow {
  id: number;
  name: string;
  emoji: string;
  status: Theme['status'];
  target_active: number;
  active_count: number;
  pending_count: number;
  playable: number;
  paused: number;
  celebrated_target: number;
}

interface ItemRow {
  meaning_id: number;
  word: string;
  typology: string;
  definition: string;
  video_sha: string;
  author: string;
  video_uri: string;
  poster_uri: string | null;
}

interface StateRow {
  meaning_id: number;
  introduced_at: number | null;
  r_box: number;
  r_due: number | null;
  p_box: number;
  p_due: number | null;
  p_unlocked: number;
  ever_acquired: number;
  last_seen: number | null;
}

const toTheme = (r: ThemeRow): Theme => ({
  id: r.id,
  name: r.name,
  emoji: r.emoji,
  status: r.status,
  targetActive: r.target_active,
  activeCount: r.active_count,
  pendingCount: r.pending_count,
  playable: !!r.playable,
  paused: !!r.paused,
  celebratedTarget: r.celebrated_target,
});

const toState = (r: StateRow): ItemState => ({
  meaningId: r.meaning_id,
  introducedAt: r.introduced_at,
  rBox: r.r_box,
  rDue: r.r_due,
  pBox: r.p_box,
  pDue: r.p_due,
  pUnlocked: !!r.p_unlocked,
  everAcquired: !!r.ever_acquired,
  lastSeen: r.last_seen,
});

/** Everything the feed engine needs. Only items whose video is on the device are included. */
export async function loadSnapshot(db: SQLiteDatabase): Promise<Snapshot> {
  const themes = (await db.getAllAsync<ThemeRow>('SELECT * FROM themes ORDER BY id')).map(toTheme);
  const rows = await db.getAllAsync<ItemRow>('SELECT * FROM items WHERE video_uri IS NOT NULL');
  const memberships = await db.getAllAsync<Membership & { meaning_id: number; theme_id: number }>(
    'SELECT theme_id, meaning_id, role, position FROM theme_items',
  );
  const byItem = new Map<number, Membership[]>();
  for (const m of memberships) {
    const list = byItem.get(m.meaning_id) ?? [];
    list.push({ themeId: m.theme_id, role: m.role, position: m.position });
    byItem.set(m.meaning_id, list);
  }
  const items: Item[] = rows.map((r) => ({
    meaningId: r.meaning_id,
    word: r.word,
    typology: r.typology,
    definition: r.definition,
    videoSha: r.video_sha,
    author: r.author,
    videoUri: r.video_uri,
    posterUri: r.poster_uri,
    themes: byItem.get(r.meaning_id) ?? [],
  }));
  const states = new Map(
    (await db.getAllAsync<StateRow>('SELECT * FROM item_state')).map((r) => [r.meaning_id, toState(r)]),
  );
  return { themes, items, states };
}

export async function upsertTheme(db: SQLiteDatabase, t: ApiTheme): Promise<void> {
  await db.runAsync(
    `INSERT INTO themes (id, name, emoji, status, target_active, active_count, pending_count, playable)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, emoji=excluded.emoji, status=excluded.status,
       target_active=excluded.target_active, active_count=excluded.active_count,
       pending_count=excluded.pending_count, playable=excluded.playable`,
    [t.id, t.name, t.emoji, t.status, t.target_active, t.active_count, t.pending_count, t.playable ? 1 : 0],
  );
}

export async function upsertThemeItems(db: SQLiteDatabase, themeId: number, items: ApiItem[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const i of items) {
      await db.runAsync(
        `INSERT INTO items (meaning_id, word, typology, definition, video_sha, author, remote_video, remote_poster)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(meaning_id) DO UPDATE SET word=excluded.word, typology=excluded.typology,
           definition=excluded.definition, author=excluded.author,
           remote_video=excluded.remote_video, remote_poster=excluded.remote_poster`,
        [i.meaning_id, i.word, i.typology, i.definition, i.video_sha, i.author, i.video_url, i.poster_url],
      );
      await db.runAsync(
        `INSERT INTO theme_items (theme_id, meaning_id, role, position) VALUES (?, ?, ?, ?)
         ON CONFLICT(theme_id, meaning_id) DO UPDATE SET role=excluded.role, position=excluded.position`,
        [themeId, i.meaning_id, i.role, i.position],
      );
    }
  });
}

export interface MissingMedia {
  meaning_id: number;
  remote_video: string;
  remote_poster: string | null;
}

/** Items without a local video, active words first (they are the next ones to learn). */
export function itemsMissingVideo(db: SQLiteDatabase): Promise<MissingMedia[]> {
  return db.getAllAsync<MissingMedia>(
    `SELECT i.meaning_id, i.remote_video, i.remote_poster FROM items i
     JOIN theme_items ti ON ti.meaning_id = i.meaning_id
     WHERE i.video_uri IS NULL
     GROUP BY i.meaning_id
     ORDER BY MIN(CASE ti.role WHEN 'active' THEN 0 ELSE 1 END), MIN(ti.position)`,
  );
}

export async function setMedia(db: SQLiteDatabase, meaningId: number, videoUri: string, posterUri: string | null) {
  await db.runAsync('UPDATE items SET video_uri = ?, poster_uri = ? WHERE meaning_id = ?', [videoUri, posterUri, meaningId]);
}

export async function saveState(db: SQLiteDatabase, s: ItemState): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO item_state
       (meaning_id, introduced_at, r_box, r_due, p_box, p_due, p_unlocked, ever_acquired, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [s.meaningId, s.introducedAt, s.rBox, s.rDue, s.pBox, s.pDue, s.pUnlocked ? 1 : 0, s.everAcquired ? 1 : 0, s.lastSeen],
  );
}

export async function logReview(db: SQLiteDatabase, meaningId: number, kind: string, correct: boolean, ms: number) {
  await db.runAsync('INSERT INTO reviews (meaning_id, kind, correct, ms, ts) VALUES (?, ?, ?, ?, ?)', [
    meaningId, kind, correct ? 1 : 0, Math.round(ms), Date.now(),
  ]);
}

export async function setPaused(db: SQLiteDatabase, themeId: number, paused: boolean) {
  await db.runAsync('UPDATE themes SET paused = ? WHERE id = ?', [paused ? 1 : 0, themeId]);
}

export async function setCelebrated(db: SQLiteDatabase, themeId: number, target: number) {
  await db.runAsync('UPDATE themes SET celebrated_target = ? WHERE id = ?', [target, themeId]);
}

export async function getKv(db: SQLiteDatabase, key: string): Promise<string | null> {
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]))?.value ?? null;
}

export async function setKv(db: SQLiteDatabase, key: string, value: string) {
  await db.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, value]);
}
