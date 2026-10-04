import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';

import type { Card, Item } from '../../engine/types';

const AUTO_ADVANCE_MS = 900;

/** Shared QCM logic: one pick, immediate feedback, auto-advance on success. */
export function useQuiz(
  card: Card & { kind: 'quiz' },
  onAnswer: (correct: boolean, ms: number) => Promise<void>,
  onNext: () => void,
) {
  const [picked, setPicked] = useState<Item | null>(null);
  const shownAt = useRef(Date.now());
  const correct = picked?.meaningId === card.item.meaningId;

  const pick = (choice: Item) => {
    if (picked) return;
    setPicked(choice);
    const ok = choice.meaningId === card.item.meaningId;
    void Haptics.notificationAsync(ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
    void onAnswer(ok, Date.now() - shownAt.current);
  };

  useEffect(() => {
    if (!picked || !correct) return;
    const t = setTimeout(onNext, AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
  }, [picked, correct, onNext]);

  const status = (choice: Item): 'idle' | 'right' | 'wrong' | 'dim' => {
    if (!picked) return 'idle';
    if (choice.meaningId === card.item.meaningId) return 'right';
    if (choice.meaningId === picked.meaningId) return 'wrong';
    return 'dim';
  };

  return { picked, correct, pick, status };
}
