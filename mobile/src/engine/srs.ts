// Spaced repetition: one Leitner box per exercise direction.
//   R = recognition (sign video -> word), P = production-side recall (word -> sign video).
// A word is "acquired" once both directions were answered correctly *after a delay* (box >= 2).

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

// Waiting time before the next question, indexed by the box reached after a correct answer.
// Box 0 = still learning: asked again in the same session.
export const INTERVALS = [0, 20 * HOUR, 3 * DAY, 7 * DAY, 21 * DAY, 60 * DAY];
export const MAX_BOX = INTERVALS.length - 1;
export const ACQUIRED_BOX = 2;

export type Dir = 'R' | 'P';

export type Stage = 'new' | 'discovered' | 'recognized' | 'retrieved' | 'acquired' | 'lapsed';

export interface ItemState {
  meaningId: number;
  introducedAt: number | null;
  rBox: number;
  rDue: number | null;
  pBox: number;
  pDue: number | null;
  pUnlocked: boolean;
  everAcquired: boolean;
  lastSeen: number | null;
}

export function newState(meaningId: number): ItemState {
  return {
    meaningId,
    introducedAt: null,
    rBox: 0,
    rDue: null,
    pBox: 0,
    pDue: null,
    pUnlocked: false,
    everAcquired: false,
    lastSeen: null,
  };
}

export function introduce(s: ItemState, now: number): ItemState {
  return { ...s, introducedAt: now, rBox: 0, rDue: now, lastSeen: now };
}

export function isAcquired(s: ItemState): boolean {
  return s.rBox >= ACQUIRED_BOX && s.pBox >= ACQUIRED_BOX;
}

export function stage(s: ItemState): Stage {
  if (s.introducedAt == null) return 'new';
  if (isAcquired(s)) return 'acquired';
  if (s.everAcquired) return 'lapsed';
  if (s.pBox >= 1) return 'retrieved';
  if (s.pUnlocked) return 'recognized';
  return 'discovered';
}

/** Introduced, and at least one unlocked direction is still in box 0. */
export function isLearning(s: ItemState): boolean {
  return s.introducedAt != null && (s.rBox === 0 || (s.pUnlocked && s.pBox === 0));
}

/** The box-0 direction to practise next for a learning item (R before P). */
export function learningDir(s: ItemState): Dir | null {
  if (s.introducedAt == null) return null;
  if (s.rBox === 0) return 'R';
  if (s.pUnlocked && s.pBox === 0) return 'P';
  return null;
}

/** The earliest overdue review direction (box >= 1), if any. */
export function dueDir(s: ItemState, now: number): Dir | null {
  const r = s.introducedAt != null && s.rBox >= 1 && s.rDue != null && s.rDue <= now ? s.rDue : null;
  const p = s.pUnlocked && s.pBox >= 1 && s.pDue != null && s.pDue <= now ? s.pDue : null;
  if (r == null && p == null) return null;
  if (p == null) return 'R';
  if (r == null) return 'P';
  return r <= p ? 'R' : 'P';
}

export function answer(s: ItemState, dir: Dir, correct: boolean, now: number): ItemState {
  const box = dir === 'R' ? s.rBox : s.pBox;
  const due = dir === 'R' ? s.rDue : s.pDue;
  let newBox: number;
  if (!correct) {
    newBox = 0;
  } else if (box >= 1 && due != null && now < due) {
    // Answered before the review was due (e.g. card shown twice): no promotion, the delay is what counts.
    newBox = box;
  } else {
    newBox = Math.min(box + 1, MAX_BOX);
  }
  const newDue = correct && newBox === box && box >= 1 ? due : now + INTERVALS[newBox];
  const next: ItemState = { ...s, lastSeen: now };
  if (dir === 'R') {
    next.rBox = newBox;
    next.rDue = newDue;
    if (correct && !s.pUnlocked) {
      next.pUnlocked = true;
      next.pDue = now;
    }
  } else {
    next.pBox = newBox;
    next.pDue = newDue;
  }
  next.everAcquired = s.everAcquired || isAcquired(next);
  return next;
}
