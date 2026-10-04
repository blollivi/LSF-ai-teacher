import Constants from 'expo-constants';
import * as SecureStore from './secureStore';
import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { api, type ApiConfig, type ThemeSuggestion } from '../api/client';
import * as repo from '../db/repo';
import { acquiredTotal, markShown, nextCard, recordAnswer } from '../engine/feed';
import { answer as answerSrs, introduce, isAcquired, newState } from '../engine/srs';
import { newSession, type Card, type Item, type Session, type Snapshot } from '../engine/types';
import { cacheMedia } from '../media/cache';

export interface Stats {
  xp: number;
  streak: number;
  lastDay: string | null;
}

interface AppValue {
  ready: boolean;
  cfg: ApiConfig | null;
  saveConfig: (cfg: ApiConfig) => Promise<void>;
  snapshot: Snapshot;
  card: Card | null;
  session: Session;
  stats: Stats;
  acquired: number;
  rate: number;
  setRate: (rate: number) => void;
  syncing: boolean;
  syncError: string | null;
  downloading: number;
  next: () => void;
  discover: (item: Item) => Promise<void>;
  answer: (card: Card & { kind: 'quiz' }, correct: boolean, ms: number) => Promise<void>;
  createTheme: (name: string) => Promise<void>;
  extendTheme: (themeId: number, count?: number) => Promise<void>;
  togglePause: (themeId: number) => Promise<void>;
  suggestThemes: () => Promise<ThemeSuggestion[]>;
  sync: () => Promise<void>;
}

const Ctx = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

const EMPTY: Snapshot = { items: [], states: new Map(), themes: [] };
const TOKEN_KEY = 'apiToken';

const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

/** In development, the backend usually runs on the same machine as the Metro bundler. */
export function guessBaseUrl(): string {
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:8000` : 'http://192.168.1.10:8000';
}

/** Dev-only config injected at bundle time (see .claude/launch.json) to skip onboarding. */
function devConfig(): ApiConfig | null {
  const baseUrl = process.env.EXPO_PUBLIC_DEV_API_URL;
  const token = process.env.EXPO_PUBLIC_DEV_API_TOKEN;
  return __DEV__ && baseUrl && token ? { baseUrl, token } : null;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [ready, setReady] = useState(false);
  const [cfg, setCfg] = useState<ApiConfig | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [session, setSession] = useState<Session>(newSession);
  const [card, setCard] = useState<Card | null>(null);
  const [stats, setStats] = useState<Stats>({ xp: 0, streak: 0, lastDay: null });
  const [rate, setRateState] = useState(0.75);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(0);

  // The feed works on refs so that callbacks always see the latest state.
  const snapRef = useRef(snapshot);
  const sessionRef = useRef(session);
  const cardRef = useRef(card);
  const cfgRef = useRef(cfg);
  const syncingRef = useRef(false);
  const statsRef = useRef(stats);
  snapRef.current = snapshot;
  sessionRef.current = session;
  cardRef.current = card;
  cfgRef.current = cfg;

  const reload = useCallback(async () => {
    const snap = await repo.loadSnapshot(db);
    snapRef.current = snap;
    setSnapshot(snap);
    return snap;
  }, [db]);

  const next = useCallback(() => {
    const c = nextCard(snapRef.current, sessionRef.current, Date.now());
    const s = markShown(sessionRef.current, c);
    sessionRef.current = s;
    cardRef.current = c;
    setSession(s);
    setCard(c);
    if (c.kind === 'meta' && c.meta.type === 'theme_mastered') {
      // Celebrate once per theme size; extending the theme re-arms it.
      const theme = c.meta.theme;
      void repo.setCelebrated(db, theme.id, theme.targetActive).then(reload);
    }
  }, [db, reload]);

  const bumpStats = useCallback(
    async (xp: number) => {
      const s = { ...statsRef.current };
      const d = today();
      if (s.lastDay !== d) {
        s.streak = s.lastDay === yesterday() ? s.streak + 1 : 1;
        s.lastDay = d;
      }
      s.xp += xp;
      statsRef.current = s;
      setStats(s);
      await repo.setKv(db, 'stats', JSON.stringify(s));
    },
    [db],
  );

  const putState = useCallback(
    async (id: number, update: (s: ReturnType<typeof newState>) => ReturnType<typeof newState>) => {
      const snap = snapRef.current;
      const updated = update(snap.states.get(id) ?? newState(id));
      const states = new Map(snap.states);
      states.set(id, updated);
      const nextSnap = { ...snap, states };
      snapRef.current = nextSnap;
      setSnapshot(nextSnap);
      await repo.saveState(db, updated);
    },
    [db],
  );

  const discover = useCallback(
    async (item: Item) => {
      await putState(item.meaningId, (s) => introduce(s, Date.now()));
      await bumpStats(5);
      next();
    },
    [putState, bumpStats, next],
  );

  const answer = useCallback(
    async (c: Card & { kind: 'quiz' }, correct: boolean, ms: number) => {
      await putState(c.item.meaningId, (s) => answerSrs(s, c.dir, correct, Date.now()));
      const s = recordAnswer(sessionRef.current, c, correct);
      sessionRef.current = s;
      setSession(s);
      await repo.logReview(db, c.item.meaningId, c.dir, correct, ms);
      await bumpStats(correct ? 10 + Math.min(s.combo, 5) * 2 : 0);
    },
    [db, putState, bumpStats],
  );

  const sync = useCallback(async () => {
    const conf = cfgRef.current;
    if (!conf || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const themes = await api.listThemes(conf);
      for (const t of themes) await repo.upsertTheme(db, t);
      const local = new Map((await repo.loadSnapshot(db)).themes.map((t) => [t.id, t]));
      for (const t of themes) {
        if (local.get(t.id)?.paused || t.active_count + t.reserve_count === 0) continue;
        const detail = await api.getTheme(conf, t.id);
        await repo.upsertThemeItems(db, t.id, detail.items);
      }
      setSyncError(null);
      await reload();
      const missing = await repo.itemsMissingVideo(db);
      setDownloading(missing.length);
      for (const [k, m] of missing.entries()) {
        const video = await cacheMedia(conf, m.remote_video);
        const poster = m.remote_poster ? await cacheMedia(conf, m.remote_poster).catch(() => null) : null;
        await repo.setMedia(db, m.meaning_id, video, poster);
        setDownloading(missing.length - k - 1);
        if (k % 3 === 2 || k === missing.length - 1) await reload();
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      setDownloading(0);
    }
    // New words may unblock a waiting feed.
    const c = cardRef.current;
    if (c == null || (c.kind === 'meta' && ['preparing', 'all_done', 'no_theme'].includes(c.meta.type))) next();
  }, [db, reload, next]);

  const saveConfig = useCallback(
    async (conf: ApiConfig) => {
      await repo.setKv(db, 'baseUrl', conf.baseUrl);
      await SecureStore.setItemAsync(TOKEN_KEY, conf.token);
      cfgRef.current = conf;
      setCfg(conf);
    },
    [db],
  );

  const createTheme = useCallback(
    async (name: string) => {
      const t = await api.createTheme(cfgRef.current!, name);
      await repo.upsertTheme(db, t);
      await repo.setPaused(db, t.id, false);
      await reload();
      next();
      void sync();
    },
    [db, reload, next, sync],
  );

  const extendTheme = useCallback(
    async (themeId: number, count = 10) => {
      const t = await api.extendTheme(cfgRef.current!, themeId, count);
      await repo.upsertTheme(db, t);
      await reload();
      next();
      void sync();
    },
    [db, reload, next, sync],
  );

  const togglePause = useCallback(
    async (themeId: number) => {
      const t = snapRef.current.themes.find((x) => x.id === themeId);
      if (!t) return;
      await repo.setPaused(db, themeId, !t.paused);
      await reload();
      if (t.paused) void sync();
    },
    [db, reload, sync],
  );

  const suggestThemes = useCallback(async () => {
    const snap = snapRef.current;
    const acquired = snap.items.filter((i) => {
      const s = snap.states.get(i.meaningId);
      return s && isAcquired(s);
    });
    const res = await api.suggestThemes(
      cfgRef.current!,
      snap.themes.map((t) => t.name),
      acquired.map((i) => i.word),
    );
    return res.themes;
  }, []);

  const setRate = useCallback(
    (r: number) => {
      setRateState(r);
      void repo.setKv(db, 'rate', String(r));
    },
    [db],
  );

  // Boot: config, preferences, local snapshot, first card.
  useEffect(() => {
    (async () => {
      const [baseUrl, token, rawStats, rawRate] = await Promise.all([
        repo.getKv(db, 'baseUrl'),
        SecureStore.getItemAsync(TOKEN_KEY),
        repo.getKv(db, 'stats'),
        repo.getKv(db, 'rate'),
      ]);
      const conf = baseUrl && token ? { baseUrl, token } : devConfig();
      if (conf) {
        cfgRef.current = conf;
        setCfg(conf);
      }
      if (rawStats) {
        statsRef.current = JSON.parse(rawStats);
        setStats(statsRef.current);
      }
      if (rawRate) setRateState(Number(rawRate));
      await reload();
      next();
      setReady(true);
    })();
  }, [db, reload, next]);

  // Background sync: frequent while the backend is building a theme or videos are missing.
  const busy = snapshot.themes.some((t) => t.status === 'generating' || t.status === 'validating');
  useEffect(() => {
    if (!cfg) return;
    void sync();
    const id = setInterval(() => void sync(), busy ? 6_000 : 60_000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void sync());
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [cfg, busy, sync]);

  const acquired = useMemo(() => acquiredTotal(snapshot), [snapshot]);

  const value: AppValue = {
    ready, cfg, saveConfig, snapshot, card, session, stats, acquired, rate, setRate, syncing, syncError,
    downloading, next, discover, answer, createTheme, extendTheme, togglePause, suggestThemes, sync,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
