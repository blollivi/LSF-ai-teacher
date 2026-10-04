import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Card } from '../../engine/types';
import { useColors } from '../../ui/colors';
import { Button, Label } from '../../ui/kit';
import { SignVideo } from '../../ui/SignVideo';
import { useQuiz } from './useQuiz';

export function VideoToWordCard({
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
      <Label>👀 Quel est ce signe ?</Label>
      <SignVideo uri={card.item.videoUri} poster={card.item.posterUri} rate={rate} credit={card.item.author} />
      <View style={styles.choices}>
        {card.choices.map((choice) => {
          const st = status(choice);
          const bg = st === 'right' ? c.goodSoft : st === 'wrong' ? c.badSoft : c.card;
          const border = st === 'right' ? c.good : st === 'wrong' ? c.bad : c.line;
          return (
            <Pressable
              key={choice.meaningId}
              accessibilityRole="button"
              onPress={() => pick(choice)}
              style={({ pressed }) => [
                styles.choice,
                { backgroundColor: bg, borderColor: border, opacity: st === 'dim' ? 0.45 : pressed ? 0.85 : 1 },
              ]}>
              <Text style={[styles.choiceText, { color: c.ink }]}>{choice.word}</Text>
              {st === 'right' ? <Text style={styles.mark}>✓</Text> : st === 'wrong' ? <Text style={styles.mark}>✗</Text> : null}
            </Pressable>
          );
        })}
      </View>
      {picked && !correct ? (
        <View style={styles.after}>
          <Text style={[styles.hint, { color: c.muted }]}>
            C'était « {card.item.word} »{card.item.definition ? ` — ${card.item.definition}` : ''}
          </Text>
          <Button label="Continuer" onPress={onNext} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  choices: { gap: 10 },
  choice: {
    minHeight: 56, borderRadius: 16, borderWidth: 2, paddingHorizontal: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  choiceText: { fontSize: 19, fontWeight: '700' },
  mark: { fontSize: 20, fontWeight: '800' },
  after: { gap: 12 },
  hint: { fontSize: 15, lineHeight: 21 },
});
