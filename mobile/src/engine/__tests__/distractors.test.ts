import { expect, test } from '@jest/globals';
import { pickDistractors } from '../distractors';
import { introduce, newState } from '../srs';
import { item, seededRng } from '../test-helpers';

test('prefers seen words of the same theme and excludes homonyms and identical videos', () => {
  const target = item(1, 1, 0, { word: 'pomme' });
  const pool = [
    target,
    item(2, 1, 1, { word: 'Pomme' }), // homonym (another meaning)
    item(3, 1, 2, { videoSha: 'sha1' }), // same video
    item(4, 1, 3),
    item(5, 1, 4),
    item(6, 2, 0),
    item(7, 2, 1),
  ];
  const states = new Map([[4, introduce(newState(4), 0)]]);
  const out = pickDistractors(target, pool, states, 3, seededRng());
  const ids = out.map((i) => i.meaningId);
  expect(ids[0]).toBe(4);
  expect(ids).toContain(5);
  expect(ids).not.toContain(2);
  expect(ids).not.toContain(3);
  expect(ids).toHaveLength(3);
});
