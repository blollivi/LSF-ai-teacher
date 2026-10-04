// Decides the next card of the endless feed. Pure and deterministic given (snapshot, session, now, rng):
// the LLM never sits on this path, so the next card is always instant.

import { pickDistractors } from './distractors';
import { dueDir, isAcquired, isLearning, learningDir, newState, type Dir, type ItemState } from './srs';
import type { Card, Item, Meta, Rng, Session, Snapshot, Theme } from './types';

export const LEARNING_TARGET = 3; // new words are introduced until this many are in learning...
export const LEARNING_MAX = 6; // ...and up to this many if there's nothing else to practise
export const RECAP_EVERY = 20;
export const RELEARN_GAP = 3;
export const MASTERED_RATIO = 0.8;
export const MIN_THEME_SIZE = 4;

const stateOf = (snap: Snapshot, id: number): ItemState => snap.states.get(id) ?? newState(id);

export function activeItems(snap: Snapshot, theme: Theme): Item[] {
  return snap.items.filter((i) => i.themes.some((m) => m.themeId === theme.id && m.role === 'active'));
}

export function themeProgress(snap: Snapshot, theme: Theme) {
  const items = activeItems(snap, theme);
  const acquired = items.filter((i) => isAcquired(stateOf(snap, i.meaningId))).length;
  return { total: items.length, acquired, ratio: items.length ? acquired / items.length : 0 };
}

export function acquiredTotal(snap: Snapshot): number {
  return snap.items.filter((i) => isAcquired(stateOf(snap, i.meaningId))).length;
}

function newCandidates(snap: Snapshot, session: Session): Item[] {
  // A theme still being built feeds new words only once it has enough of them for a QCM.
  const open = new Map(
    snap.themes.filter((t) => !t.paused && (t.playable || t.status === 'ready')).map((t, idx) => [t.id, idx]),
  );
  const k = Math.max(open.size, 1);
  const rank = (i: Item) => {
    const ms = i.themes.filter((m) => m.role === 'active' && open.has(m.themeId));
    const best = ms.reduce((a, m) => (m.position < a.position ? m : a), ms[0]);
    // Interleave themes: same position across themes, rotated so no theme always comes first.
    return best.position * k + ((open.get(best.themeId)! + session.cardIndex) % k);
  };
  return snap.items
    .filter((i) => stateOf(snap, i.meaningId).introducedAt == null)
    .filter((i) => i.themes.some((m) => m.role === 'active' && open.has(m.themeId)))
    .sort((a, b) => rank(a) - rank(b));
}

function quiz(snap: Snapshot, item: Item, dir: Dir, rng: Rng): Card {
  const s = stateOf(snap, item.meaningId);
  const firstTime = dir === 'R' && s.rBox === 0 && !s.pUnlocked;
  const distractors = pickDistractors(item, snap.items, snap.states, firstTime ? 2 : 3, rng);
  if (distractors.length === 0) return { kind: 'discovery', item };
  const choices = [...distractors];
  choices.splice(Math.floor(rng() * (choices.length + 1)), 0, item);
  return { kind: 'quiz', dir, item, choices };
}

function meta(meta: Meta): Card {
  return { kind: 'meta', meta };
}

export function nextCard(snap: Snapshot, session: Session, now: number, rng: Rng = Math.random): Card {
  if (snap.themes.length === 0) return meta({ type: 'no_theme' });

  // Milestones first: they are what makes the feed move on to more vocabulary.
  for (const theme of snap.themes) {
    if (theme.paused || theme.celebratedTarget >= theme.targetActive) continue;
    const p = themeProgress(snap, theme);
    if (p.total >= MIN_THEME_SIZE && p.ratio >= MASTERED_RATIO) {
      return meta({ type: 'theme_mastered', theme, acquired: p.acquired });
    }
  }
  if (session.answered > 0 && session.cardIndex - session.lastRecapAt >= RECAP_EVERY) {
    return meta({
      type: 'recap',
      answered: session.answered,
      correct: session.correct,
      acquiredTotal: acquiredTotal(snap),
      bestCombo: session.bestCombo,
    });
  }

  const byId = new Map(snap.items.map((i) => [i.meaningId, i]));
  const last = session.recent[session.recent.length - 1];
  const recent = new Set(session.recent.slice(-2));
  const inRelearn = new Set(session.relearn.map((r) => r.meaningId));

  // 1. Mistakes of this session, a few cards later.
  const relearn = session.relearn
    .filter((r) => r.at <= session.cardIndex && byId.has(r.meaningId) && r.meaningId !== last)
    .sort((a, b) => a.at - b.at)[0];
  if (relearn) return quiz(snap, byId.get(relearn.meaningId)!, relearn.dir, rng);

  // 2. Spaced reviews that are due, oldest first.
  const due = snap.items
    .filter((i) => !inRelearn.has(i.meaningId))
    .map((i) => ({ item: i, s: stateOf(snap, i.meaningId) }))
    .map(({ item, s }) => ({ item, dir: dueDir(s, now), s }))
    .filter((x): x is { item: Item; dir: Dir; s: ItemState } => x.dir != null)
    .sort((a, b) => (a.dir === 'R' ? a.s.rDue! : a.s.pDue!) - (b.dir === 'R' ? b.s.rDue! : b.s.pDue!));
  const review = due.find((x) => x.item.meaningId !== last) ?? due[0];
  if (review) return quiz(snap, review.item, review.dir, rng);

  // 3. Learning: introduce new words in small batches and drill them until they leave box 0.
  const learning = snap.items.filter((i) => isLearning(stateOf(snap, i.meaningId)) && !inRelearn.has(i.meaningId));
  const learningCount = snap.items.filter((i) => isLearning(stateOf(snap, i.meaningId))).length;
  const fresh = newCandidates(snap, session);
  const leastRecent = (xs: Item[]) =>
    [...xs].sort((a, b) => (stateOf(snap, a.meaningId).lastSeen ?? 0) - (stateOf(snap, b.meaningId).lastSeen ?? 0))[0];

  if (learningCount < LEARNING_TARGET && fresh.length) return { kind: 'discovery', item: fresh[0] };
  const spaced = learning.filter((i) => !recent.has(i.meaningId));
  if (spaced.length) {
    const item = leastRecent(spaced);
    return quiz(snap, item, learningDir(stateOf(snap, item.meaningId))!, rng);
  }
  if (learningCount < LEARNING_MAX && fresh.length) return { kind: 'discovery', item: fresh[0] };
  if (learning.length) {
    const item = leastRecent(learning);
    return quiz(snap, item, learningDir(stateOf(snap, item.meaningId))!, rng);
  }
  const pendingRelearn = session.relearn.filter((r) => byId.has(r.meaningId)).sort((a, b) => a.at - b.at)[0];
  if (pendingRelearn) return quiz(snap, byId.get(pendingRelearn.meaningId)!, pendingRelearn.dir, rng);

  // 4. Nothing left to practise right now.
  const building = snap.themes.filter((t) => t.status === 'generating' || t.status === 'validating');
  if (building.length && building.some((t) => !t.paused)) return meta({ type: 'preparing', themes: building });
  return meta({ type: 'all_done', themes: snap.themes });
}

/** Book-keeping once a card has been displayed. */
export function markShown(session: Session, card: Card): Session {
  const next: Session = { ...session, cardIndex: session.cardIndex + 1 };
  if (card.kind === 'meta') {
    if (card.meta.type === 'recap') next.lastRecapAt = next.cardIndex;
    return next;
  }
  next.recent = [...session.recent, card.item.meaningId].slice(-5);
  if (card.kind === 'quiz') {
    next.relearn = session.relearn.filter((r) => !(r.meaningId === card.item.meaningId && r.dir === card.dir));
  }
  return next;
}

export function recordAnswer(session: Session, card: Card & { kind: 'quiz' }, correct: boolean): Session {
  const combo = correct ? session.combo + 1 : 0;
  return {
    ...session,
    answered: session.answered + 1,
    correct: session.correct + (correct ? 1 : 0),
    combo,
    bestCombo: Math.max(session.bestCombo, combo),
    relearn: correct
      ? session.relearn
      : [...session.relearn, { meaningId: card.item.meaningId, dir: card.dir, at: session.cardIndex + RELEARN_GAP }],
  };
}
