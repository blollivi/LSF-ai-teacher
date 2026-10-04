import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Card } from '../../engine/types';
import { useColors } from '../../ui/colors';
import { Button, Label } from '../../ui/kit';
import { SignVideo } from '../../ui/SignVideo';
import { useQuiz } from './useQuiz';

export function WordToVideoCard({
  card, rate, onAnswer, onNext,
}: {
  card: Card & { kind: 'quiz' };
  rate: number;
  onAnswer: (correct: boolean, ms: number) => Promise<void>;
  onNext: () => void;
}) {
  const c = useColors();
  const { picked, correct, pick, status } = useQuiz(card, onAnswer, onNext);
  return (
    <View style={styles.wrap}>
      <Label>🤲 Quel signe veut dire…</Label>
      <View>
        <Text style={[styles.word, { color: c.ink }]}>{card.item.word}</Text>
        {card.item.typology ? <Text style={[styles.typo, { color: c.muted }]}>{card.item.typology}</Text> : null}
      </View>
      <View style={styles.grid}>
        {card.choices.map((choice) => {
          const st = status(choice);
          const border = st === 'right' ? c.good : st === 'wrong' ? c.bad : c.line;
          return (
            <Pressable
              key={choice.meaningId}
              accessibilityRole="button"
              accessibilityLabel={picked ? choice.word : 'Vidéo de signe'}
              onPress={() => pick(choice)}
              style={({ pressed }) => [
                styles.cell,
                { borderColor: border, opacity: st === 'dim' ? 0.45 : pressed ? 0.85 : 1 },
              ]}>
              {/* 4:3 crop keeps the signer and most of the signing space while fitting a 2x2 grid */}
              <SignVideo uri={choice.videoUri} rate={rate} style={styles.video} fit="cover" />
              {picked ? (
                <Text style={[styles.caption, { color: st === 'right' ? c.good : st === 'wrong' ? c.bad : c.muted }]}>
                  {choice.word}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {picked && !correct ? <Button label="Continuer" onPress={onNext} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  word: { fontSize: 36, fontWeight: '800', letterSpacing: -0.5 },
  typo: { fontSize: 15, fontStyle: 'italic' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  cell: { width: '48%', borderWidth: 3, borderRadius: 18, overflow: 'hidden', paddingBottom: 2 },
  video: { aspectRatio: 4 / 3, borderRadius: 14 },
  caption: { textAlign: 'center', fontSize: 14, fontWeight: '700', paddingVertical: 4 },
});
