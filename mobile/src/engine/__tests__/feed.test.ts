import { expect, test } from '@jest/globals';
import { DAY, isLearning, stage } from '../srs';
import { LEARNING_MAX, nextCard, RELEARN_GAP } from '../feed';
import { newSession } from '../types';
import { item, play, seededRng, snapshot, theme } from '../test-helpers';

const T0 = 1_700_000_000_000;
const tenWords = (themeId = 1, offset = 0) => Array.from({ length: 10 }, (_, k) => item(offset + k + 1, themeId, k));

test('asks to create a theme when there is none', () => {
  expect(nextCard(snapshot([], []), newSession(), T0)).toEqual({ kind: 'meta', meta: { type: 'no_theme' } });
});

test('starts with a discovery card, never quizzes a word before showing it', () => {
  const snap = snapshot([theme(1)], tenWords());
  const { cards } = play(snap, 40, T0);
  expect(cards[0].kind).toBe('discovery');
  const discovered = new Set<number>();
  for (const c of cards) {
    if (c.kind === 'discovery') discovered.add(c.item.meaningId);
    if (c.kind === 'quiz') expect(discovered.has(c.item.meaningId)).toBe(true);
  }
});

test('first quiz of a word is video -> word with 3 choices, later ones have 4', () => {
  const snap = snapshot([theme(1)], tenWords());
  const { cards } = play(snap, 60, T0);
  const quizzes = cards.filter((c) => c.kind === 'quiz');
  const first = quizzes[0];
  expect(first.kind === 'quiz' && first.dir).toBe('R');
  expect(first.kind === 'quiz' && first.choices).toHaveLength(3);
  expect(quizzes.some((c) => c.kind === 'quiz' && c.dir === 'P' && c.choices.length === 4)).toBe(true);
  for (const c of quizzes) if (c.kind === 'quiz') expect(c.choices).toContainEqual(c.item);
});

test('never more than LEARNING_MAX words in learning, even for a struggling learner', () => {
  const snap = snapshot([theme(1)], tenWords());
  let k = 0;
  play(snap, 80, T0, () => k++ % 2 === 0);
  const learning = snap.items.filter((i) => isLearning(snap.states.get(i.meaningId) ?? ({} as never)));
  expect(learning.length).toBeLessThanOrEqual(LEARNING_MAX);
});

test('a wrong answer comes back a few cards later', () => {
  const snap = snapshot([theme(1)], tenWords());
  let failed: number | null = null;
  const { cards } = play(snap, 30, T0, (c) => {
    if (failed == null) {
      failed = c.item.meaningId;
      return false;
    }
    return true;
  });
  const failIdx = cards.findIndex((c) => c.kind === 'quiz' && c.item.meaningId === failed);
  const again = cards.findIndex((c, idx) => idx > failIdx && c.kind === 'quiz' && c.item.meaningId === failed);
  expect(again - failIdx).toBeGreaterThanOrEqual(RELEARN_GAP);
  expect(again - failIdx).toBeLessThanOrEqual(RELEARN_GAP + 1);
});

test('the next day, due reviews come before new words', () => {
  const snap = snapshot([theme(1)], tenWords());
  play(snap, 15, T0);
  const next = nextCard(snap, newSession(), T0 + DAY, seededRng());
  expect(next.kind).toBe('quiz');
});

test('a perfect learner masters the theme over a few days and the feed celebrates it', () => {
  const snap = snapshot([theme(1)], tenWords());
  let mastered = false;
  for (let day = 0; day < 6 && !mastered; day++) {
    const { cards } = play(snap, 60, T0 + day * DAY);
    mastered = cards.some((c) => c.kind === 'meta' && c.meta.type === 'theme_mastered');
  }
  expect(mastered).toBe(true);
  const acquired = snap.items.filter((i) => stage(snap.states.get(i.meaningId)!) === 'acquired').length;
  expect(acquired).toBeGreaterThanOrEqual(8);
});

test('when everything is learnt for today, the feed says so', () => {
  const snap = snapshot([theme(1)], tenWords().slice(0, 4));
  const { cards } = play(snap, 100, T0);
  const last = cards[cards.length - 1];
  expect(last.kind === 'meta' && last.meta.type).toBe('all_done');
});

test('a theme still being built shows the preparing card instead of all_done', () => {
  const snap = snapshot([theme(1, { status: 'validating' })], []);
  const card = nextCard(snap, newSession(), T0);
  expect(card.kind === 'meta' && card.meta.type).toBe('preparing');
});

test('new words are interleaved across themes and paused themes add no new words', () => {
  const snap = snapshot([theme(1), theme(2)], [...tenWords(1, 0), ...tenWords(2, 100)]);
  const { cards } = play(snap, 40, T0);
  const themesSeen = new Set(cards.filter((c) => c.kind === 'discovery').map((c) => (c.kind === 'discovery' ? c.item.themes[0].themeId : 0)));
  expect(themesSeen).toEqual(new Set([1, 2]));

  const paused = snapshot([theme(1), theme(2, { paused: true })], [...tenWords(1, 0), ...tenWords(2, 100)]);
  const { cards: c2 } = play(paused, 40, T0);
  expect(c2.every((c) => c.kind !== 'discovery' || c.item.themes[0].themeId === 1)).toBe(true);
});

test('a recap card appears every 20 cards', () => {
  const snap = snapshot([theme(1, { targetActive: 20 })], [...tenWords(1, 0), ...tenWords(1, 10).map((i) => ({ ...i, themes: [{ ...i.themes[0], position: i.themes[0].position + 10 }] }))]);
  const { cards } = play(snap, 45, T0);
  const recaps = cards.map((c, i) => (c.kind === 'meta' && c.meta.type === 'recap' ? i : -1)).filter((i) => i >= 0);
  expect(recaps.length).toBe(2);
});

test('a theme still being built introduces no word until it is playable', () => {
  const words = tenWords().slice(0, 2);
  const building = snapshot([theme(1, { status: 'validating', playable: false })], words);
  const card = nextCard(building, newSession(), T0);
  expect(card.kind === 'meta' && card.meta.type).toBe('preparing');

  const playable = snapshot([theme(1, { status: 'validating', playable: true })], tenWords().slice(0, 4));
  expect(nextCard(playable, newSession(), T0).kind).toBe('discovery');
});
