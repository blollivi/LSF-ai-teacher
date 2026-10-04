import type { Dir, ItemState } from './srs';

export interface Membership {
  themeId: number;
  role: 'active' | 'reserve';
  position: number;
}

/** A fully validated word meaning whose sign video is stored on the device. */
export interface Item {
  meaningId: number;
  word: string;
  typology: string;
  definition: string;
  videoSha: string;
  author: string;
  videoUri: string;
  posterUri: string | null;
  themes: Membership[];
}

export interface Theme {
  id: number;
  name: string;
  emoji: string;
  status: 'generating' | 'validating' | 'ready' | 'failed';
  targetActive: number;
  activeCount: number;
  pendingCount: number;
  playable: boolean;
  paused: boolean;
  celebratedTarget: number;
}

export interface Snapshot {
  items: Item[];
  states: Map<number, ItemState>;
  themes: Theme[];
}

export interface Session {
  cardIndex: number;
  /** Wrong answers to ask again a few cards later. */
  relearn: { meaningId: number; dir: Dir; at: number }[];
  /** meaningIds of the last cards shown, most recent last. */
  recent: number[];
  lastRecapAt: number;
  correct: number;
  answered: number;
  combo: number;
  bestCombo: number;
}

export type Meta =
  | { type: 'theme_mastered'; theme: Theme; acquired: number }
  | { type: 'recap'; answered: number; correct: number; acquiredTotal: number; bestCombo: number }
  | { type: 'preparing'; themes: Theme[] }
  | { type: 'all_done'; themes: Theme[] }
  | { type: 'no_theme' };

export type Card =
  | { kind: 'discovery'; item: Item }
  | { kind: 'quiz'; dir: Dir; item: Item; choices: Item[] }
  | { kind: 'meta'; meta: Meta };

export type Rng = () => number;

export function newSession(): Session {
  return { cardIndex: 0, relearn: [], recent: [], lastRecapAt: 0, correct: 0, answered: 0, combo: 0, bestCombo: 0 };
}
