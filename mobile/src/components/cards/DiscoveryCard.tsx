import { StyleSheet, Text, View } from 'react-native';

import type { Item } from '../../engine/types';
import { useColors } from '../../ui/colors';
import { Button, Label } from '../../ui/kit';
import { SignVideo } from '../../ui/SignVideo';

export function DiscoveryCard({ item, rate, onDone }: { item: Item; rate: number; onDone: () => void }) {
  const c = useColors();
  return (
    <View style={styles.wrap}>
      <Label>✨ Nouveau mot</Label>
      <SignVideo uri={item.videoUri} poster={item.posterUri} rate={rate} credit={item.author} />
      <View style={styles.text}>
        <Text style={[styles.word, { color: c.ink }]}>{item.word}</Text>
        {item.typology ? <Text style={[styles.typo, { color: c.muted }]}>{item.typology}</Text> : null}
        {item.definition ? (
          <Text style={[styles.def, { color: c.muted }]} numberOfLines={4}>
            {item.definition}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.tip, { color: c.muted }]}>Regarde le signe et reproduis-le avec tes mains 👐</Text>
      <Button label="C'est noté !" onPress={onDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  text: { gap: 4 },
  word: { fontSize: 38, fontWeight: '800', letterSpacing: -0.5 },
  typo: { fontSize: 15, fontStyle: 'italic' },
  def: { fontSize: 16, lineHeight: 22, marginTop: 4 },
  tip: { fontSize: 14, textAlign: 'center' },
});
