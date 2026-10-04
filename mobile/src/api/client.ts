export interface ApiConfig {
  baseUrl: string;
  token: string;
}

export interface ApiTheme {
  id: number;
  name: string;
  emoji: string;
  status: 'generating' | 'validating' | 'ready' | 'failed';
  error: string | null;
  target_active: number;
  active_count: number;
  reserve_count: number;
  pending_count: number;
  rejected_count: number;
  playable: boolean;
}

export interface ApiItem {
  meaning_id: number;
  word: string;
  typology: string;
  definition: string;
  video_url: string;
  poster_url: string | null;
  video_sha: string;
  author: string;
  role: 'active' | 'reserve';
  position: number;
}

export interface ThemeSuggestion {
  name: string;
  emoji: string;
  reason: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function absolute(cfg: ApiConfig, path: string): string {
  return cfg.baseUrl.replace(/\/+$/, '') + path;
}

async function call<T>(cfg: ApiConfig, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(absolute(cfg, path), {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {}
    throw new ApiError(res.status, String(detail));
  }
  return (await res.json()) as T;
}

export const api = {
  health: (cfg: ApiConfig) => call<{ ok: boolean }>(cfg, '/health'),
  listThemes: (cfg: ApiConfig) => call<ApiTheme[]>(cfg, '/themes'),
  getTheme: (cfg: ApiConfig, id: number) => call<ApiTheme & { items: ApiItem[] }>(cfg, `/themes/${id}`),
  createTheme: (cfg: ApiConfig, name: string, size = 12) =>
    call<ApiTheme>(cfg, '/themes', { method: 'POST', body: JSON.stringify({ name, size }) }),
  extendTheme: (cfg: ApiConfig, id: number, count = 10) =>
    call<ApiTheme>(cfg, `/themes/${id}/extend`, { method: 'POST', body: JSON.stringify({ count }) }),
  suggestThemes: (cfg: ApiConfig, knownThemes: string[], acquiredWords: string[]) =>
    call<{ themes: ThemeSuggestion[] }>(cfg, '/themes/suggest', {
      method: 'POST',
      body: JSON.stringify({ known_themes: knownThemes, acquired_words: acquiredWords }),
    }),
};
