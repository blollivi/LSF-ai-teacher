import { type ItemState } from './srs';
import type { Item, Rng } from './types';

export function shuffle<T>(xs: T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const norm = (w: string) => w.trim().toLowerCase();

/**
 * Wrong answers for a QCM. Closest first: words of the same theme the learner has already met,
 * then the rest of the theme (incl. reserve), then other themes. Never a homonym nor the same video.
 */
export function pickDistractors(target: Item, pool: Item[], states: Map<number, ItemState>, n: number, rng: Rng): Item[] {
  const themeIds = new Set(target.themes.map((t) => t.themeId));
  const sameTheme = (i: Item) => i.themes.some((t) => themeIds.has(t.themeId));
  const seen = (i: Item) => states.get(i.meaningId)?.introducedAt != null;
  const ok = pool.filter(
    (i) => i.meaningId !== target.meaningId && norm(i.word) !== norm(target.word) && i.videoSha !== target.videoSha,
  );
  const tiers = [
    ok.filter((i) => sameTheme(i) && seen(i)),
    ok.filter((i) => sameTheme(i) && !seen(i)),
    ok.filter((i) => !sameTheme(i) && seen(i)),
    ok.filter((i) => !sameTheme(i) && !seen(i)),
  ];
  const out: Item[] = [];
  const words = new Set([norm(target.word)]);
  for (const tier of tiers) {
    for (const i of shuffle(tier, rng)) {
      if (out.length >= n) return out;
      if (words.has(norm(i.word))) continue;
      words.add(norm(i.word));
      out.push(i);
    }
  }
  return out;
}
