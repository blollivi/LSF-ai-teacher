import { answer, introduce, newState, type ItemState } from './srs';
import { markShown, nextCard, recordAnswer } from './feed';
import { newSession, type Card, type Item, type Session, type Snapshot, type Theme } from './types';

export function seededRng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function theme(id: number, over: Partial<Theme> = {}): Theme {
  return {
    id, name: `Thème ${id}`, emoji: '📚', status: 'ready', targetActive: 10, activeCount: 10,
    pendingCount: 0, playable: true, paused: false, celebratedTarget: 0, ...over,
  };
}

export function item(meaningId: number, themeId: number, position: number, over: Partial<Item> = {}): Item {
  return {
    meaningId, word: `mot${meaningId}`, typology: 'n.', definition: '', videoSha: `sha${meaningId}`, author: '',
    videoUri: `file:///v/${meaningId}.mp4`, posterUri: null,
    themes: [{ themeId, role: 'active', position }], ...over,
  };
}

export function snapshot(themes: Theme[], items: Item[]): Snapshot {
  return { themes, items, states: new Map<number, ItemState>() };
}

/** Plays the feed like a learner; `isCorrect` decides each answer. Returns the cards shown. */
export function play(
  snap: Snapshot, n: number, now: number, isCorrect: (card: Card & { kind: 'quiz' }) => boolean = () => true,
  session: Session = newSession(), rng = seededRng(),
): { cards: Card[]; session: Session } {
  const cards: Card[] = [];
  for (let k = 0; k < n; k++) {
    const card = nextCard(snap, session, now, rng);
    cards.push(card);
    session = markShown(session, card);
    if (card.kind === 'discovery') {
      snap.states.set(card.item.meaningId, introduce(snap.states.get(card.item.meaningId) ?? newState(card.item.meaningId), now));
    } else if (card.kind === 'quiz') {
      const ok = isCorrect(card);
      snap.states.set(card.item.meaningId, answer(snap.states.get(card.item.meaningId)!, card.dir, ok, now));
      session = recordAnswer(session, card, ok);
    } else if (card.meta.type === 'theme_mastered') {
      card.meta.theme.celebratedTarget = card.meta.theme.targetActive;
    } else if (card.meta.type !== 'recap') {
      break; // all_done / preparing / no_theme: the learner would leave here
    }
    now += 10_000;
  }
  return { cards, session };
}
