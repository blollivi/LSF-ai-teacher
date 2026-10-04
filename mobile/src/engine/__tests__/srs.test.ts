import { expect, test } from '@jest/globals';
import { answer, DAY, dueDir, HOUR, introduce, isAcquired, isLearning, newState, stage } from '../srs';

const T0 = 1_700_000_000_000;

test('a word becomes acquired only after both directions succeed after a delay', () => {
  let s = introduce(newState(1), T0);
  expect(stage(s)).toBe('discovered');
  s = answer(s, 'R', true, T0);
  expect(stage(s)).toBe('recognized');
  expect(s.pUnlocked).toBe(true);
  s = answer(s, 'P', true, T0 + 1000);
  expect(stage(s)).toBe('retrieved');
  expect(isAcquired(s)).toBe(false);
  expect(isLearning(s)).toBe(false);

  expect(dueDir(s, T0 + HOUR)).toBeNull();
  const later = T0 + DAY;
  expect(dueDir(s, later)).toBe('R');
  s = answer(s, 'R', true, later);
  expect(isAcquired(s)).toBe(false);
  s = answer(s, 'P', true, later);
  expect(stage(s)).toBe('acquired');
});

test('answering correctly again in the same session does not count as a delayed success', () => {
  let s = introduce(newState(1), T0);
  s = answer(s, 'R', true, T0);
  s = answer(s, 'R', true, T0 + 60_000);
  expect(s.rBox).toBe(1);
});

test('a mistake sends the direction back to box 0 and an acquired word becomes lapsed', () => {
  let s = introduce(newState(1), T0);
  for (const t of [T0, T0 + DAY]) {
    s = answer(s, 'R', true, t);
    s = answer(s, 'P', true, t);
  }
  expect(stage(s)).toBe('acquired');
  s = answer(s, 'P', false, T0 + 5 * DAY);
  expect(s.pBox).toBe(0);
  expect(stage(s)).toBe('lapsed');
  expect(isLearning(s)).toBe(true);
});

test('P is never due before R was answered correctly', () => {
  let s = introduce(newState(1), T0);
  s = answer(s, 'R', false, T0);
  expect(s.pUnlocked).toBe(false);
  expect(dueDir(s, T0 + 10 * DAY)).toBeNull();
});
